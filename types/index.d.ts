/** One row of the context breakdown, as /context lists it (deferred rows left out). */
export type Category = {
  name: string
  tokens: number
  /** The theme colour /context draws this row in. */
  color: string
  kind: 'used' | 'free' | 'buffer'
}

/** One limit window: `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
export type Limit = {
  kind: string
  /** 0 to 100. */
  percent: number
  /** ISO 8601 time the window resets, when known. */
  resetsAt?: string
}

/** The context half of the footer, from the latest breakdown. */
export type ContextFigures = {
  categories: Category[]
  /** Estimated tokens in use (the breakdown's total, as /context shows it). */
  usedTokens: number
  /** The span the bar is drawn over: the window the breakdown measures against. */
  barTokens: number
  /** The model's context window. */
  windowTokens: number
  /** Where auto-compaction runs, or null when it is off. */
  threshold: number | null
}

/** Everything the footer draws. */
export type Snapshot = {
  context: ContextFigures | null
  limits: Limit[]
  /** What this session has cost so far, in US dollars, as /cost totals it. */
  costUsd: number | null
  /** Whether a reply has come back in this session, so limit figures would have arrived. */
  hasReplied: boolean
  /** Whether 5-hour or 7-day figures have arrived in this session (a Claude subscription). */
  hasPlanLimits: boolean
}

/** This week's and this month's cost across sessions, in US dollars. */
export type CostTotals = {
  week: number
  month: number
  /** The month's short name, shown as the row's label: `Nov`. */
  monthLabel: string
}

/**
 * The form chosen with /usage-footer-view, kept across sessions, or null when
 * the mod chooses by itself (`auto`).
 */
export type View = 'plan' | 'cost' | 'spend' | null

/** The model and effort level shown at the end of Claude Code's footer line. */
export type ModelInfo = {
  /** The main model, as /model shows it. */
  model: string | null
  /** The effort level the last main-loop request was sent with. */
  effort: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-footer': {
      snapshot: Snapshot | null
      modelInfo: ModelInfo
      /** Whether Claude Code is billed per token here (Bedrock, Vertex, Foundry, an API key). */
      payPerUse: boolean
      totals: CostTotals | null
      view: View
    }
  }
}
