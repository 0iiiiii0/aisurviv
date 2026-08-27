$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sourcePath = Join-Path $PSScriptRoot "Program.cs"
$outputPath = Join-Path $projectRoot "SurvivLauncher.exe"
$compilerCandidates = @(
    "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
    throw "Windows C# compiler was not found."
}

& $compiler /nologo /target:exe /platform:anycpu /optimize+ /codepage:65001 "/out:$outputPath" $sourcePath
if ($LASTEXITCODE -ne 0) {
    throw "Launcher compilation failed with exit code $LASTEXITCODE."
}

Write-Host "Built: $outputPath" -ForegroundColor Green
