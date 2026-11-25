/**
 * Running cost totals for pay-per-use setups (Bedrock, Vertex, an API key):
 * the mod keeps each session's cost by day in its store, and sums the days of
 * the current week and month across sessions.
 *
 * Each session writes only its own store key (`cost:<session id>`), so two
 * sessions running at once don't overwrite each other's figures. The totals
 * only cover sessions run with the mod, on this machine.
 */
import type { EngineInterface } from 'claude-code'

import type { CostTotals } from '../types'

/** What the store holds for one session. */
type CostRecord = {
  /**
   * The session's cost when the mod first saw it, in US dollars. That much was
   * spent before tracking began, at times the mod can't know, so it is left
   * out of the totals.
   */
  startUsd: number
  /** The session's cost when it was last recorded, in US dollars. */
  lastUsd: number
  /** The session's cost per local day (`2026-11-25`), in US dollars. */
  days: Record<string, number>
  /** When the record was last written, in milliseconds since the epoch. */
  updatedAt: number
}

/** Store keys holding a session's cost start with this. */
const KEY_PREFIX = 'cost:'
/** Records not written for this long are deleted (longer than any month). */
const KEEP_MS = 70 * 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Pads a number to two digits. */
function twoDigits(n: number): string {
  return String(n).padStart(2, '0')
}

/** The local calendar day of a time, as `YYYY-MM-DD`, which sorts by date. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`
}

/** The local Monday that starts the calendar week a time falls in. */
function weekStart(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday)
}

/** The short name of a time's month: `Nov`. */
export function monthName(date: Date): string {
  return MONTHS[date.getMonth()] ?? ''
}

/**
 * Reads a stored value as a cost record, or null when it isn't one (records
 * in an older form included; `costTotals` deletes those).
 */
function asRecord(value: unknown): CostRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Partial<CostRecord>
  const isValid =
    typeof r.startUsd === 'number' &&
    typeof r.lastUsd === 'number' &&
    typeof r.updatedAt === 'number' &&
    typeof r.days === 'object' &&
    r.days !== null
  return isValid ? (r as CostRecord) : null
}

/**
 * Adds what this session has cost since it was last recorded to today's
 * figure in its record.
 *
 * The first time the mod sees a session, its cost so far only becomes the
 * starting point: a session that was already running (resumed, or open when
 * the mod was installed or updated) spent that at times the mod can't know.
 * The cost counter can also start over (for example after `/clear`); a
 * reading below the last one then counts in full.
 */
export async function recordCost($: EngineInterface, usd: number, now: number): Promise<void> {
  const key = `${KEY_PREFIX}${await $.session.id()}`
  const record = asRecord(await $.store.get(key))
  if (record === null) {
    const start: CostRecord = { startUsd: usd, lastUsd: usd, days: {}, updatedAt: now }
    await $.store.set(key, start)
    return
  }
  if (usd === record.lastUsd) return

  const added = usd > record.lastUsd ? usd - record.lastUsd : usd
  const today = dayKey(new Date(now))
  const days = { ...record.days, [today]: (record.days[today] ?? 0) + added }
  await $.store.set(key, { ...record, lastUsd: usd, days, updatedAt: now } satisfies CostRecord)
}

/** Sums the days of every record that fall in this week and this month. */
function sumRecords(records: CostRecord[], now: Date): { week: number; month: number } {
  const today = dayKey(now)
  const fromMonday = dayKey(weekStart(now))
  const monthPrefix = today.slice(0, 7)
  let week = 0
  let month = 0
  for (const record of records) {
    for (const [day, usd] of Object.entries(record.days)) {
      if (day >= fromMonday && day <= today) week += usd
      if (day.startsWith(monthPrefix)) month += usd
    }
  }
  return { week, month }
}

/**
 * Totals this week's and this month's cost across all sessions' records, and
 * deletes records that are too old to count toward either.
 */
export async function costTotals($: EngineInterface, now: number): Promise<CostTotals> {
  const records: CostRecord[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(KEY_PREFIX)) continue
    const record = asRecord(await $.store.get(key))
    if (record === null || now - record.updatedAt > KEEP_MS) {
      await $.store.delete(key)
    } else {
      records.push(record)
    }
  }
  const date = new Date(now)
  return { ...sumRecords(records, date), monthLabel: monthName(date) }
}

/** Formats dollars with two decimals and thousands separators: `1,284.50`. */
export function formatUsd(usd: number): string {
  const [whole = '0', cents = '00'] = Math.max(0, usd).toFixed(2).split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}
