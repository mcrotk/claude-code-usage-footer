/**
 * usage-footer: context and plan-limit figures under the prompt.
 *
 * Claude Code's own footer line (permission mode and so on) is kept, with the
 * model and effort level added at its end. Under it: the tokens in use, the
 * window size and where auto-compaction runs; the context window as a bar split
 * by category (the same breakdown /context draws), with a legend underneath;
 * and beside those, the 5-hour and 7-day plan limits.
 */
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextBreakdown,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type { Category, ContextFigures, Limit, ModelInfo, Snapshot } from '../types'

/** The figures the footer draws, kept in session state so a redraw reads them. */
const snapshot = atom({ plugin: 'usage-footer', key: 'snapshot' } as const, null)
/** The model and effort level, shown at the end of Claude Code's own footer line. */
const modelInfo = atom({ plugin: 'usage-footer', key: 'modelInfo' } as const, {
  model: null,
  effort: null,
} as ModelInfo)

/** Cells between the context column and the limits column. */
const GAP = 8
/**
 * Cells of the terminal's width that the footer can't use: Claude Code indents
 * the footer two columns on each side, and `e.viewport.columns` is the whole
 * terminal. Without this the rows were up to four cells too wide at medium
 * widths, and the reset times at their ends were cut off.
 */
const FOOTER_INSET = 4
/** Cells the reset time is padded to, so both meters line up (`Tue 17:00`). */
const RESET_WIDTH = 9
/**
 * Colours used in place of the theme's for some categories, by their name in
 * /context. Under the dark-ansi theme "System prompt" (promptBorder) and
 * "System tools" (inactive) both come out the same grey. A colour name follows
 * the terminal's own palette, as the theme's colours do.
 */
const CATEGORY_COLORS: Record<string, string> = { 'System tools': 'blueBright' }
/** Order of the bar's segments: what's in use, then free space, then the compaction buffer. */
const KIND_ORDER: Record<Category['kind'], number> = { used: 0, free: 1, buffer: 2 }
/** Cells in each limit meter's bar. */
const LIMIT_BAR = 8
/** The narrowest the context bar is allowed to get. */
const MIN_BAR = 10
/** The limit window shown on each line, with its label. */
/**
 * Each meter's colours below the warning point and from it; both turn the
 * theme's red (`error`) from 90%. The 7-day meter has its own pair so the two
 * can be told apart; the terminal palette has no orange, so that one is exact.
 */
type LimitSpec = { kind: string; label: string; safeColor: string; warningColor: string }
const FIRST_LIMIT: LimitSpec = {
  kind: 'five_hour',
  label: '5h',
  safeColor: 'success',
  warningColor: 'warning',
}
const SECOND_LIMIT: LimitSpec = {
  kind: 'seven_day',
  label: '7d',
  safeColor: 'blueBright',
  warningColor: '#ff8700',
}
const LIMIT_KINDS = [FIRST_LIMIT.kind, SECOND_LIMIT.kind]
/** Where a limit meter turns to its warning colour, then to red. */
const LIMIT_WARN_AT = 0.75
const LIMIT_ERROR_AT = 0.9
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------
// Gathering the figures
// ---------------------------------------------------------------------------

/** Turns the engine's /context breakdown into the context half of the snapshot. */
function contextFromBreakdown(
  breakdown: SessionContextBreakdown,
  windowTokens: number,
): ContextFigures {
  // Deferred rows are tool schemas loaded on demand; /context leaves them out
  // of its grid because they don't occupy the window, so the bar does too.
  const categories: Category[] = breakdown.categories
    .filter(c => c.kind !== 'deferred')
    .map(c => ({
      name: c.name,
      tokens: c.tokens,
      color: CATEGORY_COLORS[c.name] ?? c.color,
      kind: c.kind as Category['kind'],
    }))
    // /context lists the compaction buffer before the free space; the bar
    // puts it at the far end, where compaction actually happens. (Stable sort.)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return {
    categories,
    usedTokens: breakdown.totalTokens,
    barTokens: breakdown.rawMaxTokens,
    windowTokens,
    threshold: breakdown.isAutoCompactEnabled
      ? (breakdown.autoCompactThreshold ?? null)
      : null,
  }
}

