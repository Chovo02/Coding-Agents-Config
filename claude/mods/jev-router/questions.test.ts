import { expect, test } from 'claude-code/testing'

import { loadQuestions } from './hooks/register'

// A stand-in for the engine's `$` with only what loadQuestions touches: the plugin root and the fs.
function fakeEngine(files: Record<string, string>) {
  return {
    plugin: { root: 'ROOT' },
    fs: {
      exists: async (path: string) => path in files,
      read: async (path: string) => files[path],
    },
  }
}

const VALID = JSON.stringify({
  modello: { type: 'choice', instructions: 'Scegli.', criteria: { haiku: 'a', sonnet: 'b', opus: 'c' } },
  effort: { type: 'choice', instructions: 'Scegli.', criteria: { low: 'a', medium: 'b', high: 'c', max: 'd' } },
})

test('the questions come from prompts/questions.json when it is valid', async () => {
  const r = await loadQuestions(fakeEngine({ 'ROOT/prompts/questions.json': VALID }))
  expect(r.source).toBe('file')
  expect(r.questions.modello.criteria.opus).toBe('c')
})

test('a missing questions file falls back, and says so', async () => {
  const r = await loadQuestions(fakeEngine({}))
  expect(r.source).toBe('fallback')
  expect(Object.keys(r.questions.effort.criteria)).toEqual(['low', 'medium', 'high', 'max'])
})

test('malformed JSON or a wrong shape falls back', async () => {
  expect((await loadQuestions(fakeEngine({ 'ROOT/prompts/questions.json': '{ not json' }))).source).toBe('fallback')
  const noEffort = JSON.stringify({ modello: JSON.parse(VALID).modello })
  expect((await loadQuestions(fakeEngine({ 'ROOT/prompts/questions.json': noEffort }))).source).toBe('fallback')
  const badCriteria = JSON.stringify({ ...JSON.parse(VALID), effort: { type: 'choice', instructions: 'x', criteria: { low: 1 } } })
  expect((await loadQuestions(fakeEngine({ 'ROOT/prompts/questions.json': badCriteria }))).source).toBe('fallback')
})
