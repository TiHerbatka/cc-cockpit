# Cockpit turn-boundary hook: tell the cockpit this session's state.
# Fire-and-forget; never blocks claude. Correlates via CC_COCKPIT_SESSION.
# MUST write nothing to stdout (UserPromptSubmit stdout is injected as context).
param([string]$State = '')
$ErrorActionPreference = 'SilentlyContinue'
$id = $env:CC_COCKPIT_SESSION
$port = $env:CC_COCKPIT_PORT
if ($id -and $port -and $State) {
  $body = @{ id = $id; state = $State } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/hook" -Method Post `
      -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
  } catch { }
}