/** Keeps the limit windows the footer shows, in plain-data form. */
function limitsFrom(rateLimits: SessionRateLimit[]): Limit[] {
  return rateLimits
    .filter(l => LIMIT_KINDS.includes(l.kind))
    .map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt }))
}

/** Combines a fresh usage reading with the previous snapshot. */
function nextSnapshot(prev: Snapshot | null, usage: SessionUsage): Snapshot {
  const breakdown = usage.context.breakdown

  return {
    // Without a new breakdown (only the limits moved), keep the last one.
    context: breakdown
      ? contextFromBreakdown(breakdown, usage.context.window)
      : (prev?.context ?? null),
    limits: limitsFrom(usage.rateLimits),
  }
}

/**
 * Reads usage from the engine and stores it for the footer.
 *
 * The breakdown is the `summary` kind: estimated locally, with no API calls.
 */
async function refresh($: EngineInterface, withBreakdown: boolean): Promise<void> {
  try {
    const usage = await $.session.usage(
      withBreakdown ? { breakdown: 'summary' } : undefined,
    )
    await update($, snapshot, prev => nextSnapshot(prev ?? null, usage))
  } catch (err) {
    $.ui.log(`usage-footer: could not read usage: ${String(err)}`)
  }
}

/** Reads the main model's name and stores it, keeping the last effort level seen. */
async function refreshModel($: EngineInterface, effort?: string): Promise<void> {
  try {
    const model = await $.session.model()
    await update($, modelInfo, prev => ({
      model,
      effort: effort ?? prev?.effort ?? null,
    }))
  } catch (err) {
    $.ui.log(`usage-footer: could not read the model: ${String(err)}`)
  }
}

/** The effort levels Claude Code sends. */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Returns the value when it is an effort level, else null. */
function asEffortLevel(value: unknown): string | null {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value) ? value : null
}

/** Reads `modelSettings[model].effortLevel` from the merged settings, if present. */
function modelSettingsEffort(settings: Record<string, unknown>, model: string): unknown {
  const all = settings['modelSettings']
  if (typeof all !== 'object' || all === null) return undefined
  const entry = (all as Record<string, unknown>)[model]
  if (typeof entry !== 'object' || entry === null) return undefined
  return (entry as Record<string, unknown>)['effortLevel']
}

/**
 * The effort level the configuration gives the model, checked in this order:
 * the CLAUDE_CODE_EFFORT_LEVEL variable (where `auto` or `unset` means no level
 * is sent), then the model's own `modelSettings` entry, then `effortLevel`.
 * Null when none of them names a level.
 */
async function configuredEffort($: EngineInterface, model: string): Promise<string | null> {
  const fromEnv = await $.env.get('CLAUDE_CODE_EFFORT_LEVEL')
  if (fromEnv !== undefined && fromEnv !== '') return asEffortLevel(fromEnv)

  const settings = (await $.settings.read()) as Record<string, unknown>
  return asEffortLevel(modelSettingsEffort(settings, model)) ?? asEffortLevel(settings['effortLevel'])
}

/**
 * At session start, reads the model and takes the effort level from the
 * configuration, so both show before the first request. A level already seen
 * on a request (kept across a reload of the mod) wins, since it is what was
 * actually sent, `/effort` changes included.
 */
