// Run: node --test claude/hooks/guard.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { decide } = require('./guard.js');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const read = (file_path) => ({ tool_name: 'Read', tool_input: { file_path } });

const BLOCK = [
  bash('rm -rf node_modules'),
  bash('rm -r -f build'),
  bash('rm --recursive --force x'),
  bash('/bin/rm -fr /tmp/x'),
  bash('bash -c "rm -rf x"'),
  bash('echo ok && rm -rf x'),
  bash('find . -name "*.tmp" -delete'),
  bash('git push --force origin main'),
  bash('git push -f'),
  bash('git push origin +main'),
  bash('git reset --hard HEAD~1'),
  bash('git clean -fd'),
  bash('cat .env'),
  bash('cat ./app/.env.local'),
  bash('type C:\\proj\\.env'),
  bash('cp key.pem /tmp'),
  bash('cat ~/.ssh/id_rsa'),
  bash('ls secrets/'),
  read('/repo/.env'),
  read('C:\\repo\\.env.production'),
  read('/repo/certs/server.key'),
  read('/repo/secrets/db.txt'),
  // case-insensitive (Windows)
  read('C:\\repo\\.ENV'),
  read('/repo/.Env.Local'),
  bash('cat .ENV'),
  bash('cat KEY.PEM'),
  // .key as a real file: path separator or file-reading command
  bash('cat server.key'),
  bash('cat ./certs/server.key'),
  bash('grep BEGIN ./certs/server.key'),
  // other tools
  { tool_name: 'Edit', tool_input: { file_path: '/repo/.env' } },
  { tool_name: 'Write', tool_input: { file_path: 'C:\\repo\\secrets\\a.txt' } },
  { tool_name: 'MultiEdit', tool_input: { file_path: '/repo/.env.production' } },
  { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/secrets/n.ipynb' } },
  { tool_name: 'Grep', tool_input: { pattern: 'KEY', path: '/repo/.env' } },
  { tool_name: 'Grep', tool_input: { pattern: 'KEY', glob: '**/.env*' } },
  { tool_name: 'Glob', tool_input: { pattern: '**/*.pem' } },
  { tool_name: 'Glob', tool_input: { pattern: 'secrets/**' } },
];

const ALLOW = [
  bash('rm file.txt'),
  bash('rm -r emptydir'),
  bash('git push origin main'),
  bash('git push --force-with-lease'),
  bash('git reset --soft HEAD~1'),
  bash('git status'),
  bash('cat .env.example'),
  bash('ls -la'),
  bash('npm run test'),
  read('/repo/README.md'),
  read('/repo/.env.example'),
  // `.key` as a JS/JSON property, not a file
  bash('node -e "console.log(cfg.key)"'),
  bash('grep foo obj.key'),
  bash('echo $obj.key'),
  { tool_name: 'Edit', tool_input: { file_path: '/repo/src/app.ts' } },
  { tool_name: 'Edit', tool_input: { file_path: '/repo/.env.example' } },
  { tool_name: 'Grep', tool_input: { pattern: 'TODO', path: '/repo/src' } },
  { tool_name: 'Glob', tool_input: { pattern: '**/*.ts' } },
  { tool_name: 'Glob', tool_input: { pattern: '**/.envrc-docs.md' } },
];

for (const i of BLOCK) {
  test(`blocks ${JSON.stringify(i.tool_input)}`, () => assert.ok(decide(i)));
}
for (const i of ALLOW) {
  test(`allows ${JSON.stringify(i.tool_input)}`, () => assert.strictEqual(decide(i), null));
}

const run = (stdin) =>
  spawnSync(process.execPath, [path.join(__dirname, 'guard.js')], { input: stdin, encoding: 'utf8' });

test('cli: exit 2 + reason on block', () => {
  const r = run(JSON.stringify(bash('rm -rf x')));
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /Blocked by guard\.js/);
});
test('cli: exit 0 on allow', () => assert.strictEqual(run(JSON.stringify(bash('ls'))).status, 0));
test('cli: malformed input fails open', () => assert.strictEqual(run('not json').status, 0));
