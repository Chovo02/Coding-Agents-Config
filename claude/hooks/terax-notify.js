#!/usr/bin/env node
// Emits the Terax terminal-notification hook payload as properly JSON-encoded output.
// Usage: node terax-notify.js <attention|working|finished>
const label = process.argv[2] || '';
const seq = `\x1b]777;notify;Terax;${label}\x07`;
process.stdout.write(JSON.stringify({ terminalSequence: seq }));
