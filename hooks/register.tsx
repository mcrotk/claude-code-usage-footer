/**
 * usage-footer: context and plan-limit figures under the prompt.
 *
 * Claude Code's own footer line (permission mode and so on) is kept, with the
 * model and effort level added at its end. Under it: the tokens in use, the
 * window size and where auto-compaction runs; the context window as a bar split
 * by category (the same breakdown /context draws), with a legend underneath;
 * and beside those, what the person can run out of: the 5-hour and 7-day plan
 * limits on a Claude subscription, or, where Claude Code is billed per token,
 * the cost of this session, this week and this month. Where a gateway sets a
 * spend limit, the rows are this session's cost, this month's, and the limit.
 */
import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextBreakdown,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type {
  Category,
  ContextFigures,
  CostTotals,
  Limit,
  ModelInfo,
  View,
  Snapshot,
} from '../types'
import { costTotals, formatUsd, monthName, recordCost } from './cost'

/** The figures the footer draws, kept in session state so a redraw reads them. */
const snapshot = atom({ plugin: 'usage-footer', key: 'snapshot' } as const, null)
/** The model and effort level, shown at the end of Claude Code's own footer line. */
const modelInfo = atom({ plugin: 'usage-footer', key: 'modelInfo' } as const, {
  model: null,
  effort: null,
} as ModelInfo)
/** Whether Claude Code is billed per token here, worked out at session start. */
const payPerUse = atom({ plugin: 'usage-footer', key: 'payPerUse' } as const, false)
/** This week's and this month's cost across sessions, for the pay-per-use rows. */
const totals = atom({ plugin: 'usage-footer', key: 'totals' } as const, null as CostTotals | null)
/** The form chosen with /usage-footer-view, or null to let the mod choose. */
const view = atom({ plugin: 'usage-footer', key: 'view' } as const, null as View)
/** The store key under which that choice is kept across sessions. */
const VIEW_KEY = 'view'
/** What /usage-footer-view takes: a form, or `auto` to let the mod choose again. */
const VIEW_CHOICES = ['plan', 'cost', 'spend', 'auto'] as const
type ViewChoice = (typeof VIEW_CHOICES)[number]
/** What /usage-footer-view answers for each choice. */
const VIEW_MESSAGES: Record<ViewChoice, string> = {
  plan: 'The usage footer now shows the subscription form, with the 5-hour and 7-day limits, in every session until you enter /usage-footer-view auto. If Claude doesn\'t send you those limits, the meters show dashes.',
  cost: 'The usage footer now shows the cost form, with this session\'s, this week\'s and this month\'s cost, in every session until you enter /usage-footer-view auto.',
  spend: 'The usage footer now shows the spend-limit form in every session until you enter /usage-footer-view auto. If no spend limit is set for you, its meter shows a dash.',
  auto: 'The usage footer is back to choosing its form by itself.',
}

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
/** A gateway's spend limit (daily, weekly or monthly; mods aren't told which). */
const SPEND_LIMIT: LimitSpec = {
  kind: 'spend_limit',
  label: 'limit',
  safeColor: 'success',
  warningColor: 'warning',
}
const LIMIT_KINDS = [FIRST_LIMIT.kind, SECOND_LIMIT.kind, SPEND_LIMIT.kind]
/** The widest label in the right-hand column when it shows cost (`session`). */
const COST_LABEL_WIDTH = 7
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

