# build.ps1 — 编译英文与中文论文并复制到 docs/
#
# 依赖：TeX Live（pdflatex、xelatex，含 ctex 与 fandol 字体）。
# 用法：pwsh -File build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
New-Item -ItemType Directory -Force build | Out-Null

foreach ($pass in 1..2) {
    pdflatex -interaction=nonstopmode -halt-on-error -file-line-error -output-directory=build main-en.tex | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'pdflatex failed (see build/main-en.log)' }
    xelatex -interaction=nonstopmode -halt-on-error -file-line-error -output-directory=build main-zh.tex | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'xelatex failed (see build/main-zh.log)' }
}

Copy-Item build/main-en.pdf ../color-mixing-algorithm.pdf -Force
Copy-Item build/main-zh.pdf ../color-mixing-algorithm.zh-CN.pdf -Force
Write-Host 'built docs/color-mixing-algorithm.pdf and docs/color-mixing-algorithm.zh-CN.pdf'
