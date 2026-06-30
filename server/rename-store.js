// server/rename-store.js
// Disk persistence for session rename labels. The map is keyed by ccSessionId
// (the Claude Code session id, stable across resume), so a rename survives both
// server restart and a session being resumed with the same ccSessionId.
//
// File format: a flat JSON object { "<ccSessionId>": "<customName>", ... }.
// Absent file or malformed JSON is treated as an empty map — never crashes startup.
const fs = require('node:fs');
const path = require('node:path');

// Load the rename map from `filePath`. Returns a Map<ccSessionId, customName>.
// If the file is absent or contains invalid JSON, returns an empty Map.
function loadRenameMap(filePath) {
  if (!filePath) return new Map();
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); }
  catch { return new Map(); } // file absent
  let obj;
  try { obj = JSON.parse(raw); } catch { return new Map(); } // malformed JSON
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return new Map();
  const map = new Map();
  for (const [k, v] of Object.entries(obj)) {
    if (typeof k === 'string' && k && typeof v === 'string' && v.trim()) {
      map.set(k, v.trim());
    }
  }
  return map;
}

// Persist the rename map to `filePath`. Creates parent directories if needed.
// Errors (disk full, permissions) are swallowed: the in-memory rename already
// applied, and a silent failure is preferable to crashing on every rename.
function saveRenameMap(filePath, map) {
  if (!filePath) return;
  const obj = {};
  for (const [k, v] of map) {
    if (k && v) obj[k] = v;
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
  } catch { /* swallow — rename already applied in memory */ }
}

module.exports = { loadRenameMap, saveRenameMap };
