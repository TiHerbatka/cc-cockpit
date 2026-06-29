const { test } = require('node:test');
const assert = require('node:assert');
const { parseTodoMd } = require('../server/todomd');

test('parseTodoMd parses sections and checkbox items with done state + depth', () => {
  const md = [
    '# TODO',
    '',
    '## A. Test Tasks',
    '- [ ] A1. Set up the project README',
    '- [x] A2. Add a CONTRIBUTING guide',
    '  - [ ] A2.1. PR template',
  ].join('\n');
  assert.deepStrictEqual(parseTodoMd(md), [
    { kind: 'section', text: 'A. Test Tasks' },
    { kind: 'item', done: false, depth: 0, text: 'A1. Set up the project README' },
    { kind: 'item', done: true, depth: 0, text: 'A2. Add a CONTRIBUTING guide' },
    { kind: 'item', done: false, depth: 1, text: 'A2.1. PR template' },
  ]);
});

test('parseTodoMd skips the H1 title and blanks, keeps prose as text', () => {
  assert.deepStrictEqual(parseTodoMd('# TODO\n\nSome note line\n\n## B\n- [ ] B1. x'), [
    { kind: 'text', text: 'Some note line' },
    { kind: 'section', text: 'B' },
    { kind: 'item', done: false, depth: 0, text: 'B1. x' },
  ]);
});

test('parseTodoMd on empty/nullish input returns []', () => {
  assert.deepStrictEqual(parseTodoMd(''), []);
  assert.deepStrictEqual(parseTodoMd(null), []);
});
