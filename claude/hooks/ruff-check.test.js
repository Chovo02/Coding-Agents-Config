// Run: node --test claude/hooks/ruff-check.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { targetFile, review } = require('./ruff-check.js');

const call = (tool_name, file_path) => ({ tool_name, tool_input: { file_path } });

test('targetFile: only .py written by Write/Edit/MultiEdit', () => {
  assert.strictEqual(targetFile(call('Write', '/repo/train.py')), '/repo/train.py');
  assert.strictEqual(targetFile(call('Edit', 'C:\\repo\\src\\a.PY')), 'C:\\repo\\src\\a.PY');
  assert.strictEqual(targetFile(call('MultiEdit', '/repo/x.py')), '/repo/x.py');
});

test('targetFile: ignores notebooks, other files, other tools, vendored dirs', () => {
  assert.strictEqual(targetFile(call('Write', '/repo/eda.ipynb')), null);
  assert.strictEqual(targetFile(call('Write', '/repo/README.md')), null);
  assert.strictEqual(targetFile(call('Read', '/repo/train.py')), null);
  assert.strictEqual(targetFile(call('Edit', '/repo/.venv/lib/site-packages/x.py')), null);
  assert.strictEqual(targetFile(call('Edit', 'C:\\repo\\node_modules\\p\\x.py')), null);
  assert.strictEqual(targetFile({ tool_name: 'Edit', tool_input: {} }), null);
  assert.strictEqual(targetFile(null), null);
});

const present = () => true;

test('review: violations (ruff status 1) -> code 2 with report', () => {
  const run = () => ({ status: 1, stdout: 'train.py:3:1: F401 `os` imported but unused\n', stderr: '' });
  const r = review('/nonexistent-dir/train.py', run, present);
  assert.strictEqual(r.code, 2);
  assert.match(r.message, /F401/);
  assert.match(r.message, /not auto-fixed/);
});

test('review: clean file (status 0) -> code 0', () => {
  const run = () => ({ status: 0, stdout: 'All checks passed!\n', stderr: '' });
  assert.strictEqual(review('/nonexistent-dir/ok.py', run, present).code, 0);
});

test('review: ruff internal/config error (status 2) -> fail-open', () => {
  const run = () => ({ status: 2, stdout: '', stderr: 'invalid config' });
  assert.strictEqual(review('/nonexistent-dir/a.py', run, present).code, 0);
});

test('review: ruff not installed / timeout -> fail-open', () => {
  const run = () => ({ error: new Error('ENOENT') });
  assert.strictEqual(review('/nonexistent-dir/a.py', run, present).code, 0);
});

// A project dir with uv.lock, so review() tries `uv run ruff` first and then global `ruff`.
function uvProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruffhook-'));
  fs.writeFileSync(path.join(dir, 'uv.lock'), '');
  return { dir, file: path.join(dir, 'train.py'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('review: uv exits 2 (ruff not in project env) -> falls back to global ruff', () => {
  const p = uvProject();
  try {
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd);
      return cmd === 'uv' ? { status: 2, stdout: '', stderr: 'Failed to spawn: ruff' } : { status: 1, stdout: 'train.py:1:1: F401 x\n' };
    };
    const r = review(p.file, run, present);
    assert.deepStrictEqual(calls, ['uv', 'ruff']);
    assert.strictEqual(r.code, 2);
    assert.match(r.message, /F401/);
  } finally {
    p.cleanup();
  }
});

test('review: uv clean (status 0) is final, global ruff is not run', () => {
  const p = uvProject();
  try {
    const calls = [];
    const run = (cmd) => (calls.push(cmd), { status: 0, stdout: '' });
    assert.strictEqual(review(p.file, run, present).code, 0);
    assert.deepStrictEqual(calls, ['uv']);
  } finally {
    p.cleanup();
  }
});

test('review: attempts share one time budget (never more than 8 s in total)', () => {
  const p = uvProject();
  try {
    let t = 0;
    const now = () => t;
    const timeouts = [];
    const run = (cmd, args, cwd, timeoutMs) => {
      timeouts.push(timeoutMs);
      t += timeoutMs; // the attempt consumes everything it was given (timeout)
      return { error: new Error('ETIMEDOUT') };
    };
    const r = review(p.file, run, present, now);
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(timeouts, [8000]); // budget spent: global ruff is not attempted
    assert.ok(timeouts.reduce((a, b) => a + b, 0) <= 8000);
  } finally {
    p.cleanup();
  }
});

test('review: remaining budget shrinks for the next attempt', () => {
  const p = uvProject();
  try {
    let t = 0;
    const now = () => t;
    const timeouts = [];
    const run = (cmd, args, cwd, timeoutMs) => {
      timeouts.push(timeoutMs);
      t += 3000;
      return { status: 2 };
    };
    review(p.file, run, present, now);
    assert.deepStrictEqual(timeouts, [8000, 5000]);
  } finally {
    p.cleanup();
  }
});

test('review: missing file -> code 0 without running ruff', () => {
  let ran = false;
  const run = () => ((ran = true), { status: 1, stdout: 'x' });
  assert.strictEqual(review('/nonexistent-dir/gone.py', run, () => false).code, 0);
  assert.strictEqual(ran, false);
});

test('review: never passes --fix or format', () => {
  const seen = [];
  const run = (cmd, args) => (seen.push([cmd, ...args].join(' ')), { status: 0, stdout: '' });
  review('/nonexistent-dir/a.py', run, present);
  assert.ok(seen.length >= 1);
  for (const s of seen) {
    const tokens = s.split(' ');
    assert.ok(tokens.includes('--no-fix'));
    for (const bad of ['--fix', 'format', '--unsafe-fixes']) assert.ok(!tokens.includes(bad), bad);
  }
});

test('CLI: exit 0 on garbage input, non-python file and notebook', () => {
  const script = path.join(__dirname, 'ruff-check.js');
  const feed = (input) => spawnSync(process.execPath, [script], { input, encoding: 'utf8' });
  assert.strictEqual(feed('not json').status, 0);
  assert.strictEqual(feed(JSON.stringify(call('Write', '/repo/a.ipynb'))).status, 0);
  assert.strictEqual(feed(JSON.stringify(call('Write', '/repo/a.txt'))).status, 0);
});
