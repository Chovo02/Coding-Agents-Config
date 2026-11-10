import { expect, mock, test } from 'claude-code/testing'

test('/jev-last says so when Jev has not been called yet', async ($, on) => {
  mock.clock(on)
  mock.env(on, {})

  const { text } = await $.command.run({ command: 'jev-last' })

  expect(text).toContain('nessun run')
})
