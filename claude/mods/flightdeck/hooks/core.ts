// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type {
  AgentCard,
  Architect,
  Layout,
  LogLine,
  Loop,
  Main,
  Moment,
  Receipt,
  Roster,
  ToolNote,
  Turn,
  Usage,
  View,
} from '../types'

export const SCHEMA_VERSION = 2

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false }
export const DEFAULT_USAGE: Usage = {
  pct: null,
  tokens: null,
  window: 0,
  costUsd: null,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
}
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
export const DEFAULT_TURN: Turn = { edits: 0, errorStreak: 0, errors: 0, isReviewing: false, startedAt: 0, costAtStart: null }
export const DEFAULT_VIEW: View = { expanded: null, detail: null, layout: null }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeCard = (stored: unknown): AgentCard =>
  normalize<AgentCard>(
    {
      id: '',
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      out: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
    },
    stored,
  )

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' ? l.kind : 'info',
  }))

// ---------------------------------------------------------------- config

export type Panel = 'main' | 'architect' | 'agents' | 'loops' | 'receipt' | 'log' | 'jev'
const PANELS: readonly Panel[] = ['main', 'architect', 'agents', 'loops', 'receipt', 'log', 'jev']

export type Config = {
  architect: RegExp
  architectLabel: string
  panels: Panel[]
  motion: boolean
  moments: boolean
  matchDescriptions: boolean
  maxCards: number
  layout: Layout
  palette: Palette
  openOnStart: boolean
  statusLine: boolean
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const panels = str('panels', PANELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = str('layout', 'auto')
  const max = typeof o.maxCards === 'number' ? Math.round(o.maxCards) : 3
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    architectLabel: str('architectLabel', 'ARCHITECT'),
    panels: panels.length > 0 ? [...new Set(panels)] : [...PANELS],
    motion: str('motion', 'while-active') !== 'off',
    moments: bool('moments', true),
    matchDescriptions: bool('matchDescriptions', false),
    maxCards: Math.min(6, Math.max(1, max)),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', true),
  }
}

// ---------------------------------------------------------------- palette

export type Palette = 'theme' | 'pastel'
export type Colors = Record<'main' | 'agent' | 'ok' | 'cleared' | 'arch' | 'jev' | 'amber' | 'warn' | 'dim' | 'faint' | 'text', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  theme: {
    main: 'claude',
    agent: 'suggestion',
    ok: 'success',
    cleared: 'permission',
    arch: 'merged',
    jev: 'remember',
    amber: 'warning',
    warn: 'error',
    dim: 'inactive',
    faint: 'subtle',
    text: 'text',
  },
  pastel: {
    main: '#7dd3fc',
    agent: '#93c5fd',
    ok: '#86efac',
    cleared: '#5eead4',
    arch: '#c4b5fd',
    jev: '#f0abfc',
    amber: '#fcd34d',
    warn: '#fca5a5',
    dim: '#6b7280',
    faint: '#3f4654',
    text: '#e5e7eb',
  },
}

/** SVG cannot name theme keys: mid-tone colours that read on light and dark backgrounds. */
export const SVG_COLORS = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }

// ---------------------------------------------------------------- formatting

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

export const kTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** The first letter of a label up: `effort` → `Effort`. Values inside a label are left as they are. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `1 Error`, `2 Errors`: a counted label, capitalised like the other labels. */
export const plural = (n: number, word: string) => `${n} ${cap(word)}${n === 1 ? '' : 's'}`

export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/** A gauge of `width` cells: ▰ filled, ▱ empty. */
export const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}

