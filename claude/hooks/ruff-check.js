#!/usr/bin/env node
// PostToolUse hook (matcher: Write|Edit|MultiEdit).
// After Claude writes a .py file, runs `ruff check` on that file only and, if there are
// violations, sends them back to Claude (exit 2 + report on stderr) so it can fix them.
// It never modifies anything: no --fix, no format. Notebooks (.ipynb) are ignored.
//
// Fail-open everywhere we cannot decide: unreadable input, non-Python file, file missing,
// ruff not installed, ruff itself erroring (bad config), timeout. Exit 0 = nothing to report.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const SKIP_DIRS = /(?:^|\/)(?:\.venv|venv|node_modules|site-packages|\.git)\//;
const RUFF_ARGS = ['check', '--no-fix', '--output-format', 'concise', '--'];
const TOTAL_BUDGET_MS = 8000; // shared by all attempts; the hook timeout in settings is 10 s

// Returns the absolute .py path to check, or null when this call is not our business.
function targetFile(input) {
  if (!input || !TOOLS.has(input.tool_name)) return null;
  const file = input.tool_input && input.tool_input.file_path;
  if (typeof file !== 'string' || !/\.py$/i.test(file)) return null;
  if (SKIP_DIRS.test(file.replace(/\\/g, '/'))) return null;
  return file;
}

// A uv project (uv.lock above the file) pins ruff in its own env: prefer `uv run`.
function hasUvLock(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'uv.lock'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// run(cmd, args, cwd, timeoutMs) -> spawnSync-like { status, stdout, stderr, error }
function defaultRun(cmd, args, cwd, timeoutMs) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs });
}

// Returns { code, message }: code 2 when ruff reports violations, else 0.
// Attempts run in order (uv-pinned ruff, then global ruff) under ONE shared time budget.
// Only status 0 (clean) or 1 (violations) is a verdict; spawn errors, timeouts and any other
// status (e.g. uv exit 2 because ruff is not in the project env) fall through to the next attempt.
function review(file, run = defaultRun, exists = fs.existsSync, now = Date.now) {
  if (!exists(file)) return { code: 0 };
  const root = hasUvLock(file);
  const attempts = [];
  if (root) attempts.push(['uv', ['run', '--no-sync', '--quiet', 'ruff', ...RUFF_ARGS, file], root]);
  attempts.push(['ruff', [...RUFF_ARGS, file], path.dirname(path.resolve(file))]);

  const deadline = now() + TOTAL_BUDGET_MS;
  for (const [cmd, args, cwd] of attempts) {
    const remaining = deadline - now();
    if (remaining <= 0) break; // budget spent: fail-open
    const r = run(cmd, args, cwd, remaining);
    if (r.error) continue;
    if (r.status === 1) {
      const out = String(r.stdout || '').trim();
      return { code: 2, message: `ruff check reported problems in ${file} (not auto-fixed):\n${out}\nFix them, then continue.` };
    }
    if (r.status === 0) return { code: 0 };
  }
  return { code: 0 };
}

module.exports = { targetFile, review };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const file = targetFile(input);
    if (!file) process.exit(0);
    const { code, message } = review(file);
    if (message) process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}
