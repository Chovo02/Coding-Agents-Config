import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Arm, Outcome, Route, Run, Sticky } from '../types'
import {
  DEFAULT_POLICY,
  MODELS,
  contextTokensOf,
  decideModel,
  parseSubagentModels,
  pickArm,
  subagentModel,
  usd,
} from './policy'
import type { ModelDecision, Policy, Session } from './policy'

// Asks Jev (TypeSafe System One) which Claude model and effort fit the submitted prompt.
// Effort is applied on every main-loop turn (it keeps the prompt cache on the 5.5 family).
// The model is sticky (see policy.ts): set where the cache is cold, otherwise only suggested.
// Built-in subagents without an explicit model get one from `subagentModels`.
// Fail-open: no key, timeout, API error or low confidence → the session's model and effort stay.
// Off in headless runs (`claude -p`, Cortex enrichment): nobody is there to route for.

const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1'
const DEFAULT_JEV_MODEL = 'jev-latest'
const MAX_PROMPT_CHARS = 8000
const MIN_PROMPT_CHARS = 15
const BAR_CELLS = 10

export { MODELS }

export const EFFORTS = ['low', 'medium', 'high', 'max']

type Question = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type Questions = { modello: Question; effort: Question }

// Used when prompts/questions.json is missing or malformed: routing keeps working, /jev-last says so.
const FALLBACK_QUESTIONS: Questions = {
  modello: {
    type: 'choice',
    instructions: 'Quale modello Claude conviene usare per questa richiesta dell\'utente?',
    criteria: { haiku: 'Richieste semplici e meccaniche.', sonnet: 'Lavoro di sviluppo ordinario.', opus: 'Compiti difficili o ad alto rischio.' },
  },
  effort: {
    type: 'choice',
    instructions: 'Quanto deve ragionare il modello per questa richiesta dell\'utente?',
    criteria: { low: 'Nessun ragionamento necessario.', medium: 'Ragionamento moderato.', high: 'Ragionamento approfondito.', max: 'Ragionamento massimo.' },
  },
}

function isQuestion(value: unknown): value is Question {
  if (!value || typeof value !== 'object') return false
  const q = value as { type?: unknown; instructions?: unknown; criteria?: unknown }
  if (q.type !== 'choice' || typeof q.instructions !== 'string' || !q.criteria || typeof q.criteria !== 'object') return false
  return Object.values(q.criteria).every(text => typeof text === 'string')
}

// Read on every prompt (the file is small), so an edit to prompts/questions.json applies from the next prompt.
export async function loadQuestions($: any): Promise<{ questions: Questions; source: 'file' | 'fallback' }> {
  try {
    const path = `${$.plugin.root}/prompts/questions.json`
    if (await $.fs.exists(path)) {
      const parsed = JSON.parse(String(await $.fs.read(path)))
      if (isQuestion(parsed?.modello) && isQuestion(parsed?.effort)) return { questions: parsed, source: 'file' }
    }
  } catch {
    // Malformed JSON or unreadable file: the fallback below.
  }
  return { questions: FALLBACK_QUESTIONS, source: 'fallback' }
}

const route = atom({ plugin: 'jev-router', key: 'route' } as const, null as Route | null)
const lastRun = atom({ plugin: 'jev-router', key: 'lastRun' } as const, null as Run | null)
const sticky = atom({ plugin: 'jev-router', key: 'sticky' } as const, null as Sticky | null)
const arm = atom({ plugin: 'jev-router', key: 'arm' } as const, null as Arm | null)

const PREVIEW_CHARS = 80

function preview(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CHARS ? flat.slice(0, PREVIEW_CHARS - 1) + '…' : flat
}