/** A rate-limit window's short name: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What a tool note may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

/** One line saying what a call was about: its command, path or pattern; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return redact(what ? `${tool} → ${what}` : tool)
}

// ---------------------------------------------------------------- turn and architect

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop, so delegated work still reaches "before done".
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** Which of the architect's three moments a consult falls at: an inference over this turn so far. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-40) }

/** Ends the open consult (the latest without an end), or the one named. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: a.consults.map(c => (c === open ? { ...c, endAt: at } : c)),
    lastAdvice: advice ?? a.lastAdvice,
  }
}

export const isAdvising = (a: Architect) => a.consults.some(c => c.endAt === null)

/** A one-row timeline of consults across `width` cells: ◆ a consult, ━ while it ran. */
export const consultTimeline = (a: Architect, now: number, width: number) => {
  if (a.consults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = a.consults[0]?.at ?? now
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of a.consults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string }): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  costDelta: o.costNow !== null && t.costAtStart !== null && o.costNow - t.costAtStart >= 0.005 ? o.costNow - t.costAtStart : null,
  reason: o.reason,
})

// ---------------------------------------------------------------- agents and loops

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input; output adds up. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

/** Every tool call the card has seen, up to 200; the inline card shows the last three, the detail pane all of them. */
export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({ ...c, tools: [...c.tools, n].slice(-200) })

export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  const found = loops.find(l => l.id === id)
  const next = found
    ? loops.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l))
    : [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  return next.slice(-60)
}

export const LOOP_ACTIVE_MS = 15_000
export const isLoopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS

/** Swimlane geometry: each agent's bar on one shared axis from the first spawn to now. */
export const lanes = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

// ---------------------------------------------------------------- jev

/** The last call jev-router made to Jev, as its `lastRun` state holds it; read, never written here. */
export type JevRun = {
  at: number
  prompt: string
  jevModel: string
  outcome: string
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
  contextTokens?: number
  /** Short labels jev-router wrote; the table below only covers runs saved before they existed. */
  outcomeLabel?: string
  whyLabel?: string
}

// Fallback for runs saved before jev-router wrote `outcomeLabel`.
const JEV_OUTCOMES: Record<string, string> = {
  routed: 'instradato',
  'low-confidence': 'confidenza sotto la soglia: resta il modello della sessione',
  'no-key': 'TYPESAFE_API_KEY non impostata: Jev non è stato chiamato',
  timeout: 'timeout: resta il modello della sessione',
  'http-error': 'errore nella chiamata: resta il modello della sessione',
  'bad-response': 'risposta non valida o scelta sconosciuta: resta il modello della sessione',
}

/** jev-router's run, or null when it has none (or is not installed, or saved another shape). */
export const normalizeJev = (raw: unknown): JevRun | null => {
  const r = raw as Partial<JevRun> | null | undefined
  if (!r || typeof r !== 'object' || typeof r.at !== 'number' || typeof r.outcome !== 'string') return null
  return { ...r, prompt: String(r.prompt ?? ''), jevModel: String(r.jevModel ?? ''), latencyMs: Number(r.latencyMs ?? 0) } as JevRun
}

/** The outcome line, as /jev-last words it. */
export const jevOutcome = (run: JevRun) => {
  const applied = run.outcome === 'routed' ? [run.model, run.effort && `effort ${run.effort}`].filter(Boolean).join(' · ') : ''
  return `${run.outcomeLabel ?? JEV_OUTCOMES[run.outcome] ?? run.outcome}${applied ? ` su ${applied}` : ''}`
}

/** One row per option Jev weighed, likeliest first, with a bar of `cells`. */
const jevRows = (probabilities: Record<string, number> | undefined, choice: string | undefined, cells: number) =>
  Object.entries(probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([alias, p]) => {
      const filled = Math.max(0, Math.min(cells, Math.round(p * cells)))
      return { alias, pct: Math.round(p * 100), bar: '█'.repeat(filled) + '░'.repeat(cells - filled), isChoice: alias === choice }
    })

/** One row per model Jev weighed, likeliest first, with a bar of `cells`. */
export const jevBars = (run: JevRun, cells: number) => jevRows(run.probabilities, run.choice, cells)

