$ErrorActionPreference = 'Stop'

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonExe = if ($pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\*') { $pythonCommand.Source } else { $null }
if (-not $pythonExe) {
    $pythonRoots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python'),
        (Join-Path $env:ProgramFiles 'Python')
    )
    foreach ($root in $pythonRoots) {
        if (Test-Path -LiteralPath $root) {
            $pythonExe = Get-ChildItem -LiteralPath $root -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName 'python.exe' } |
                Where-Object { Test-Path -LiteralPath $_ } |
                Select-Object -First 1
            if ($pythonExe) { break }
        }
    }
}
if (-not $pythonExe) {
    throw 'Python 3.10+ não foi encontrado. Instale o Python e habilite o comando python no PATH.'
}

$backendDir = $PSScriptRoot
$venvPython = Join-Path $backendDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $pythonExe -m venv (Join-Path $backendDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente virtual Python.' }
}

$spicePackage = Join-Path $backendDir '.venv\Lib\site-packages\spiceypy'
if (-not (Test-Path -LiteralPath $spicePackage)) {
    & $venvPython -m pip install -r (Join-Path $backendDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências do backend.' }
}

& $venvPython (Join-Path $backendDir 'download_kernels.py')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os kernels SPICE.' }

& $venvPython (Join-Path $backendDir 'server.py')
