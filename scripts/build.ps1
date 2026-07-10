$required = @(
  "app/index.html",
  "app/app.js",
  "app/styles.css",
  "src/engine.js",
  "data/evaluation/samples.json"
)

foreach ($file in $required) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    Write-Error "Missing required build input: $file"
    exit 1
  }
}

$html = Get-Content -Encoding UTF8 -Raw -LiteralPath "app/index.html"
foreach ($needle in @("src/engine.js", "app.js", "styles.css", "본 서비스는 의료적 진단")) {
  if (-not $html.Contains($needle)) {
    Write-Error "Build validation failed. index.html does not contain: $needle"
    exit 1
  }
}

New-Item -ItemType Directory -Force -Path "dist" | Out-Null
Copy-Item -Recurse -Force -Path "app" -Destination "dist"
Copy-Item -Recurse -Force -Path "src" -Destination "dist"
Copy-Item -Recurse -Force -Path "data" -Destination "dist"
Write-Host "Static production build prepared in dist/."






