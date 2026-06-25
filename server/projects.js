// server/projects.js
// A "project" is an immediate subdirectory of the projects root. No database —
// the filesystem is the store.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = 'C:\\claude_projects\\cockpit';
// One directory under the projects root holds all temporary (one-off) sessions,
// each in its own subfolder. It is NOT a selectable project.
const TEMP_DIR_NAME = '_temporary-sessions';
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function projectsRoot() {
  return process.env.COCKPIT_PROJECTS_ROOT || DEFAULT_ROOT;
}

function tempRoot(root = projectsRoot()) {
  return path.join(root, TEMP_DIR_NAME);
}

// True if cwd is (strictly) inside the temp root — i.e. a temporary session.
function isTemp(cwd, root = projectsRoot()) {
  if (!cwd) return false;
  const rel = path.relative(tempRoot(root), cwd);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// True if cwd is inside the cockpit projects root (any depth) — used to tell
// cockpit-managed sessions apart from legacy/other sessions in discovery.
function isUnderProjectsRoot(cwd, root = projectsRoot()) {
  if (!cwd) return false;
  const rel = path.relative(root, cwd);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Create a fresh, uniquely-named subfolder under the temp root for a one-off
// session. Returns { name, path }. The folder name is a timestamp (display name
// comes from Claude Code's aiTitle, not this).
function createTempSession(root = projectsRoot()) {
  const dir = tempRoot(root);
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  let name = base;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i += 1) name = `${base}-${i}`;
  const full = path.join(dir, name);
  fs.mkdirSync(full);
  return { name, path: full };
}

function hasControlChar(s) {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) < 32) return true;
  }
  return false;
}

function validateName(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'name required' };
  const n = name.trim();
  if (!n) return { ok: false, reason: 'name required' };
  if (/[\\/]/.test(n)) return { ok: false, reason: 'no path separators' };
  if (n.includes('..')) return { ok: false, reason: 'no ".."' };
  if (/[<>:"|?*]/.test(n)) return { ok: false, reason: 'illegal character' };
  if (hasControlChar(n)) return { ok: false, reason: 'control character' };
  if (RESERVED.has(n.toUpperCase())) return { ok: false, reason: 'reserved name' };
  return { ok: true, name: n };
}

function listProjects(root = projectsRoot()) {
  fs.mkdirSync(root, { recursive: true });
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== TEMP_DIR_NAME)
    .map((d) => ({ name: d.name, path: path.join(root, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function createProject(name, root = projectsRoot()) {
  const v = validateName(name);
  if (!v.ok) { const e = new Error(v.reason); e.status = 400; throw e; }
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, v.name);
  if (fs.existsSync(dir)) { const e = new Error('project already exists'); e.status = 409; throw e; }
  fs.mkdirSync(dir);
  return { name: v.name, path: dir };
}

module.exports = { projectsRoot, tempRoot, isTemp, isUnderProjectsRoot, createTempSession, validateName, listProjects, createProject, TEMP_DIR_NAME };
