import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_POLICY,
  cacheWriteUsd,
  contextTokensOf,
  decideModel,
  parseSubagentModels,
  pickArm,
  resetPoint,
  subagentModel,
} from './hooks/policy'

const HOUR = 60 * 60 * 1000
const warm = (sticky: string, contextTokens: number) => ({ sticky, contextTokens, compacted: false, lastResponseAt: 0 })
// The switch logic below is tested on large contexts: lift the cache-full gate so it does not mask them.
const UNCAPPED = { ...DEFAULT_POLICY, cacheFullTokens: Infinity }

test('the first prompt of a session sets the model, whatever the context', () => {
  const d = decideModel({ contextTokens: 0, compacted: false }, 'sonnet', 0.7, 0, DEFAULT_POLICY)
  expect(d).toMatchObject({ action: 'set', alias: 'sonnet', why: 'first' })
})

test('the first prompt sets the model even under the confidence floor', () => {
  const d = decideModel({ contextTokens: 0, compacted: false }, 'sonnet', 0.23, 0, DEFAULT_POLICY)
  expect(d).toMatchObject({ action: 'set', alias: 'sonnet', why: 'first' })
})

test('low confidence keeps the session model', () => {
  expect(decideModel(warm('opus', 1000), 'haiku', 0.5, 1, DEFAULT_POLICY)).toMatchObject({ action: 'keep', why: 'low-confidence' })
})

test('the same model is kept without a switch', () => {
  expect(decideModel(warm('sonnet', 150_000), 'sonnet', 0.99, 1, DEFAULT_POLICY)).toMatchObject({ action: 'keep', why: 'same' })
})

test('a downgrade on a large warm context is only suggested', () => {
  const d = decideModel(warm('opus', 150_000), 'sonnet', 0.95, 1000, UNCAPPED)
  expect(d).toMatchObject({ action: 'suggest', alias: 'sonnet', why: 'cache-warm' })
  // 150k tokens at Sonnet 5.5's 1h write price ($4/MTok) is $0.60.
  expect(Math.round((d as { estUsd: number }).estUsd * 100)).toBe(60)
})

test('a downgrade on a small context goes through', () => {
  // 10k tokens on Sonnet: $0.04 < $0.10.
  expect(decideModel(warm('opus', 10_000), 'sonnet', 0.7, 1000, DEFAULT_POLICY)).toMatchObject({ action: 'set', why: 'cheap-rewrite' })
})

test('an upgrade to opus needs the higher confidence on a warm cache', () => {
  expect(decideModel(warm('sonnet', 150_000), 'opus', 0.7, 1000, UNCAPPED)).toMatchObject({ action: 'suggest' })
  expect(decideModel(warm('sonnet', 150_000), 'opus', 0.85, 1000, UNCAPPED)).toMatchObject({ action: 'set', why: 'upgrade' })
})

test('a full cache keeps the model, upgrades and downgrades alike', () => {
  expect(decideModel(warm('sonnet', 150_000), 'opus', 0.95, 1000, DEFAULT_POLICY)).toMatchObject({ action: 'keep', why: 'cache-full' })
  expect(decideModel(warm('opus', 150_000), 'sonnet', 0.95, 1000, DEFAULT_POLICY)).toMatchObject({ action: 'keep', why: 'cache-full' })
})

test('just under the full threshold the switch logic applies as before', () => {
  expect(decideModel(warm('opus', 99_999), 'sonnet', 0.95, 1000, DEFAULT_POLICY)).toMatchObject({ action: 'suggest', why: 'cache-warm' })
})

test('a reset point beats the full-cache rule', () => {
  expect(decideModel({ ...warm('opus', 150_000), compacted: true }, 'sonnet', 0.95, 1, DEFAULT_POLICY)).toMatchObject({ action: 'set', why: 'compact' })
})

test('the full-cache threshold is configurable', () => {
  expect(decideModel(warm('sonnet', 60_000), 'opus', 0.95, 1000, { ...DEFAULT_POLICY, cacheFullTokens: 50_000 })).toMatchObject({ action: 'keep', why: 'cache-full' })
})

test('a cold cache or a /compact is a reset point', () => {
  expect(resetPoint(warm('opus', 150_000), HOUR + 1, HOUR)).toBe('cold')
  expect(resetPoint({ ...warm('opus', 150_000), compacted: true }, 1, HOUR)).toBe('compact')
  expect(resetPoint(warm('opus', 150_000), 1, HOUR)).toBeUndefined()
  expect(decideModel(warm('opus', 150_000), 'haiku', 0.7, HOUR + 1, DEFAULT_POLICY)).toMatchObject({ action: 'set', why: 'cold' })
})

test('cache write prices follow the model and the Haiku long-context tier', () => {
  expect(cacheWriteUsd('claude-opus-5-5', 1_000_000)).toBe(8)
  expect(cacheWriteUsd('claude-sonnet-5-5', 1_000_000)).toBe(4)
  expect(Math.round(cacheWriteUsd('claude-haiku-5-5', 50_000) * 1000)).toBe(10)
  expect(Math.round(cacheWriteUsd('claude-haiku-5-5', 200_000) * 1000)).toBe(200)
})

test('context tokens add every input part and the output', () => {
  expect(contextTokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 })).toBe(10)
  expect(contextTokensOf(undefined)).toBeUndefined()
})

test('only built-in subagents without an explicit model are mapped', () => {
  const map = { Explore: 'haiku', 'general-purpose': 'sonnet' }
  expect(subagentModel('general-purpose', undefined, 'built-in', map)).toBe('sonnet')
  expect(subagentModel('general-purpose', 'opus', 'built-in', map)).toBeUndefined()
  expect(subagentModel('Explore', undefined, 'userSettings', map)).toBeUndefined()
  expect(subagentModel('Plan', undefined, 'built-in', map)).toBeUndefined()
})

test('the subagent map ignores unknown aliases and bad JSON', () => {
  expect(parseSubagentModels('{"Explore":"haiku","x":"gpt"}')).toEqual({ Explore: 'haiku' })
  expect(parseSubagentModels('not json')).toEqual({})
})

test('the arm is control below the rate', () => {
  expect(pickArm(0.05, 0.1)).toBe('control')
  expect(pickArm(0.5, 0.1)).toBe('jev')
})
