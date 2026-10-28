# Instala Compass en ~\.compass y deja el comando `compass` en ~\.local\bin (compass.cmd para
# PowerShell/cmd y `compass` para Git Bash). Agrega esa carpeta al PATH del usuario y copia la skill.
# Uso:  irm https://raw.githubusercontent.com/CrisMtz99/Compass_DiffMap/main/scripts/install.ps1 | iex
#       $env:COMPASS_REF = '<rama|tag>' para una version concreta.
#       $env:COMPASS_SKILL = 'project' para copiar la skill al repo actual.
# Solo ASCII a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI.
# Con `irm | iex` corre dentro de la sesion del usuario: errores con throw, nunca exit.
& {
  $ErrorActionPreference = 'Stop'
  $Start = (Get-Location).ProviderPath
  $Repo = if ($env:COMPASS_REPO) { $env:COMPASS_REPO } else { 'https://github.com/CrisMtz99/Compass_DiffMap.git' }
  $Ref = if ($env:COMPASS_REF) { $env:COMPASS_REF } else { 'main' }
  $Dir = if ($env:COMPASS_HOME) { $env:COMPASS_HOME } else { Join-Path $HOME '.compass' }
  $Bin = if ($env:COMPASS_BIN) { $env:COMPASS_BIN } else { Join-Path $HOME '.local\bin' }

  # Los comandos nativos no lanzan excepciones: hay que revisar el codigo de salida.
  function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "compass: fallo '$Exe $($Arguments -join ' ')' (codigo $LASTEXITCODE)" }
  }
  function Test-Command([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

  foreach ($c in 'git', 'node') { if (-not (Test-Command $c)) { throw "compass: falta $c" } }
  $nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
  if ($nodeMajor -lt 20) { throw "compass: se requiere Node 20+ (tienes $(& node -v))" }
  if (-not (Test-Command 'pnpm')) {
    Write-Host '-> instalando pnpm con corepack'
    # corepack escribe junto a node.exe; sin permisos de administrador falla y se usa npm.
    try { & corepack enable 2>$null } catch {}
    if (-not (Test-Command 'pnpm')) { Invoke-Native 'npm' @('i', '-g', 'pnpm') }
  }

  if (Test-Path (Join-Path $Dir '.git')) {
    Write-Host "-> actualizando $Dir"
    Invoke-Native 'git' @('-C', $Dir, 'fetch', '-q', 'origin', $Ref)
    Invoke-Native 'git' @('-C', $Dir, 'checkout', '-q', 'FETCH_HEAD')
  } else {
    Write-Host "-> clonando en $Dir"
    Invoke-Native 'git' @('clone', '-q', '--branch', $Ref, $Repo, $Dir)
  }

  Push-Location $Dir
  try {
    & pnpm install --frozen-lockfile --silent
    if ($LASTEXITCODE -ne 0) { Invoke-Native 'pnpm' @('install', '--silent') }
    Write-Host '-> construyendo'
    Invoke-Native 'pnpm' @('build') | Out-Null
  } finally { Pop-Location }

  $entry = Join-Path $Dir 'packages\cli\dist\index.js'
  New-Item -ItemType Directory -Force $Bin | Out-Null
  $noBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText((Join-Path $Bin 'compass.cmd'), "@node `"$entry`" %*`r`n", $noBom)
  # Git Bash: shebang con fin de linea LF y ruta con /
  [IO.File]::WriteAllText((Join-Path $Bin 'compass'), "#!/usr/bin/env bash`nexec node `"$($entry -replace '\\', '/')`" `"`$@`"`n", $noBom)

  # PATH del usuario: se lee y escribe sin expandir (%USERPROFILE%... se conservan) como REG_EXPAND_SZ.
  $norm = { param($p) [Environment]::ExpandEnvironmentVariables($p).TrimEnd('\').ToLowerInvariant() }
  $envKey = Get-Item 'HKCU:\Environment'
  $userPath = [string]$envKey.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  $parts = @($userPath -split ';' | Where-Object { $_ })
  $added = $false
  if (-not ($parts | Where-Object { (& $norm $_) -eq (& $norm $Bin) })) {
    Set-ItemProperty 'HKCU:\Environment' -Name Path -Value (($parts + $Bin) -join ';') -Type ExpandString
    # Avisa a Windows del cambio (las terminales nuevas lo toman) con una variable temporal.
    [Environment]::SetEnvironmentVariable('COMPASS_PATH_REFRESH', '1', 'User')
    [Environment]::SetEnvironmentVariable('COMPASS_PATH_REFRESH', $null, 'User')
    $added = $true
  }
  if (-not (($env:Path -split ';') | Where-Object { $_ -and (& $norm $_) -eq (& $norm $Bin) })) { $env:Path = "$env:Path;$Bin" }

  # Skill de Claude Code: personal (~\.claude\skills) o del proyecto donde se corrio el instalador
  $skillDst = if ($env:COMPASS_SKILL -eq 'project') { Join-Path $Start '.claude\skills\compass' } else { Join-Path $HOME '.claude\skills\compass' }
  New-Item -ItemType Directory -Force (Split-Path $skillDst) | Out-Null
  if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
  Copy-Item -Recurse (Join-Path $Dir 'skill\compass') $skillDst

  Write-Host "OK compass instalado: $Bin\compass.cmd (y $Bin\compass para Git Bash)"
  Write-Host "OK skill copiada a $skillDst"
  if ($added) { Write-Host "OK $Bin agregado al PATH del usuario (abre una terminal nueva si 'compass' no aparece en otras ventanas)" }
}
