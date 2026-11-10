#!/usr/bin/env node
// PreToolUse enforcement hook (matcher: Bash|Read|Grep|Glob|Edit|Write|MultiEdit|NotebookEdit).
// Reads the hook JSON on stdin and blocks (exit 2 + reason on stderr) dangerous
// commands and secret-file access that permissions.deny patterns can miss
// (bash -c wrappers, absolute paths, cat .env, Grep on .env, ...). Exit 0 = allow.
//
// Note: this is a second safety net, not a sandbox. Fail-open on unreadable
// input (we cannot decide); every other path is deny-by-rule.
// Known limit: Grep/Glob without an explicit path/glob can still reach secrets
// inside the searched tree; permissions.deny and the sandbox cover that part.
'use strict';

// A "segment" is one simple command: no ; & | or newline inside.
const SEG = '[^;&|\\n]*';

const BASH_RULES = [
  {
    id: 'rm-recursive-force',
    re: new RegExp(`\\brm\\b(?=${SEG}\\s(?:-[a-zA-Z]*[rR]|--recursive))(?=${SEG}\\s(?:-[a-zA-Z]*f|--force))`),
    msg: 'rm recursive+force is blocked',
  },
  { id: 'find-delete', re: /\bfind\b[^;&|\n]*\s-delete\b/, msg: 'find -delete is blocked' },
  {
    id: 'git-push-force',
    re: new RegExp(`\\bgit\\b${SEG}\\bpush\\b${SEG}(?:\\s--force(?![-\\w])|\\s-[a-zA-Z]*f\\b|\\s\\+\\S)`),
    msg: 'git push --force is blocked (use --force-with-lease if really needed)',
  },
  { id: 'git-reset-hard', re: /\bgit\b[^;&|\n]*\breset\b[^;&|\n]*--hard\b/, msg: 'git reset --hard is blocked' },
  { id: 'git-clean-force', re: /\bgit\b[^;&|\n]*\bclean\b[^;&|\n]*\s-[a-zA-Z]*f/, msg: 'git clean -f is blocked' },
];

// Secret-looking path tokens inside a shell command (all case-insensitive:
// Windows filesystems ignore case).
const END = `(?=$|[\\s"';&|)])`;
const SECRET_TOKEN = [
  new RegExp(`(?:^|[\\s"'=\\/\\\\<>])\\.env(?:\\.[\\w.-]+)?(?=$|[\\s"'\\/\\\\;&|)])`, 'i'),
  new RegExp(`\\.(?:pem|p12|pfx)${END}`, 'i'),
  new RegExp(`(?:^|[\\s"'\\/\\\\])id_(?:rsa|ed25519|ecdsa)${END}`, 'i'),
  /(?:^|[\s"'\/\\])secrets[\/\\]/i,
];
const SECRET_ALLOW = /\.env\.(?:example|sample|template|dist)(?=$|[\s"';&|)])/gi;

// `.key` is also a common JS/JSON property (cfg.key), so it is only treated as a
// key file when the token has a path separator or the command reads/copies files.
const KEY_TOKEN = /[^\s"'=;&|()<>]*\.key(?=$|[\s"';&|)])/gi;
const FILE_READERS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'type', 'cp', 'mv', 'scp', 'rsync', 'xxd', 'strings',
  'base64', 'openssl', 'get-content', 'gc', 'curl', 'tar', 'zip', 'sed', 'awk', 'bat', 'nl', 'od',
]);

function keyFileInCommand(cmd) {
  for (const seg of cmd.split(/[;&|\n]+/)) {
    const toks = seg.trim().split(/\s+/);
    const first = (toks[0] || '').replace(/^.*[\/\\]/, '').toLowerCase();
    for (const m of seg.matchAll(KEY_TOKEN)) {
      if (/[\/\\~]/.test(m[0]) || FILE_READERS.has(first)) return true;
    }
  }
  return false;
}

function secretInCommand(cmd) {
  const cleaned = cmd.replace(SECRET_ALLOW, ' ');
  return SECRET_TOKEN.some((re) => re.test(cleaned)) || keyFileInCommand(cleaned);
}

// Also used for glob patterns (Glob/Grep), hence the optional wildcard after .env.
function secretPath(p) {
  const n = String(p).replace(/\\/g, '/');
  const base = n.split('/').pop();
  if (/^\.env\.(?:example|sample|template|dist)$/i.test(base)) return false;
  return (
    /^\.env(?:$|[.*?\[{])/i.test(base) ||
    /\.(?:pem|key|p12|pfx)[*?]*$/i.test(base) ||
    /^id_(?:rsa|ed25519|ecdsa)/i.test(base) ||
    /(?:^|\/)secrets\//i.test(n)
  );
}

// tool name -> input fields that hold a path or path glob
const PATH_FIELDS = {
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Grep: ['path', 'glob'],
  Glob: ['pattern', 'path'],
};

function decide(input) {
  const tool = input && input.tool_name;
  const args = (input && input.tool_input) || {};
  if (tool === 'Bash') {
    const cmd = String(args.command || '');
    for (const r of BASH_RULES) if (r.re.test(cmd)) return `${r.id}: ${r.msg}`;
    if (secretInCommand(cmd)) return 'secret-file: command references a secret file (.env, key, secrets/)';
  } else if (PATH_FIELDS[tool]) {
    for (const f of PATH_FIELDS[tool]) {
      if (args[f] && secretPath(args[f])) return `secret-file: ${tool} on a secret path is blocked`;
    }
  }
  return null;
}

module.exports = { decide };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.stderr.write('guard.js: unreadable hook input, allowing\n');
      process.exit(0);
    }
    const reason = decide(input);
    if (reason) {
      process.stderr.write(`Blocked by guard.js — ${reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
