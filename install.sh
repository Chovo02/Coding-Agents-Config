#!/usr/bin/env bash
# Symlink delle config degli agent dal repo verso la home. Linux/macOS. Idempotente.
# Uso: ./install.sh [--dry-run] [--uninstall] [--plugins]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY=0; UNINSTALL=0; PLUGINS=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --uninstall) UNINSTALL=1 ;; --plugins) PLUGINS=1 ;;
    *) echo "Argomento sconosciuto: $a" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in Darwin) OS=macos ;; Linux) OS=linux ;; *) echo "OS non supportato (usa install.ps1 su Windows)" >&2; exit 1 ;; esac
STAMP="$(date +%Y%m%d-%H%M%S)"
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

# resolve senza readlink -f (assente su macOS BSD)
resolve() { local p="$1"; while [ -L "$p" ]; do local t; t="$(readlink "$p")"; case "$t" in /*) p="$t" ;; *) p="$(dirname "$p")/$t" ;; esac; done; echo "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"; }

link() { # link <sorgente nel repo> <destinazione>
  local src="$1" dest="$2"
  [ -e "$src" ] || { echo "skip (manca nel repo): $src"; return; }
  if [ "$UNINSTALL" = 1 ]; then
    if [ -L "$dest" ] && [ "$(resolve "$dest")" = "$(resolve "$src")" ]; then
      run rm "$dest"; echo "rimosso: $dest"
      local bak; bak="$(ls -d "$dest".bak-* 2>/dev/null | tail -1 || true)"
      [ -n "$bak" ] && run mv "$bak" "$dest" && echo "ripristinato: $bak"
    fi
    return
  fi
  if [ -L "$dest" ] && [ "$(resolve "$dest")" = "$(resolve "$src")" ]; then echo "ok: $dest"; return; fi
  run mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ] || [ -L "$dest" ]; then run mv "$dest" "$dest.bak-$STAMP"; echo "backup: $dest.bak-$STAMP"; fi
  run ln -s "$src" "$dest"; echo "link: $dest -> $src"
}

# ---- Claude Code ----
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
C="$REPO/claude"
link "$C/CLAUDE.md"                 "$CLAUDE_DIR/CLAUDE.md"
link "$C/settings.$OS.json"         "$CLAUDE_DIR/settings.json"
for d in agents hooks statusline themes; do link "$C/$d" "$CLAUDE_DIR/$d"; done
if [ -d "$C/skills" ]; then for s in "$C"/skills/*/; do s="${s%/}"; link "$s" "$CLAUDE_DIR/skills/$(basename "$s")"; done; fi
[ -d "$C/mods" ] && link "$C/mods" "$CLAUDE_DIR/mods"

# plugin/marketplace (opt-in)
if [ "$PLUGINS" = 1 ] && [ "$UNINSTALL" = 0 ]; then
  if ! command -v claude >/dev/null || ! command -v node >/dev/null; then echo "claude o node non nel PATH: salto --plugins"
  else
    node -e '
      const p=require(process.argv[1]);
      for(const [n,s] of Object.entries(p.marketplaces)){
        if(s.source==="directory"){console.error("skip marketplace locale "+n+" ("+s.path+"): aggiungilo a mano");continue;}
        console.log("marketplace add "+(s.repo||s.url||s.path));}
      for(const [id,on] of Object.entries(p.enabledPlugins)) if(on) console.log("install "+id);
    ' "$C/plugins.json" | while read -r kind arg; do
      case "$kind" in
        marketplace) run claude plugin marketplace add "$arg" || true ;;
        install)     run claude plugin install "$arg" || true ;;
      esac
    done
  fi
fi

# ---- Codex (futuro) ----
# link "$REPO/codex/config.toml" "$HOME/.codex/config.toml"
echo "Fatto."