/** One row per effort level Jev weighed, likeliest first, with a bar of `cells`. */
export const jevEffortBars = (run: JevRun, cells: number) => jevRows(run.effortProbabilities, run.effortChoice, cells)

/** The options Jev weighed beside its choice, likeliest first, as `sonnet 5%`. */
export const jevAlternates = (probabilities: Record<string, number> | undefined, choice: string | undefined) =>
  Object.entries(probabilities ?? {})
    .filter(([alias]) => alias !== choice)
    .sort((a, b) => b[1] - a[1])
    .map(([alias, p]) => ({ alias, pct: Math.round(p * 100) }))

/** Cells of the effort meter, as the main panel draws it: `low` one, `max` four. */
export const jevEffortCells = (effort: string | undefined) => ({ low: 1, medium: 2, high: 3, xhigh: 4, max: 4 })[effort ?? ''] ?? 0

/** jev-router's `sticky` state: the model it last chose, and whether /model switched the session to it. */
export type JevSticky = { alias: string; model: string; mechanism: string; error?: string }

export const normalizeSticky = (raw: unknown): JevSticky | null => {
  const s = raw as Partial<JevSticky> | null | undefined
  if (!s || typeof s !== 'object' || typeof s.model !== 'string') return null
  return {
    alias: String(s.alias ?? ''),
    model: s.model,
    mechanism: String(s.mechanism ?? ''),
    error: typeof s.error === 'string' ? s.error : undefined,
  }
}

export type JevState = { kind: 'applied' | 'not-applied' | 'pending'; text: string }

/**
 * Whether Jev's decision reached the session. A model counts as applied once /model has switched
 * the session to it (`sticky.mechanism` 'command'); a refusal, or a switch that did not take, is
 * not applied; a decision whose turn has not ended yet is pending. An effort on its own rides the
 * turn's own override, and is taken as applied: the engine does not report back that it was used.
 */
export const jevState = (run: JevRun, sticky: JevSticky | null): JevState => {
  if (run.outcome !== 'routed') return { kind: 'not-applied', text: jevOutcome(run) }
  if (run.model) {
    const s = sticky && sticky.model === run.model ? sticky : null
    if (s?.error) return { kind: 'not-applied', text: `${prettyModel(run.model)} non attivato: ${s.error}` }
    if (s?.mechanism === 'command') {
      return { kind: 'applied', text: prettyModel(run.model) + (run.effort ? ` · effort ${run.effort}` : '') }
    }
    return { kind: 'pending', text: `${prettyModel(run.model)} attivo su questo turno, la sessione passa a fine turno` }
  }
  return { kind: 'applied', text: `effort ${run.effort ?? ''}`.trim() }
}

/** Rows the jev panel takes: borders, header, prompt, the state bar, then the why row, the model and effort rows when Jev weighed them, and an error line. */
export const jevPanelRows = (run: JevRun | null) =>
  run
    ? 5 + (run.whyLabel ? 1 : 0) + (run.probabilities ? 2 : 0) + (run.effortProbabilities ? 2 : 0) + (run.error ? 1 : 0)
    : 0

// ---------------------------------------------------------------- layout

/** How many log lines fit: what the other panels leave, never fewer than 4 nor more than 8. */
export const logRows = (bodyRows: number, used: number) => Math.max(4, Math.min(8, bodyRows - used - 3))

/** Legend items that fit on one row of `width` cells, in order; the rest are dropped. */
export const fitLegend = <T extends { label: string }>(items: T[], width: number) => {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const w = it.label.length + 4
    if (used + w > width) break
    out.push(it)
    used += w
  }
  return out
}

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  const cut = t.lastIndexOf(' ', first)
  const at = cut > 0 ? cut : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

/**
 * A subagent's hand-back message: who sent it and the first line of what it said. The report
 * follows a framing header in the message; without one, the first line after the opening tag.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}

/** The advice line a pane shows for a report: its first real line, markdown markers stripped, cut to 160. */
export const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt
