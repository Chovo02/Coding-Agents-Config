# Coding-Agents-Config

Repo canonico delle config dei miei coding agent (oggi Claude Code; Codex e altri in futuro).
Gli script creano **symlink** da `~/.claude/...` verso questo repo: modificare un file da una parte lo modifica anche dall'altra.

## Nuova macchina
```bash
git clone <url> && cd Coding-Agents-Config
./install.sh [--dry-run] [--plugins]        # Linux / macOS
```
```powershell
./install.ps1 [-DryRun] [-Plugins]          # Windows (Developer Mode attivo, o admin)
```
Idempotenti: i file esistenti vengono spostati in `<nome>.bak-<timestamp>`. `--uninstall` rimuove i link e ripristina l'ultimo backup.

## Cosa è tracciato (`claude/`)
`CLAUDE.md`, `settings.<os>.json` (symlinkato come `settings.json`), `agents/`, `hooks/`, `statusline/`, `themes/`, `chrome/` (solo Windows), `skills/` propri (uno per uno: `skills/synced` resta locale), `plugins.json` (marketplace + plugin abilitati, installabili con `--plugins`), `mods/` (jev-router + flightdeck fork: versionati direttamente qui, nessun repo annidato; `data/` esclusa).

**Tooling ML** (derivato da fonti MIT, attribuzioni in `THIRD-PARTY-NOTICES.md` di ogni skill): skill `python-ml-tooling`, `ml-debugging`, `pandas-polars`, `ml-experiment-hygiene`; agent `ml-reviewer`; hook `hooks/ruff-check.js` (PostToolUse, solo `ruff check` su `.py`, mai `--fix`; test: `node --test claude/hooks/ruff-check.test.js`).

**Tooling generico** (stessa regola sulle attribuzioni): skill `changelog-release-notes`, `readme` (solo se richiesta), `api-security`, `docker-python`.

**Mod `flightdeck`**: è un fork locale (`claude/mods/flightdeck`, differisce dall'upstream in `plugin.json`, `hooks/core.ts`, `hooks/register.tsx` e nei test) caricato in-place da `CLAUDE_CODE_PLUGIN_DIRS`; compare in `claude plugin list` come `flightdeck@inline`. La voce `flightdeck@claude-flightdeck: false` in `enabledPlugins` riguarda solo la copia upstream del marketplace e va lasciata disabilitata. Per spegnere il fork serve `"flightdeck@inline": false`.

## Cosa NON è tracciato
Credenziali, `~/.claude.json`, history, sessioni, `projects/`, `plugins/` (cache), backup, file-history: runtime o segreti (vedi `.gitignore`).

## Note per OS
- `settings.linux/macos.json` derivano da quello Windows senza gli hook `coucou-hook.exe` e senza `CLAUDE_CODE_PLUGIN_DIRS` / marketplace `cortex` (path locali Windows): da impostare a mano per macchina.
- I marketplace di tipo `directory` in `plugins.json` vengono saltati dallo script.

## Aggiungere una config
Metti il file in `claude/` (o `codex/`...) e aggiungi una riga `link` in `install.sh` e `install.ps1`.

