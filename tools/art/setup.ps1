# One-shot Windows setup for the art pipeline (run from the repo root in PowerShell):
#   powershell -ExecutionPolicy Bypass -File tools/art/setup.ps1
# Installs what is missing (Node LTS, Python 3, ffmpeg via winget; the Python packages post.py uses), runs npm ci,
# writes a .env.local template if there is none, and runs the API probe once the keys are in. Safe to re-run.
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root
Write-Host "GWF RPG art pipeline setup in $root" -ForegroundColor Cyan

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function WingetInstall($id, $name) {
  if (-not (Have 'winget')) { Write-Host "  winget is not available; install $name by hand" -ForegroundColor Yellow; return }
  Write-Host "  installing $name with winget…"
  winget install --id $id -e --accept-package-agreements --accept-source-agreements --silent | Out-Null
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

# 1. Node 20+
if (-not (Have 'node')) { WingetInstall 'OpenJS.NodeJS.LTS' 'Node.js LTS' }
$nodeMajor = 0; if (Have 'node') { $nodeMajor = [int]((node --version) -replace '^v(\d+).*', '$1') }
if ($nodeMajor -lt 20) { Write-Host "  Node 20+ is required (found $(node --version 2>$null)); install from https://nodejs.org and re-run" -ForegroundColor Yellow } else { Write-Host "  node $(node --version) ok" }

# 2. Python 3 + packages
$py = $null
foreach ($c in @('python', 'python3', 'py')) { if (Have $c) { $v = & $c --version 2>&1; if ("$v" -match 'Python 3') { $py = $c; break } } }
if (-not $py) { WingetInstall 'Python.Python.3.12' 'Python 3.12'; if (Have 'python') { $py = 'python' } }
if ($py) {
  Write-Host "  $py $(& $py --version 2>&1) ok"
  & $py -m pip install --quiet --upgrade pip | Out-Null
  Write-Host "  pip: pillow numpy pyloudnorm rembg (post.py's cut-outs and loudness)…"
  & $py -m pip install --quiet pillow numpy pyloudnorm rembg
  Write-Host "  pip: onnxruntime-gpu (rembg on the 4070; falls back to CPU onnxruntime)…"
  & $py -m pip install --quiet onnxruntime-gpu
  if ($LASTEXITCODE -ne 0) { & $py -m pip install --quiet onnxruntime }
  & $py -I tools/art/post.py check
  if ($py -ne 'python') { Write-Host "  note: set ART_PYTHON=$py in .env.local (the pipeline calls 'python' by default on Windows)" -ForegroundColor Yellow }
} else { Write-Host "  Python 3 not found; install it from https://python.org (tick 'Add to PATH') and re-run" -ForegroundColor Yellow }

# 3. ffmpeg (MP3/loop decoding for Suno drops)
if (-not (Have 'ffmpeg')) { WingetInstall 'Gyan.FFmpeg' 'ffmpeg' }
if (Have 'ffmpeg') { Write-Host "  ffmpeg ok" } else { Write-Host "  ffmpeg not on PATH yet — open a new terminal after winget finishes, or install from https://ffmpeg.org" -ForegroundColor Yellow }

# 4. npm dependencies
if ($nodeMajor -ge 20) { Write-Host "  npm ci…"; npm ci --no-audit --no-fund | Out-Null; if ($LASTEXITCODE -eq 0) { Write-Host "  node_modules ok" } }

# 5. .env.local (never committed)
$envFile = Join-Path $root '.env.local'
if (-not (Test-Path $envFile)) {
@"
# GWF RPG art pipeline keys — this file is gitignored. Paste each key after the = sign.
PIXELLAB_API_KEY=
FAL_KEY=
GEMINI_API_KEY=
ELEVENLABS_API_KEY=

# Optional
ART_BUDGET_USD=25
# FAL_T2I_MODEL=fal-ai/flux-2-pro
# FAL_LORA_MODEL=fal-ai/flux-2/klein/9b/lora
# FAL_TRAINER_MODEL=fal-ai/flux-2-trainer
# GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
# ART_BODY_REF=1_1
# ART_PYTHON=python
"@ | Set-Content -Encoding UTF8 $envFile
  Write-Host "  wrote .env.local — paste your keys into it" -ForegroundColor Green
} else { Write-Host "  .env.local exists" }

# 6. Probe the live API schemas when at least one key is present
$hasKey = (Get-Content $envFile) -match '^(PIXELLAB_API_KEY|FAL_KEY|GEMINI_API_KEY|ELEVENLABS_API_KEY)=\S+'
if ($hasKey) { Write-Host "`nProbing the APIs…" -ForegroundColor Cyan; npm run art:probe }
else { Write-Host "`nNo keys yet. Paste them into .env.local, then run: npm run art:probe" -ForegroundColor Yellow }

Write-Host "`nNext: npm run art:style -- --queue   (the 12 style-sheet prompts are already in art/midjourney/queue.md)" -ForegroundColor Cyan
Write-Host "      run them in Midjourney → art/inbox/midjourney/style__<id>.png → npm run art:style -- --import → npm run art:review"
