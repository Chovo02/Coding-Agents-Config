<#
Symlink delle config degli agent dal repo verso la home (Windows). Idempotente.
Uso: ./install.ps1 [-DryRun] [-Uninstall] [-Plugins]
Richiede Developer Mode (o admin) per i symlink di file; le directory ripiegano su Junction.
#>
[CmdletBinding()]
param([switch]$DryRun, [switch]$Uninstall, [switch]$Plugins)
$ErrorActionPreference = 'Stop'
$Repo  = $PSScriptRoot
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Resolve-Target($p) {
    $i = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    if ($i -and $i.LinkType -and $i.Target) { return ([string]($i.Target | Select-Object -First 1)).TrimEnd('\','/') }
    return $null
}
function Same($a, $b) { $a -and ([IO.Path]::GetFullPath($a).TrimEnd('\') -ieq [IO.Path]::GetFullPath($b).TrimEnd('\')) }

function Link($Src, $Dest) {
    if (-not (Test-Path -LiteralPath $Src)) { Write-Host "skip (manca nel repo): $Src"; return }
    $cur = Resolve-Target $Dest
    if ($Uninstall) {
        if (Same $cur $Src) {
            if ($DryRun) { Write-Host "[dry-run] rimuovi $Dest" } else { (Get-Item -LiteralPath $Dest -Force).Delete() }
            Write-Host "rimosso: $Dest"
            $bak = Get-ChildItem -Path "$Dest.bak-*" -Force -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
            if ($bak) { if (-not $DryRun) { Move-Item -LiteralPath $bak.FullName -Destination $Dest }; Write-Host "ripristinato: $($bak.Name)" }
        }
        return
    }
    if (Same $cur $Src) { Write-Host "ok: $Dest"; return }
    $parent = Split-Path $Dest -Parent
    if (-not $DryRun -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path -LiteralPath $Dest) {
        if (-not $DryRun) { Move-Item -LiteralPath $Dest -Destination "$Dest.bak-$Stamp" }
        Write-Host "backup: $Dest.bak-$Stamp"
    }
    if ($DryRun) { Write-Host "[dry-run] link $Dest -> $Src"; return }
    $isDir = (Get-Item -LiteralPath $Src).PSIsContainer
    try { New-Item -ItemType SymbolicLink -Path $Dest -Target $Src -ErrorAction Stop | Out-Null }
    catch {
        if ($isDir) { New-Item -ItemType Junction -Path $Dest -Target $Src | Out-Null; Write-Host "(junction) " -NoNewline }
        else {
            # rollback del backup per non lasciare la config mancante
            if (Test-Path -LiteralPath "$Dest.bak-$Stamp") { Move-Item -LiteralPath "$Dest.bak-$Stamp" -Destination $Dest }
            throw "Symlink di file non permesso per $Dest. Attiva Developer Mode (Impostazioni > Per sviluppatori) o esegui da admin."
        }
    }
    Write-Host "link: $Dest -> $Src"
}

# ---- Claude Code ----
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$C = Join-Path $Repo 'claude'
Link "$C\CLAUDE.md"             "$ClaudeDir\CLAUDE.md"
Link "$C\settings.windows.json" "$ClaudeDir\settings.json"
foreach ($d in 'agents','hooks','statusline','themes','chrome') { Link "$C\$d" "$ClaudeDir\$d" }
if (Test-Path "$C\skills") { Get-ChildItem "$C\skills" -Directory | ForEach-Object { Link $_.FullName "$ClaudeDir\skills\$($_.Name)" } }
if ((Test-Path "$C\mods") -and (Get-ChildItem "$C\mods" -Force -ErrorAction SilentlyContinue)) { Link "$C\mods" "$ClaudeDir\mods" }

if ($Plugins -and -not $Uninstall) {
    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Host 'claude non nel PATH: salto -Plugins' }
    else {
        $p = Get-Content "$C\plugins.json" -Raw | ConvertFrom-Json
        foreach ($m in $p.marketplaces.PSObject.Properties) {
            $s = $m.Value
            if ($s.source -eq 'directory') { Write-Warning "skip marketplace locale $($m.Name) ($($s.path)): aggiungilo a mano"; continue }
            $arg = if ($s.repo) { $s.repo } elseif ($s.url) { $s.url } else { $s.path }
            if ($DryRun) { Write-Host "[dry-run] claude plugin marketplace add $arg" } else { claude plugin marketplace add $arg }
        }
        foreach ($e in $p.enabledPlugins.PSObject.Properties) {
            if ($e.Value) { if ($DryRun) { Write-Host "[dry-run] claude plugin install $($e.Name)" } else { claude plugin install $e.Name } }
        }
    }
}

# ---- Codex (futuro) ----
# Link "$Repo\codex\config.toml" "$HOME\.codex\config.toml"
Write-Host 'Fatto.'
