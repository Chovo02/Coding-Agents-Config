#!/usr/bin/env node
// Cockpit: status line di Claude Code costruita solo sui campi JSON nativi (nessuna rete).
// Uso:  node cockpit.js              → riga principale (statusLine)
//       node cockpit.js --subagent   → righe dei subagent (subagentStatusLine), una JSON line per task
// Fail-safe: con input illeggibile stampa il minimo invece di lanciare.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const C = {
  accent: '\x1b[38;2;168;130;255m',
  dim: '\x1b[38;2;140;134;160m',
  ok: '\x1b[38;2;74;222;128m',
  warn: '\x1b[38;2;251;191;36m',
  bad: '\x1b[38;2;248;113;113m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
}
const SEP = `${C.dim} · ${C.reset}`
const JEV_STATUS = path.join(os.homedir(), '.claude', 'mods', 'jev-router', 'data', 'status.json')
const GIT_CACHE_MS = 5000

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return {} }
}

// 'claude-opus-5-5' → 'opus-5.5'; fallback al display_name.
function shortModel(id, display) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || '')
  if (!m) return display || id || '?'
  return `${m[1]}-${m[2]}${m[3] ? '.' + m[3] : ''}`
}

function modelColor(id) {
  if (/opus|fable/.test(id || '')) return C.accent
  if (/haiku/.test(id || '')) return C.ok
  return ''
}

function pctColor(p, amber, red) {
  return p >= red ? C.bad : p >= amber ? C.warn : C.ok
}

// Branch e commit avanti rispetto all'upstream, con cache su file per non lanciare git a ogni refresh.
function gitInfo(dir) {
  if (!dir) return null
  const key = Buffer.from(dir).toString('base64url').slice(0, 40)
  const cacheFile = path.join(os.tmpdir(), `cockpit-git-${key}.json`)
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (Date.now() - c.at < GIT_CACHE_MS) return c.info
  } catch {}
  let info = null
  try {
    const opts = { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500, windowsHide: true }
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).toString().trim()
    let ahead = 0
    try { ahead = Number(execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], opts).toString().trim()) || 0 } catch {}
    info = { branch, ahead }
  } catch {}
  try { fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), info })) } catch {}
  return info
}

function hhmm(epochSec) {
  if (!epochSec) return ''
  const d = new Date(epochSec * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function readJev() {
  try { return JSON.parse(fs.readFileSync(JEV_STATUS, 'utf8')) } catch { return null }
}

function main(d) {
  const parts = []
  const dir = d.workspace?.current_dir || d.cwd
  const git = gitInfo(dir)
  const where = path.basename(dir || '') + (git?.branch ? ` ${C.dim}${git.branch}${git.ahead ? ` ↑${git.ahead}` : ''}${C.reset}` : '')
  parts.push(`${C.bold}${where}${C.reset}`)

  const id = d.model?.id
  const effort = d.effort?.level
  parts.push(`${modelColor(id)}${shortModel(id, d.model?.display_name)}${C.reset}${effort ? ` ${C.dim}${effort}${C.reset}` : ''}`)

  const ctx = d.context_window?.used_percentage
  if (ctx != null) parts.push(`ctx ${pctColor(ctx, 70, 85)}${Math.round(ctx)}%${C.reset}`)

  const cost = d.cost?.total_cost_usd
  if (cost != null) parts.push(`$${cost.toFixed(2)}`)

  const pc = d.prompt_cache
  if (pc && pc.hit_ratio != null) {
    const warm = pc.warm === false ? `${C.bad}cold${C.reset}` : `${C.dim}warm${C.reset}`
    parts.push(`cache ${pctColor(100 - pc.hit_ratio * 100, 10, 25)}${Math.round(pc.hit_ratio * 100)}%${C.reset} ${warm}`)
  }

  const rl = d.rate_limits
  if (rl?.five_hour?.used_percentage != null) {
    const p = rl.five_hour.used_percentage
    parts.push(`5h ${pctColor(p, 70, 90)}${Math.round(p)}%${C.reset}${rl.five_hour.resets_at ? ` ${C.dim}↻${hhmm(rl.five_hour.resets_at)}${C.reset}` : ''}`)
  }
  if (rl?.seven_day?.used_percentage != null) {
    const p = rl.seven_day.used_percentage
    parts.push(`7g ${pctColor(p, 70, 90)}${Math.round(p)}%${C.reset}`)
  }

  // Jev scrive lo stato solo per la sessione che lo ha prodotto: niente dati di altre sessioni.
  const jev = readJev()
  if (jev && jev.sessionId === d.session_id) {
    const arm = jev.arm === 'control' ? `${C.warn}ctrl${C.reset}` : `${C.accent}jev${C.reset}`
    parts.push(`${arm}${jev.sticky ? ` ${C.dim}${jev.sticky}${C.reset}` : ''}`)
  }

  process.stdout.write(parts.join(SEP))
}

function sparkline(samples) {
  const bars = '▁▂▃▄▅▆▇█'
  const xs = (samples || []).slice(-8)
  if (xs.length < 2) return ''
  const lo = Math.min(...xs), hi = Math.max(...xs)
  return xs.map(x => bars[hi === lo ? 0 : Math.round(((x - lo) / (hi - lo)) * 7)]).join('')
}

function subagents(d) {
  for (const t of d.tasks || []) {
    const name = t.name || t.agentType || 'agent'
    const model = t.model ? `${modelColor(t.model)}${shortModel(t.model)}${C.reset}` : `${C.dim}…${C.reset}`
    const tokens = t.tokenCount != null ? `${Math.round(t.tokenCount / 1000)}k` : ''
    const ctx = t.contextWindowSize && t.tokenCount ? ` ${C.dim}${Math.round((t.tokenCount / t.contextWindowSize) * 100)}%${C.reset}` : ''
    const label = (t.label || t.description || '').slice(0, 50)
    const content = [`${C.bold}${name}${C.reset}`, model + (t.effort ? ` ${C.dim}${t.effort}${C.reset}` : ''), `${tokens}${ctx} ${C.dim}${sparkline(t.tokenSamples)}${C.reset}`, `${C.dim}${label}${C.reset}`].join(SEP)
    process.stdout.write(JSON.stringify({ id: t.id, content }) + '\n')
  }
}

const input = readStdin()
try {
  if (process.argv.includes('--subagent')) subagents(input)
  else main(input)
} catch {
  process.stdout.write(shortModel(input.model?.id, input.model?.display_name))
}