function num(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// Calls Jev and records the raw answer in a Run (failures included). Never throws: the prompt is
// never held up by Jev for longer than the timeout.
async function askJev($: any, text: string, timeoutMs: number): Promise<Run> {
  const startedAt: number = await $.clock.now()
  const run: Run = { at: startedAt, prompt: preview(text), jevModel: '', outcome: 'no-key', latencyMs: 0 }

  try {
    const key = await $.env.get('TYPESAFE_API_KEY')
    const baseUrl = ((await $.env.get('TYPESAFE_BASE_URL')) || DEFAULT_BASE_URL).replace(/\/+$/, '')
    run.jevModel = (await $.env.get('JEV_MODEL')) || DEFAULT_JEV_MODEL
    const { questions, source } = await loadQuestions($)
    run.promptSource = source

    if (key) {
      const request = $.http.fetch(`${baseUrl}/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: run.jevModel,
          state: { richiesta: text.slice(0, MAX_PROMPT_CHARS) },
          questions,
        }),
      })
      const timeout = $.clock.sleep(timeoutMs).then(() => undefined)
      const res = await Promise.race([request, timeout])

      if (!res) {
        run.outcome = 'timeout'
      } else {
        run.httpStatus = res.status
        if (!res.ok) {
          run.outcome = 'http-error'
        } else {
          const body = JSON.parse(res.text)
          const answer = body?.answers?.modello
          const effortAnswer = body?.answers?.effort
          run.usage = body?.usage
          run.choice = answer?.choice
          run.confidence = Number(answer?.confidence ?? 0)
          run.probabilities = answer?.probabilities
          run.effortChoice = effortAnswer?.choice
          run.effortConfidence = Number(effortAnswer?.confidence ?? 0)
          run.effortProbabilities = effortAnswer?.probabilities
          // Refined by the caller once the policy has decided; this marks a usable answer.
          run.outcome = MODELS[answer?.choice] || EFFORTS.includes(effortAnswer?.choice) ? 'low-confidence' : 'bad-response'
        }
      }
    }
  } catch (error) {
    run.outcome = run.httpStatus ? 'bad-response' : 'http-error'
    run.error = String((error as Error)?.message ?? error)
  }

  run.latencyMs = (await $.clock.now()) - startedAt
  return run
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  routed: 'applicato',
  'low-confidence': 'nulla da applicare (confidenza bassa, stesso modello o sessione di controllo)',
  'no-key': 'TYPESAFE_API_KEY non impostata: Jev non è stato chiamato',
  timeout: 'timeout: resta il modello della sessione',
  'http-error': 'errore nella chiamata: resta il modello della sessione',
  'bad-response': 'risposta non valida o scelta sconosciuta: resta il modello della sessione',
}

const WHY_LABEL: Record<string, string> = {
  first: 'primo prompt della sessione',
  compact: 'dopo /clear o /compact',
  cold: 'cache scaduta',
  upgrade: 'upgrade sicuro',
  'cheap-rewrite': 'riscrittura economica',
  'cache-warm': 'cache calda, cambio troppo caro',
  'cache-full': 'cache piena',
  same: 'già sul modello scelto',
  'low-confidence': 'confidenza bassa',
  'no-answer': 'nessuna scelta di modello',
  control: 'sessione di controllo (A/B)',
  refused: '/model rifiutato',
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s fa`
  if (s < 3600) return `${Math.floor(s / 60)}min fa`
  return `${Math.floor(s / 3600)}h fa`
}

function describeRoute(r: { model?: string; effort?: string }) {
  return [r.model, r.effort && `effort ${r.effort}`].filter(Boolean).join(' · ')
}

function pushProbabilities(
  lines: string[],
  title: string,
  choice: string | undefined,
  confidence: number | undefined,
  probabilities: Record<string, number> | undefined,
  detail?: (alias: string) => string | undefined,
) {
  if (!probabilities) return
  const rows = Object.entries(probabilities).sort((a, b) => b[1] - a[1])
  const width = Math.max(...rows.map(([alias]) => alias.length))
  lines.push(`${title}: ${choice} · confidenza ${Math.round((confidence ?? 0) * 100)}%`)
  for (const [alias, p] of rows) {
    const filled = Math.round(p * BAR_CELLS)
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
    const extra = detail?.(alias) ? `  ${detail(alias)}` : ''
    lines.push(`  ${alias.padEnd(width)}  ${bar} ${String(Math.round(p * 100)).padStart(3)}%${extra}`)
  }
}

export function formatRun(run: Run | null, now: number, pinned?: Sticky | null) {
  if (!run) return 'Jev: nessun run in questa sessione. Invia un prompt di almeno ' + MIN_PROMPT_CHARS + ' caratteri (non un comando /).'

  const when = new Date(run.at).toLocaleTimeString('it-IT')
  const lines = [
    `Jev · ultimo run alle ${when} (${ago(now - run.at)}, ${run.latencyMs} ms)${run.arm ? ` · sessione ${run.arm === 'control' ? 'di controllo' : 'jev'}` : ''}`,
    `Prompt: "${run.prompt}"`,
    `Esito: ${OUTCOME_LABEL[run.outcome]}${run.outcome === 'routed' ? ` su ${describeRoute(run)}` : ''}`,
  ]
  if (run.decision) {
    const d = run.decision
    const target = d.alias ? ` ${d.alias}` : ''
    const cost = d.estUsd ? ` (riscrittura stimata ${usd(d.estUsd)})` : ''
    lines.push(`Modello: ${d.action}${target}: ${WHY_LABEL[d.why] ?? d.why}${cost}`)
  }
  if (pinned) lines.push(`Sticky: ${pinned.alias} (${pinned.model}) dal ${new Date(pinned.setAt).toLocaleTimeString('it-IT')}, ${WHY_LABEL[pinned.why] ?? pinned.why}, via ${pinned.mechanism === 'command' ? '/model' : 'override per turno'}${pinned.error ? ` (${pinned.error})` : ''}`)
  if (run.contextTokens) lines.push(`Contesto: ${Math.round(run.contextTokens / 1000)}k token`)
  if (run.httpStatus) lines.push(`HTTP ${run.httpStatus} · modello Jev ${run.jevModel}`)
  if (run.error) lines.push(`Errore: ${run.error}`)
  if (run.promptSource === 'fallback') lines.push('Domande Jev: fallback (prompts/questions.json mancante o non valido)')

  pushProbabilities(lines, 'Modello', run.choice, run.confidence, run.probabilities, alias => MODELS[alias])
  pushProbabilities(lines, 'Effort', run.effortChoice, run.effortConfidence, run.effortProbabilities)
  if (run.usage) lines.push(`Token Jev: ${run.usage.input_tokens ?? '?'} in / ${run.usage.output_tokens ?? '?'} out`)
  return lines.join('\n')
}

function today(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

// `$.fs.write` replaces a file: one log per day, read and rewritten with the new line appended.
async function appendLog($: any, line: object) {
  try {
    const now: number = await $.clock.now()
    const path = `${$.plugin.root}/data/decisions-${today(now)}.jsonl`
    const before = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    await $.fs.write(path, before + JSON.stringify(line) + '\n')
  } catch {
    // Logging is best-effort: it never holds up a turn.
  }
}

// Read by the status line script (statusline/cockpit.js), keyed by session so other sessions ignore it.
async function writeStatus($: any, status: object) {
  try {
    await $.fs.write(`${$.plugin.root}/data/status.json`, JSON.stringify(status))
  } catch {}
}

export const register: Register = (on, options) => {
  const policy: Policy = {
    ...DEFAULT_POLICY,
    minConfidence: num(options?.minConfidence, DEFAULT_POLICY.minConfidence),
    upgradeConfidence: num(options?.upgradeConfidence, DEFAULT_POLICY.upgradeConfidence),
    downgradeMaxUsd: num(options?.downgradeMaxUsd, DEFAULT_POLICY.downgradeMaxUsd),
    cacheFullTokens: num(options?.cacheFullTokens, DEFAULT_POLICY.cacheFullTokens),
  }
  const timeoutMs = num(options?.timeoutMs, 3000)
  const controlRate = num(options?.controlRate, 0.1)
  const subagentMap = parseSubagentModels(options?.subagentModels)

  let headless = false
  let pendingEffort: { effort: string; confidence: number } | undefined
  let pendingRoute: Route | undefined
  let pendingRun: Run | undefined
  const turns = new Map<string, { effort?: string; model?: string; run?: Run }>()
  const agentSources = new Map<string, string>()
  // Module memory: a hot reload forgets it, and the next prompt then counts as cold, which only
  // allows one harmless re-decision.
  const session: Session = { contextTokens: 0, compacted: false }

  on('session.start', async ($, e, next) => {
    headless = !e.surface || !e.isInteractive || (await $.env.get('CORTEX_ENRICH')) === '1'
    await $.command.register({
      name: 'jev-last',
      description: "Mostra l'ultima chiamata a Jev: esito, scelta, modello sticky e probabilità",
    })
    if (!headless) {
      const current = await read($, arm)
      if (!current) await update($, arm, () => pickArm(Math.random(), controlRate))
      const pinned = await read($, sticky)
      if (pinned) session.sticky = pinned.alias
    }
    return next(e)
  })

  on('command.run', { command: 'jev-last' }, async $ => {
    return { text: formatRun(await read($, lastRun), await $.clock.now(), await read($, sticky)) }
  })

  // /clear and /compact empty the main cache: the next prompt is a reset point.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) session.compacted = true
    return result
  })
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'compact') session.compacted = true
    return next(e)
  })
  // Where an organization manages Claude Code the two hooks above may not run: the commands themselves still do.
  for (const command of ['clear', 'compact']) {
    on('command.run', { command }, async ($, e, next) => {
      const result = await next(e)
      session.compacted = true
      return result
    })
  }

  on('prompt.submit', async ($, e, next) => {
    pendingEffort = undefined
    pendingRoute = undefined
    pendingRun = undefined
    const text = e.text
    if (headless || e.origin.kind !== 'composer' || text.length < MIN_PROMPT_CHARS || text.startsWith('/')) return next(e)

    try {
      const run = await askJev($, text, timeoutMs)
      const sessionArm: Arm = (await read($, arm)) ?? 'jev'
      const now: number = await $.clock.now()
      run.arm = sessionArm
      run.contextTokens = session.contextTokens

      const usable = run.outcome === 'low-confidence'
      const decision: ModelDecision = usable
        ? decideModel(session, run.choice, run.confidence ?? 0, now, policy)
        : { action: 'keep', why: 'no-answer' }
      run.decision = { ...decision }
      const routed: Route = {}

      if (usable && sessionArm === 'control') {
        run.decision = { ...decision, why: decision.action === 'keep' ? decision.why : 'control', action: 'keep' }
      } else if (usable) {
        const effort = EFFORTS.includes(run.effortChoice ?? '') ? run.effortChoice : undefined
        if (effort && (run.effortConfidence ?? 0) >= policy.minConfidence) {
          pendingEffort = { effort, confidence: run.effortConfidence ?? 0 }
          run.effort = effort
          routed.effort = effort
          routed.effortConfidence = run.effortConfidence
        }
        if (decision.action === 'set') {
          // Per-turn override only: Jev never runs /model, so the session default is never rewritten.
          const pinned: Sticky = { alias: decision.alias, model: MODELS[decision.alias] ?? decision.alias, setAt: now, why: decision.why, mechanism: 'override' }
          await update($, sticky, () => pinned)
          session.sticky = decision.alias
          run.model = pinned.model
          routed.alias = decision.alias
          routed.model = pinned.model
          routed.confidence = run.confidence
          $.ui.toast(`Jev → ${decision.alias} (${WHY_LABEL[decision.why] ?? decision.why})`)
        } else if (decision.action === 'suggest') {
          routed.suggest = decision.alias
          routed.suggestUsd = decision.estUsd
        }
        if (run.model || run.effort) run.outcome = 'routed'
      }
      // The policy has looked at the session as it was: a /clear or /compact is used up now.
      if (usable) session.compacted = false

      pendingRun = run
      pendingRoute = routed.effort || routed.model || routed.suggest ? routed : undefined
      await update($, lastRun, () => run).catch(() => undefined)
      const pinned = await read($, sticky)
      await writeStatus($, {
        sessionId: await $.session.id(),
        arm: sessionArm,
        sticky: pinned?.alias,
        effort: run.effort,
        at: now,
      })
    } catch {
      // Fail-open: whatever went wrong, the prompt goes on with the session's settings.
    }
    return next(e)
  })

  // prompt.submit's next(e) starts the turn, so the decision is pending exactly when it begins.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      if (e.text) {
        const pinned = await read($, sticky)
        turns.set(e.turnId, {
          effort: pendingEffort?.effort,
          // Only the fallback needs a per-turn model: with /model the session already runs on it.
          model: pinned?.mechanism === 'override' ? pinned.model : undefined,
          run: pendingRun,
        })
      }
      // A main turn without text (a command, a hand-back) clears the band; a subagent's turn leaves it alone.
      await update($, route, () => (e.text ? pendingRoute ?? null : null))
    }
    pendingEffort = undefined
    pendingRoute = undefined
    pendingRun = undefined
    return next(e)
  })

  // turn.step streams the response, so its hook must be an async generator forwarding next's chunks.
  on('turn.step', async function* ($, e, next) {
    const current = e.agentId ? undefined : turns.get(e.turnId)
    if (!current || (!current.model && !current.effort)) return yield* next(e)
    // effort is dropped by the engine for a model that takes none, so it is safe to set whichever model runs.
    return yield* next({
      ...e,
      ...(current.model ? { model: current.model } : {}),
      ...(current.effort ? { effort: current.effort as 'low' | 'medium' | 'high' | 'max' } : {}),
    })
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      const now: number = await $.clock.now()
      session.lastResponseAt = now
      const tokens = contextTokensOf(e.usage)
      if (tokens !== undefined) session.contextTokens = tokens
      const t = turns.get(e.turnId)
      if (t?.run && !headless) {
        await appendLog($, {
          at: now,
          sessionId: await $.session.id(),
          arm: t.run.arm,
          outcome: t.run.outcome,
          choice: t.run.choice,
          confidence: t.run.confidence,
          effortChoice: t.run.effortChoice,
          effortConfidence: t.run.effortConfidence,
          decision: t.run.decision,
          appliedEffort: t.effort,
          model: e.usage?.model,
          contextBefore: t.run.contextTokens,
          usage: e.usage,
          durationMs: e.durationMs,
          reason: e.reason,
          latencyMs: t.run.latencyMs,
        })
      }
    }
    turns.delete(e.turnId)
    return result
  })

  on('agent.offer', async ($, e, next) => {
    agentSources.set(e.agent, e.source)
    return next(e)
  })

  // A subagent's cache is its own: choosing its model costs no rewrite of the main one.
  on('agent.spawn', async ($, e, next) => {
    if (headless) return next(e)
    const alias = subagentModel(e.subagentType, e.model, agentSources.get(e.subagentType), subagentMap)
    return alias ? next({ ...e, model: alias }) : next(e)
  })

}
