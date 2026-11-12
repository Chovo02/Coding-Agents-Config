import { expect, mock, test } from 'claude-code/testing'

const CORE = { plugin: 'engine', tier: 'core' } as const

function spawnInput(subagentType: string, model?: string) {
  return {
    tool_use_id: 't1', prompt: 'cerca i file', description: 'cerca', subagentType, provider: CORE,
    ...(model ? { model } : {}), parentModel: 'claude-opus-5-5', background: false, fork: false,
  } as never
}

test('a built-in general-purpose subagent without a model runs on sonnet', async ($, on) => {
  mock.env(on, {})
  on('agent.offer', async () => ({ isOffered: true }))
  on('agent.spawn', async ($, e) => ({ model: e.model ?? 'inherit' }))
  await $.agent.offer({ agent: 'general-purpose', description: '', source: 'built-in', provider: CORE } as never)
  const r = await $.agent.spawn(spawnInput('general-purpose'))
  expect(r).toMatchObject({ model: 'sonnet' })
})

test('an explicit subagent model is left alone', async ($, on) => {
  mock.env(on, {})
  on('agent.offer', async () => ({ isOffered: true }))
  on('agent.spawn', async ($, e) => ({ model: e.model ?? 'inherit' }))
  await $.agent.offer({ agent: 'general-purpose', description: '', source: 'built-in', provider: CORE } as never)
  const r = await $.agent.spawn(spawnInput('general-purpose', 'opus'))
  expect(r).toMatchObject({ model: 'opus' })
})

test('a headless session never calls Jev', async ($, on) => {
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'k' })
  let fetched = 0
  on('http.fetch', async () => { fetched++; return { status: 200, ok: true, headers: {}, text: '{}' } as never })
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', async ($, e) => ({ text: e.text }))
  await $.session.start({ cwd: 'C:/x', surface: null, isInteractive: false } as never)
  await $.prompt.submit({ text: 'implementa il parser dei log con test', wait: true, origin: { kind: 'composer' } } as never)
  expect(fetched).toBe(0)
})
