// server/hooks.js
// Generates the --settings file injected into each cockpit-spawned claude.
// It contains ONLY a hooks block so it merges with (never replaces) the user's
// own settings. Four turn-boundary hooks run cockpit-hook.ps1 with a literal
// -State, which POSTs { id, state } back to the cockpit:
//   UserPromptSubmit -> working          Stop -> idle
//   Notification/idle_prompt -> idle      Notification/permission_prompt -> needs-you
const fs = require('node:fs');
const path = require('node:path');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

function commandEntry(scriptPath, state) {
  return {
    type: 'command',
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-State', state,
    ],
    timeout: 10,
    async: true,
  };
}

// A non-blocking PreToolUse notice: fire-and-forget, like the turn hooks. It just
// tells the cockpit which tool is about to run (reading the payload from stdin, no
// -State arg) and returns nothing, so Claude's NATIVE permission flow proceeds and
// the prompt shows in the terminal. The cockpit mirrors it to the GUI.
function notifyEntry(scriptPath) {
  return {
    type: 'command',
    command: 'powershell.exe',
    args: ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    timeout: 10,
    async: true,
  };
}

function hookSettings() {
  const scriptPath = path.join(HOOKS_DIR, 'cockpit-hook.ps1');
  const preScriptPath = path.join(HOOKS_DIR, 'cockpit-pretooluse.ps1');
  return {
    hooks: {
      UserPromptSubmit: [
        { hooks: [commandEntry(scriptPath, 'working')] },
      ],
      Stop: [
        { hooks: [commandEntry(scriptPath, 'idle')] },
      ],
      Notification: [
        { matcher: 'idle_prompt', hooks: [commandEntry(scriptPath, 'idle')] },
        { matcher: 'permission_prompt', hooks: [commandEntry(scriptPath, 'needs-you')] },
      ],
      // GUI-native permissions (parity model): notify the cockpit which tool is
      // about to run, so a native permission prompt can be mirrored to the GUI.
      // Non-blocking — Claude's native prompt still appears in the terminal.
      PreToolUse: [
        { hooks: [notifyEntry(preScriptPath)] },
      ],
    },
  };
}

function writeHookSettings(outDir = HOOKS_DIR) {
  const outPath = path.join(outDir, 'cockpit-settings.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(hookSettings(), null, 2));
  return outPath;
}

module.exports = { hookSettings, writeHookSettings, HOOKS_DIR };
