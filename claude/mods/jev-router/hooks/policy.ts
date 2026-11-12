// Jev v2 routing policy: pure functions, no `$`, so the tests can drive them directly.
//
// The prompt cache is per model: switching the main loop's model re-writes the whole context
// on the new model, while changing effort on the 5.5 family keeps the cache. So the model is
// "sticky": chosen where the cache is empty anyway (first prompt, after /clear or /compact,
// after the cache TTL), and changed mid-session only when the rewrite is cheap or the switch
// is an upgrade Jev is sure about. Effort is free to move on every turn.

export const MODELS: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}

const RANK: Record<string, number> = { haiku: 0, sonnet: 1, opus: 2 }

// 1h cache-write list price, USD per million tokens (platform.claude.com pricing, 2026-10).
// Haiku 5.5 has a long-context tier above 100k prompt tokens.
export function cacheWriteUsd(model: string, tokens: number): number {
  const perMTok = /haiku/.test(model) ? (tokens > 100_000 ? 1 : 0.2)
    : /sonnet/.test(model) ? 4
    : /fable/.test(model) ? 20
    : 8
  return (tokens / 1_000_000) * perMTok
}

export type Policy = {
  minConfidence: number
  upgradeConfidence: number
  downgradeMaxUsd: number
  // From this many context tokens the cache counts as full: a model switch would throw away too much.
  cacheFullTokens: number
  cacheTtlMs: number
}

export const DEFAULT_POLICY: Policy = {
  minConfidence: 0.6,
  upgradeConfidence: 0.8,
  downgradeMaxUsd: 0.1,
  cacheFullTokens: 100_000,
  cacheTtlMs: 60 * 60 * 1000,
}

// What the router knows about the main loop between prompts.
export type Session = {
  sticky?: string // alias of the model Jev settled on, absent until the first decision
  lastResponseAt?: number // clock ms of the last main-loop answer
  contextTokens: number // what the next request re-sends
  compacted: boolean // a /clear or /compact happened since the last decision
}

export type ResetWhy = 'first' | 'compact' | 'cold'

// A reset point is where the main cache is empty or expired, so a switch costs nothing extra.
export function resetPoint(s: Session, now: number, ttlMs: number): ResetWhy | undefined {
  if (!s.sticky) return 'first'
  if (s.compacted) return 'compact'
  if (s.lastResponseAt !== undefined && now - s.lastResponseAt > ttlMs) return 'cold'
  return undefined
}

export type ModelDecision =
  | { action: 'set'; alias: string; why: ResetWhy | 'upgrade' | 'cheap-rewrite'; estUsd: number }
  | { action: 'keep'; why: 'no-answer' | 'low-confidence' | 'same' | 'cache-full' }
  | { action: 'suggest'; alias: string; why: 'cache-warm'; estUsd: number }

export function decideModel(
  s: Session,
  choice: string | undefined,
  confidence: number,
  now: number,
  p: Policy,
): ModelDecision {
  if (!choice || !MODELS[choice]) return { action: 'keep', why: 'no-answer' }
  // The first prompt has no cache to rewrite yet, so Jev's pick applies to it whatever its confidence.
  if (!s.sticky) return { action: 'set', alias: choice, why: 'first', estUsd: 0 }
  if (confidence < p.minConfidence) return { action: 'keep', why: 'low-confidence' }

  if (choice === s.sticky) return { action: 'keep', why: 'same' }
  const reset = resetPoint(s, now, p.cacheTtlMs)
  if (reset) return { action: 'set', alias: choice, why: reset, estUsd: 0 }
  // A warm cache this full: any switch re-writes so much context that even an upgrade is not worth it.
  if (s.contextTokens >= p.cacheFullTokens) return { action: 'keep', why: 'cache-full' }

  const estUsd = cacheWriteUsd(MODELS[choice] ?? choice, s.contextTokens)
  const isUpgrade = (RANK[choice] ?? 0) > (RANK[s.sticky ?? 'opus'] ?? 2)
  // An upgrade is about quality: allowed on a warm cache when Jev is sure. A downgrade is about
  // cost: allowed only when re-caching the context costs less than the saving could be.
  if (isUpgrade && confidence >= p.upgradeConfidence) return { action: 'set', alias: choice, why: 'upgrade', estUsd }
  if (!isUpgrade && estUsd < p.downgradeMaxUsd) return { action: 'set', alias: choice, why: 'cheap-rewrite', estUsd }
  return { action: 'suggest', alias: choice, why: 'cache-warm', estUsd }
}

// Prompt tokens the next request re-sends, from a main-loop turn's usage.
export function contextTokensOf(usage: {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
} | undefined): number | undefined {
  if (!usage) return undefined
  return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0)
}

// Built-in subagents without an explicit model inherit the session's (often Opus). The map gives
// them one; a model in the Agent call, or any user/plugin agent definition, is left alone, since
// their frontmatter `model` would be overridden by a hook's.
export function subagentModel(
  subagentType: string,
  explicitModel: string | undefined,
  source: string | undefined,
  map: Record<string, string>,
): string | undefined {
  if (explicitModel) return undefined
  if (source !== 'built-in') return undefined
  return map[subagentType]
}

export function parseSubagentModels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed ?? {})) if (typeof v === 'string' && MODELS[v]) out[k] = v
    return out
  } catch {
    return {}
  }
}

// One arm per session, so a control session never switches model and stays cache-comparable.
export function pickArm(random: number, controlRate: number): 'jev' | 'control' {
  return random < controlRate ? 'control' : 'jev'
}

export function usd(n: number): string {
  return `$${n.toFixed(2).replace('.', ',')}`
}