async function seedModelInfo($: EngineInterface): Promise<void> {
  try {
    const model = await $.session.model()
    const configured = await configuredEffort($, model)
    await update($, modelInfo, prev => ({ model, effort: prev?.effort ?? configured }))
  } catch (err) {
    $.ui.log(`usage-footer: could not read the model or effort settings: ${String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Strips what cloud providers add around Anthropic's model ID, leaving e.g.
 * `claude-sonnet-5-5`: an ARN's path (`arn:aws:bedrock:…/us.anthropic.…`), a
 * Bedrock region and provider prefix (`us.anthropic.`, `global.anthropic.`), a
 * Bedrock version suffix (`-v1:0`) and a Vertex date suffix (`@20250929`).
 */
function anthropicModelId(id: string): string {
  return (id.split('/').pop() ?? id)
    .replace(/^(?:[a-z-]+\.)?anthropic\./, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/@\d{8}$/, '')
}

/** Capitalizes a model family's name: `sonnet` → `Sonnet`. */
function familyName(family: string): string {
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}`
}

/**
 * Turns a model ID into a short name: `claude-opus-5-5` → `Opus 5.5`,
 * `claude-sonnet-4-5-20250929` → `Sonnet 4.5`, `us.anthropic.claude-sonnet-5-5`
 * → `Sonnet 5.5`, and the older order `claude-3-5-sonnet-20241022` →
 * `Sonnet 3.5`. Anything else is shown as given.
 */
function modelName(id: string): string {
  const core = anthropicModelId(id)
  // Current IDs put the family first: claude-<family>-<major>[-<minor>][-<date>][<suffix>].
  const current = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[.*\])?$/.exec(core)
  if (current) {
    const [, family = '', major, minor, suffix = ''] = current
    return `${familyName(family)} ${minor === undefined ? major : `${major}.${minor}`}${suffix}`
  }
  // Older IDs put the version first: claude-<major>[-<minor>]-<family>[-<date>].
  const older = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{8}|-latest)?$/.exec(core)
  if (older) {
    const [, major, minor, family = ''] = older
    return `${familyName(family)} ${minor === undefined ? major : `${major}.${minor}`}`
  }
  return id
}

/**
 * The text added to the end of Claude Code's footer line: `Opus 5.5 · high effort`.
 * Claude Code puts its own ` · ` before it.
 */
