param(
  [switch]$OpenBrowser,
  [int]$Port = 8090
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = "http://localhost:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Serving $root at $prefix"
Write-Host "Press Ctrl+C to stop the server."

if ($OpenBrowser) {
  Start-Process $prefix
}

$contentTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg" = "image/svg+xml"
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))

    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = "index.html"
    }

    $relativePath = $requestPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $root $relativePath))

    if (-not $candidatePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $context.Response.StatusCode = 403
      $context.Response.Close()
      continue
    }

    if ((Test-Path $candidatePath) -and (Get-Item $candidatePath).PSIsContainer) {
      $candidatePath = Join-Path $candidatePath "index.html"
    }

    if (-not (Test-Path $candidatePath -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
      $context.Response.ContentType = "text/plain; charset=utf-8"
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
      continue
    }

    $extension = [System.IO.Path]::GetExtension($candidatePath).ToLowerInvariant()
    $context.Response.ContentType = $contentTypes[$extension]
    if (-not $context.Response.ContentType) {
      $context.Response.ContentType = "application/octet-stream"
    }

    $bytes = [System.IO.File]::ReadAllBytes($candidatePath)
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}
