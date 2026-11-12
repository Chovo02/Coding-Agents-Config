// What the band shows for the current turn. `model` is set only when Jev changed the main model
// this turn; `effort` only when Jev answered that question with enough confidence.
export type Route = {
  alias?: string
  model?: string
  confidence?: number
  effort?: string
  effortConfidence?: number
  // Jev wanted another model but the warm cache made the switch too expensive.
  suggest?: string
  suggestUsd?: number
}

export type Outcome = 'routed' | 'low-confidence' | 'no-key' | 'timeout' | 'http-error' | 'bad-response'

export type Arm = 'jev' | 'control'

// What the policy decided about the main model for this prompt (see hooks/policy.ts).
export type Decision = {
  action: 'set' | 'keep' | 'suggest'
  why: string
  alias?: string
  estUsd?: number
}

// What the last call to Jev looked like, kept for /jev-last. `prompt` is a short preview, never the whole text.
export type Run = {
  at: number
  prompt: string
  jevModel: string
  outcome: Outcome
  latencyMs: number
  httpStatus?: number
  error?: string
  choice?: string
  confidence?: number
  probabilities?: Record<string, number>
  model?: string
  effortChoice?: string
  effortConfidence?: number
  effortProbabilities?: Record<string, number>
  effort?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  arm?: Arm
  decision?: Decision
  contextTokens?: number
  // Where the questions sent to Jev came from: prompts/questions.json, or the built-in fallback.
  promptSource?: 'file' | 'fallback'
}

// The model the main loop is pinned to. `mechanism` says how: `command` ran /model (the session's
// real model), `override` rewrites each main-loop request in turn.step (fallback).
export type Sticky = {
  alias: string
  model: string
  setAt: number
  why: string
  mechanism: 'command' | 'override'
  // Why /model could not be used, when the fallback is in force.
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'jev-router': { route: Route | null; lastRun: Run | null; sticky: Sticky | null; arm: Arm | null }
  }
}