/** Whether a limit window is one of a Claude subscription's (5-hour or 7-day). */
function isPlanLimit(limit: { kind: string }): boolean {
  return limit.kind === FIRST_LIMIT.kind || limit.kind === SECOND_LIMIT.kind
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
    costUsd: usage.cost?.usd ?? prev?.costUsd ?? null,
    // Both stay true once true: the context's token count is absent again
    // right after a compaction, and a plan window drops out briefly after it
    // resets, but neither changes how the session is billed.
    hasReplied: (prev?.hasReplied ?? false) || usage.context.tokens !== undefined,
    hasPlanLimits: (prev?.hasPlanLimits ?? false) || usage.rateLimits.some(isPlanLimit),
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

/** Whether a typed argument is one of /usage-footer-view's choices. */
function isViewChoice(value: string): value is ViewChoice {
  return (VIEW_CHOICES as readonly string[]).includes(value)
}

/**
 * Reads the form chosen with /usage-footer-view from the store, so a choice
 * made in one session reaches the others (at their start, and after each
 * reply).
 */
async function loadView($: EngineInterface): Promise<void> {
  try {
    const stored = await $.store.get(VIEW_KEY)
    const chosen: View =
      typeof stored === 'string' && isViewChoice(stored) && stored !== 'auto' ? stored : null
    await update($, view, () => chosen)
  } catch (err) {
    $.ui.log(`usage-footer: could not read the chosen form: ${String(err)}`)
  }
}

/**
 * Records this session's cost toward the week's and month's totals, then
 * recomputes the totals for the footer.
 */
async function refreshCost($: EngineInterface, usd: number | undefined): Promise<void> {
  try {
    const now = await $.clock.now()
    if (usd !== undefined) await recordCost($, usd, now)
    const sums = await costTotals($, now)
    await update($, totals, () => sums)
  } catch (err) {
    $.ui.log(`usage-footer: could not record or total the cost: ${String(err)}`)
  }
}

/** Whether an environment variable is set to something other than off. */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * Works out whether Claude Code is billed per token here: through a cloud
 * provider (the six settings Claude Code itself treats as one: Amazon Bedrock,
 * Google Vertex AI, Microsoft Foundry, Claude Platform on AWS, Claude on Google
 * Cloud, and Mantle), through a company gateway, or with an API key. The key's
 * value is only checked for being set; it is never kept or shown.
 */
async function detectPayPerUse($: EngineInterface): Promise<void> {
  const values = [
    await $.env.get('CLAUDE_CODE_USE_BEDROCK'),
    await $.env.get('CLAUDE_CODE_USE_VERTEX'),
    await $.env.get('CLAUDE_CODE_USE_FOUNDRY'),
    await $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS'),
    await $.env.get('CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD'),
    await $.env.get('CLAUDE_CODE_USE_MANTLE'),
    await $.env.get('CLAUDE_CODE_USE_GATEWAY'),
    await $.env.get('ANTHROPIC_API_KEY'),
  ]
  await update($, payPerUse, () => values.some(isSet))
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
 * `Sonnet 3.5`. Anything else is shown as given, less any provider additions
 * (`us.anthropic.my-deployment-v1:0` → `my-deployment`).
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
  return core
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

/**
 * Formats a reset time: as a weekday and time (`Fri 09:00`) for the 5-hour
 * and 7-day meters, which share that form so their columns line up, or as a
 * date (`Dec 1`) for a spend limit, which may run for a month.
 */
function formatReset(iso: string | undefined, asDate: boolean): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (asDate) return `${monthName(d)} ${d.getDate()}`
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

/**
 * One limit meter: `5h ██░░░░░░  23% resets Mon 18:40`, coloured as it fills.
 * The label is right-aligned to `labelWidth`, so it lines up with the labels
 * of the cost rows above a spend limit.
 */
function limitLine(limits: Limit[], spec: LimitSpec, labelWidth = 2): Span[] {
  const label = spec.label.padStart(labelWidth)
  const limit = limits.find(l => l.kind === spec.kind)
  if (!limit) return [{ text: `${label} –`, dim: true }]

  const fraction = Math.min(1, Math.max(0, limit.percent / 100))
  const filled = Math.round(fraction * LIMIT_BAR)
  const color = meterColor(fraction, spec)
  const reset = formatReset(limit.resetsAt, spec.kind === SPEND_LIMIT.kind)
  const percent = `${Math.round(limit.percent)}%`.padStart(4)

  return [
    { text: `${label} `, dim: true },
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

/** One row of the cost column: a label, `≈ $` and an amount. */
type CostEntry = { label: string; usd: number }

/**
 * Cost rows such as `session ≈ $   1.84`: labels right-aligned, and amounts
 * right-aligned to the widest, so the `≈`, the `$` and the decimal points of
 * all the rows line up. As with the meters, the label is dim and the figure
 * (`≈ $` and the amount) is at normal brightness.
 */
function costRows(entries: CostEntry[]): Span[][] {
  const amounts = entries.map(entry => formatUsd(entry.usd))
  const amountWidth = Math.max(...amounts.map(a => a.length))
  return entries.map((entry, i) => [
    { text: entry.label.padStart(COST_LABEL_WIDTH), dim: true },
    { text: ` ≈ $${(amounts[i] ?? '').padStart(amountWidth)}` },
  ])
}

/** Which kind of right-hand column to draw. */
type Column = 'plan' | 'cost' | 'spend'

/**
 * Chooses the right-hand column. Figures that arrived win: a spend limit, then
 * plan limits. Without either, the cost rows are shown when the settings say
 * Claude Code is billed per token, or once a reply has come back with no limit
 * figures: a subscription always gets its 5-hour and 7-day figures with the
 * first reply, so their absence means per-token billing the settings didn't
 * reveal (a Console sign-in, an `apiKeyHelper`, a proxy). Before the first
 * reply, anyone else gets the plan meters' dashes. A form chosen with
 * /usage-footer-view overrides all of this.
 */
function chooseColumn(snap: Snapshot, isPayPerUse: boolean, chosen: View): Column {
  if (chosen !== null) return chosen
  if (snap.limits.some(l => l.kind === SPEND_LIMIT.kind)) return 'spend'
  if (snap.hasPlanLimits) return 'plan'
  return isPayPerUse || snap.hasReplied ? 'cost' : 'plan'
}

/** Everything the right-hand column draws from. */
type ColumnInput = {
  column: Column
  limits: Limit[]
  sessionUsd: number
  totals: CostTotals
}

/**
 * The right-hand column's three rows, top to bottom, covering longer spans of
 * time as they go down. On a plan, the top row is empty and the two meters sit
 * beside the bar and the legend.
 */
function rightRows({ column, limits, sessionUsd, totals }: ColumnInput): Span[][] {
  if (column === 'plan') {
    return [[], limitLine(limits, FIRST_LIMIT), limitLine(limits, SECOND_LIMIT)]
  }
  if (column === 'cost') {
    return costRows([
      { label: 'session', usd: sessionUsd },
      { label: 'week', usd: totals.week },
      { label: totals.monthLabel, usd: totals.month },
    ])
  }
  return [
    // The month, not the week: spend limits are most often monthly, and its
    // dollars beside the limit's percentage give a rough idea of the limit.
    ...costRows([
      { label: 'session', usd: sessionUsd },
      { label: totals.monthLabel, usd: totals.month },
    ]),
    limitLine(limits, SPEND_LIMIT, COST_LABEL_WIDTH),
  ]
}

/**
 * Lays out the footer rows as spans: the context figures, then the bar and the
 * legend, padded to one width so the right-hand column starts in the same
 * column on every row.
 */
function footerRows(
  context: ContextFigures,
  right: Span[][],
  column: Column,
  columns: number,
): Span[][] {
  // On a plan, the meters' full width is reserved even while they show dashes,
  // so the layout doesn't jump when the first figures arrive.
  const reserved = column === 'plan' ? LIMIT_WIDTH : 0
  const rightWidth = Math.max(reserved, ...right.map(spanWidth))
  // The legend merges categories into "other" until the context part fits
  // beside the right-hand column in the width the footer actually gets.
  const contextRoom = columns - FOOTER_INSET - GAP - rightWidth
  const legend = legendLine(context, contextRoom)
  const stats = contextStats(context)
  const bar = contextLine(context, barCellsFor(spanWidth(legend)))
  const contextWidth = Math.max(spanWidth(bar), spanWidth(legend), spanWidth(stats))
  const leftWidth = contextWidth + GAP
  const [first = [], second = [], third = []] = right

  return [
    // The figures sit above the bar, ending where the bar and legend end.
    first.length > 0
      ? [...padTo(padStartTo(stats, contextWidth), leftWidth), ...first]
      : padStartTo(stats, contextWidth),
    [...padTo(bar, leftWidth), ...second],
    [...padTo(legend, leftWidth), ...third],
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
    await $.command.register({
      name: 'usage-footer-view',
      description: 'Choose the usage footer\'s form (subscription limits, costs or a spend limit), or auto',
      argumentHint: 'plan | cost | spend | auto',
    })
    await loadView($)
    await refresh($, true)
    await seedModelInfo($)
    await detectPayPerUse($)
    await refreshCost($, (await $.session.usage()).cost?.usd)
    return result
  })

  // /usage-footer-view plan|cost|spend|auto: chooses the right-hand column's
  // form for every session (kept in the store) until `auto` hands the choice
  // back to the mod. A form shows only real figures; where the figures it
  // needs never arrive, its meters show dashes.
  on('command.run', { command: 'usage-footer-view' }, async ($, e) => {
    const choice = e.args.trim().toLowerCase()
    if (!isViewChoice(choice)) {
      return { text: 'Usage: /usage-footer-view plan | cost | spend | auto' }
    }
    const chosen: View = choice === 'auto' ? null : choice
    await $.store.set(VIEW_KEY, chosen)
    await update($, view, () => chosen)
    return { text: VIEW_MESSAGES[choice] }
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
    if (e.changed.includes('cost')) await refreshCost($, e.cost?.usd)
    await loadView($)
    return result
  })

  // Claude Code's own footer line (permission mode, notices) stays as it is,
  // with the model and effort added at its end; the usage rows are drawn
  // underneath it (figures, bar, legend), with limits or costs beside them.
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

    const now = await $.clock.now()
    const column = chooseColumn(snap, await read($, payPerUse), await read($, view))
    const right = rightRows({
      column,
      limits: snap.limits,
      sessionUsd: snap.costUsd ?? 0,
      totals: (await read($, totals)) ?? { week: 0, month: 0, monthLabel: monthName(new Date(now)) },
    })
    const rows = footerRows(snap.context, right, column, columns)
    return (
      <Box flexDirection="column">
        {engineLine}
        {rows.map(line)}
      </Box>
    )
  })
}
