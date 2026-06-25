# Cockpit PreToolUse hook (notify-only): tell the cockpit which tool is about to
# run, so a native permission prompt can be mirrored to the GUI with its details.
# Fire-and-forget; NEVER blocks and emits NOTHING to stdout, so Claude's native
# permission flow runs and the prompt appears in the terminal (parity).
# Correlates via CC_COCKPIT_SESSION. Reads the PreToolUse payload from stdin.
$ErrorActionPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$id = $env:CC_COCKPIT_SESSION
$port = $env:CC_COCKPIT_PORT
if (-not $id -or -not $port) { exit 0 }
$toolName = ''
$toolInput = $null
try { $p = $raw | ConvertFrom-Json; $toolName = $p.tool_name; $toolInput = $p.tool_input } catch { }
$body = @{ sessionId = $id; toolName = $toolName; toolInput = $toolInput } | ConvertTo-Json -Compress -Depth 25
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/tool-pending" -Method Post `
    -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
} catch { }
exit 0
