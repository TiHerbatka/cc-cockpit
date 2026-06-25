const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateName, listProjects, createProject, tempRoot, isTemp, isUnderProjectsRoot, createTempSession, TEMP_DIR_NAME } = require('../server/projects');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-proj-'));
}

test('validateName accepts a normal name and trims it', () => {
  assert.deepStrictEqual(validateName('  my-proj '), { ok: true, name: 'my-proj' });
});

test('validateName rejects empty, separators, traversal, illegal chars, reserved names', () => {
  for (const bad of ['', '   ', 'a/b', 'a\\b', '..', 'x..y', 'a:b', 'a<b', 'a|b', 'CON', 'nul', 'LPT1']) {
    assert.strictEqual(validateName(bad).ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('listProjects returns only directories, sorted, and creates the root', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'beta'));
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x');
  const got = listProjects(root);
  assert.deepStrictEqual(got.map((p) => p.name), ['alpha', 'beta']);
  assert.strictEqual(got[0].path, path.join(root, 'alpha'));
});

test('createProject makes the directory and returns its path', () => {
  const root = tmpRoot();
  const p = createProject('gamma', root);
  assert.strictEqual(p.name, 'gamma');
  assert.strictEqual(p.path, path.join(root, 'gamma'));
  assert.ok(fs.statSync(p.path).isDirectory());
});

test('createProject throws 409 for an existing project', () => {
  const root = tmpRoot();
  createProject('dup', root);
  assert.throws(() => createProject('dup', root), (e) => e.status === 409);
});

test('createProject throws 400 for an invalid name', () => {
  const root = tmpRoot();
  assert.throws(() => createProject('a/b', root), (e) => e.status === 400);
});

test('listProjects excludes the temporary-sessions directory', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.mkdirSync(path.join(root, TEMP_DIR_NAME));
  assert.deepStrictEqual(listProjects(root).map((p) => p.name), ['alpha']);
});

test('createTempSession makes a unique subfolder under the temp root (YYYY-MM-DD HH-MM-SS)', () => {
  const root = tmpRoot();
  const t = createTempSession(root);
  assert.strictEqual(path.dirname(t.path), tempRoot(root));
  assert.match(t.name, /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}/);
  assert.ok(fs.statSync(t.path).isDirectory());
  // a second one does not collide
  const t2 = createTempSession(root);
  assert.notStrictEqual(t2.path, t.path);
  assert.ok(fs.statSync(t2.path).isDirectory());
});

test('isTemp is true under the temp root, false for projects/root/outside', () => {
  const root = tmpRoot();
  assert.strictEqual(isTemp(path.join(tempRoot(root), 'sess-1'), root), true);
  assert.strictEqual(isTemp(path.join(root, 'alpha'), root), false);
  assert.strictEqual(isTemp(tempRoot(root), root), false); // the root itself, not a session
  assert.strictEqual(isTemp('C:/elsewhere/x', root), false);
  assert.strictEqual(isTemp('', root), false);
});

test('isUnderProjectsRoot is true for cockpit projects and temp, false outside', () => {
  const root = tmpRoot();
  assert.strictEqual(isUnderProjectsRoot(path.join(root, 'alpha'), root), true);
  assert.strictEqual(isUnderProjectsRoot(path.join(tempRoot(root), 'sess-1'), root), true);
  assert.strictEqual(isUnderProjectsRoot(root, root), false);
  assert.strictEqual(isUnderProjectsRoot('C:/elsewhere/x', root), false);
});