function modelTail(info: ModelInfo): string | undefined {
  const parts = [
    info.model ? modelName(info.model) : null,
    info.effort ? `${info.effort} effort` : null,
  ].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** Formats a token count compactly: 950, 12k, 182k, 1M, 1.2M. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

/** Pads a number to two digits. */
function twoDigits(n: number): string {
  return String(n).padStart(2, '0')
}

/** Formats a reset time as `Fri 09:00`; both meters use the same form so their columns line up. */
function formatReset(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}`
  return `${WEEKDAYS[d.getDay()] ?? ''} ${time}`
}

/** Theme colour for how full something is: normal, then warning, then error. */
function levelColor(fraction: number, warnAt: number, errorAt: number): string | undefined {
  if (fraction >= errorAt) return 'error'
  if (fraction >= warnAt) return 'warning'
  return undefined
}

// ---------------------------------------------------------------------------
// Layout (pure: plain spans, turned into elements at the end)
// ---------------------------------------------------------------------------

/** A run of text in one style. */
type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** Total cells a list of spans takes. */
function spanWidth(spans: Span[]): number {
  return spans.reduce((sum, s) => sum + s.text.length, 0)
}

/**
 * Shares `cells` among the categories in proportion to their tokens
 * (largest-remainder rounding). Every used category with tokens gets at least
 * one cell, taken from the free space, so small ones still show in the bar.
 */
function allocateCells(categories: Category[], cells: number): number[] {
  const total = categories.reduce((sum, c) => sum + c.tokens, 0) || 1
  const exact = categories.map(c => (c.tokens / total) * cells)
  const counts = exact.map(Math.floor)
  let left = cells - counts.reduce((a, b) => a + b, 0)

  const byRemainder = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    counts[i] = cellsAt(counts, i) + 1
    left -= 1
  }

  const freeIndex = categories.findIndex(c => c.kind === 'free')
  categories.forEach((c, i) => {
    const isHidden = c.kind === 'used' && c.tokens > 0 && cellsAt(counts, i) === 0
    if (isHidden && freeIndex >= 0 && cellsAt(counts, freeIndex) > 0) {
      counts[i] = 1
      counts[freeIndex] = cellsAt(counts, freeIndex) - 1
    }
  })
  return counts
}

/** Reads a cell count, treating a missing entry as zero. */
function cellsAt(counts: number[], i: number): number {
  return counts[i] ?? 0
}

/** The bar's spans: used categories in their colours, then free space, then the compaction buffer. */
function contextBar(ctx: ContextFigures, cells: number): Span[] {
  const counts = allocateCells(ctx.categories, cells)
  return ctx.categories.map((c, i) => {
    const n = cellsAt(counts, i)
    if (c.kind === 'free') return { text: '─'.repeat(n), dim: true }
    if (c.kind === 'buffer') return { text: '░'.repeat(n), dim: true }
    return { text: '█'.repeat(n), color: c.color }
  })
}

/** The figures after the bar: `182k / 1M (18%) · compacts at 967k`. */
function contextStats(ctx: ContextFigures): Span[] {
  const percent = Math.round((ctx.usedTokens / ctx.windowTokens) * 100)
  // Colour by how close the context is to compacting (or to the window's end).
  const limit = ctx.threshold ?? ctx.windowTokens
  const color = levelColor(ctx.usedTokens / limit, 0.7, 0.9)
  const compacts =
    ctx.threshold === null ? 'auto-compact off' : `compacts at ${formatTokens(ctx.threshold)}`

  return [
    { text: `${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)} ` },
    { text: `(${percent}%)`, color, bold: color !== undefined },
    { text: ` · ${compacts}`, dim: true },
  ]
}

/** The label in front of the bar. */
const CONTEXT_LABEL: Span = { text: 'context ', dim: true }

/** How many cells the bar gets: enough to end where the legend below it ends. */
function barCellsFor(legendWidth: number): number {
  return Math.max(MIN_BAR, legendWidth - CONTEXT_LABEL.text.length)
}

/** The bar row's left side: the label, then the bar. */
function contextLine(ctx: ContextFigures, barCells: number): Span[] {
  return [CONTEXT_LABEL, ...contextBar(ctx, barCells)]
}

/** One legend entry: a coloured square, the name and its tokens. */
function legendEntry(name: string, tokens: number, color: string | undefined): Span[] {
  return [
    { text: '■ ', color },
    { text: `${name} ${formatTokens(tokens)}`, dim: true },
  ]
}

/** Builds legend spans from entries, with two spaces between them. */
function legendSpans(entries: { name: string; tokens: number; color?: string }[]): Span[] {
  return entries.flatMap((entry, i) => [
    ...(i > 0 ? [{ text: '  ' }] : []),
    ...legendEntry(entry.name.toLowerCase(), entry.tokens, entry.color),
  ])
}

/**
 * The second line's left side: each used category with its tokens. When it
 * doesn't fit, the smallest categories are merged into "other" until it does.
 */
function legendLine(ctx: ContextFigures, width: number): Span[] {
  const used = ctx.categories.filter(c => c.kind === 'used' && c.tokens > 0)
  let shown = used.map(c => ({ name: c.name, tokens: c.tokens, color: c.color }))
  let other = 0

  while (shown.length > 1 && spanWidth(legendSpans(withOther(shown, other))) > width) {
    const smallest = shown.reduce((a, b) => (b.tokens < a.tokens ? b : a))
    other += smallest.tokens
    shown = shown.filter(c => c !== smallest)
  }
  return legendSpans(withOther(shown, other))
}

/** Appends an "other" entry when some categories were merged into it. */
function withOther(
  entries: { name: string; tokens: number; color?: string }[],
  other: number,
): { name: string; tokens: number; color?: string }[] {
  return other > 0 ? [...entries, { name: 'other', tokens: other, color: 'inactive' }] : entries
}

/** Cells one limit meter takes: label, bar, percent, and the padded reset time. */
const LIMIT_WIDTH = 3 + LIMIT_BAR + 5 + ' resets '.length + RESET_WIDTH

/** A meter's colour for how full it is: its safe colour, its warning colour, then red. */
function meterColor(fraction: number, spec: LimitSpec): string {
  if (fraction >= LIMIT_ERROR_AT) return 'error'
  if (fraction >= LIMIT_WARN_AT) return spec.warningColor
  return spec.safeColor
}

/** One limit meter: `5h ██░░░░░░  23% resets Mon 18:40`, coloured as it fills. */
function limitLine(limits: Limit[], spec: LimitSpec): Span[] {
  const limit = limits.find(l => l.kind === spec.kind)
  if (!limit) return [{ text: `${spec.label} –`, dim: true }]

  const fraction = Math.min(1, Math.max(0, limit.percent / 100))
  const filled = Math.round(fraction * LIMIT_BAR)
  const color = meterColor(fraction, spec)
  const reset = formatReset(limit.resetsAt)
  const percent = `${Math.round(limit.percent)}%`.padStart(4)

  return [
    { text: `${spec.label} `, dim: true },
    { text: '█'.repeat(filled), color },
    { text: '░'.repeat(LIMIT_BAR - filled), dim: true },
    // The figure takes the bar's colour only once it's a warning, so it stands out.
    { text: ` ${percent}`, color: fraction >= LIMIT_WARN_AT ? color : undefined },
    ...(reset ? [{ text: ` resets ${reset}`, dim: true }] : []),
  ]
}

/** Pads spans with spaces so they fill exactly `width` cells (when shorter). */
function padTo(spans: Span[], width: number): Span[] {
  const missing = width - spanWidth(spans)
  return missing > 0 ? [...spans, { text: ' '.repeat(missing) }] : spans
}

/**
 * Lays out the footer rows as spans: the context figures, then the bar and the
 * legend, which are padded to the same width so the limit meters beside them
 * start in the same column.
 */
function footerRows(snap: Snapshot & { context: ContextFigures }, columns: number): Span[][] {
  // The legend merges categories into "other" until the context part fits
  // beside the meters in the width the footer actually gets.
  const contextRoom = columns - FOOTER_INSET - GAP - LIMIT_WIDTH
  const legend = legendLine(snap.context, contextRoom)
  const stats = contextStats(snap.context)
  const bar = contextLine(snap.context, barCellsFor(spanWidth(legend)))
  const contextWidth = Math.max(spanWidth(bar), spanWidth(legend), spanWidth(stats))
  const leftWidth = contextWidth + GAP

  return [
    // The figures sit above the bar, ending where the bar and legend end.
    padStartTo(stats, contextWidth),
    [...padTo(bar, leftWidth), ...limitLine(snap.limits, FIRST_LIMIT)],
    [...padTo(legend, leftWidth), ...limitLine(snap.limits, SECOND_LIMIT)],
  ]
}

/** Pads spans with leading spaces so they end at `width` cells (right-aligned). */
function padStartTo(spans: Span[], width: number): Span[] {
  const missing = width - spanWidth(spans)
  return missing > 0 ? [{ text: ' '.repeat(missing) }, ...spans] : spans
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const register: Register = on => {
  // A first reading, so the footer has something before the first reply.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($, true)
    await seedModelInfo($)
    return result
  })

  // Each main-loop request to the model says which model and effort it was
  // sent with; that picks up /model and /effort changes. Subagents' requests
  // (with an agentId) are ignored. This event streams, so the hook is a
  // generator that records the values and passes the stream through untouched.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = typeof e.effort === 'string' ? e.effort : undefined
      await refreshModel($, effort)
    }
    return yield* next(e)
  })

  // The engine raises this when the context fill, a limit or the cost moves;
  // the breakdown is only recomputed when the context moved.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context') || e.changed.includes('rateLimits')) {
      await refresh($, e.changed.includes('context'))
    }
    return result
  })

  // Claude Code's own footer line (permission mode, notices) stays as it is,
  // with the model and effort added at its end; the usage rows are drawn
  // underneath it (figures, bar, legend).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // The model and effort go at the end of Claude Code's own line, which it
    // keeps drawing itself (so its live parts, like the agent count, still work).
    const tail = modelTail(await read($, modelInfo))
    const engineLine = await next(tail ? { ...e, props: { ...e.props, tail } } : e)
    const snap = await read($, snapshot)
    if (!snap || !snap.context) return engineLine

    const { Box, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 120

    /** Turns spans into one line of styled text, cut at the edge rather than wrapped. */
    const line = (spans: Span[]) => (
      <Text wrap="truncate-end">
        {spans.map(s => (
          <Text color={s.color} dimColor={s.dim} bold={s.bold}>
            {s.text}
          </Text>
        ))}
      </Text>
    )

    const rows = footerRows({ ...snap, context: snap.context }, columns)
    return (
      <Box flexDirection="column">
        {engineLine}
        {rows.map(line)}
      </Box>
    )
  })
}
