const test = require('node:test');
const assert = require('node:assert');
const { renderMarkdown, sanitizeUrl } = require('../public/markdown');

test('renderMarkdown escapes HTML — no raw markup survives (XSS)', () => {
  assert.equal(renderMarkdown('<script>alert(1)</script>'),
    '<p class="md-p">&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  // an <img onerror> never becomes a real tag
  assert.ok(!renderMarkdown('<img src=x onerror=alert(1)>').includes('<img'));
});

test('renderMarkdown: bold, italic, strikethrough, inline code', () => {
  assert.equal(renderMarkdown('**b**'), '<p class="md-p"><strong>b</strong></p>');
  assert.equal(renderMarkdown('*i*'), '<p class="md-p"><em>i</em></p>');
  assert.equal(renderMarkdown('~~s~~'), '<p class="md-p"><del>s</del></p>');
  assert.equal(renderMarkdown('use `code` here'),
    '<p class="md-p">use <code class="md-icode">code</code> here</p>');
});

test('renderMarkdown: emphasis markers inside inline code are NOT reformatted', () => {
  assert.equal(renderMarkdown('`a*b*c`'),
    '<p class="md-p"><code class="md-icode">a*b*c</code></p>');
  // snake_case is not italicised
  assert.equal(renderMarkdown('foo_bar_baz'), '<p class="md-p">foo_bar_baz</p>');
});

test('renderMarkdown: fenced code block is literal and escaped', () => {
  const html = renderMarkdown('```js\nconst x = 1 < 2 && a > b;\n```');
  assert.equal(html, '<pre class="md-code"><code>const x = 1 &lt; 2 &amp;&amp; a &gt; b;</code></pre>');
  // markers inside a fence are not treated as markdown
  assert.ok(renderMarkdown('```\n**not bold**\n```').includes('**not bold**'));
});

test('renderMarkdown: unclosed fence still renders as a code block (streaming-safe)', () => {
  assert.equal(renderMarkdown('```\npartial code'),
    '<pre class="md-code"><code>partial code</code></pre>');
});

test('renderMarkdown: headings', () => {
  assert.equal(renderMarkdown('# Title'), '<h1 class="md-h">Title</h1>');
  assert.equal(renderMarkdown('### Sub'), '<h3 class="md-h">Sub</h3>');
});

test('renderMarkdown: unordered and ordered lists', () => {
  assert.equal(renderMarkdown('- a\n- b'),
    '<ul class="md-list"><li>a</li><li>b</li></ul>');
  assert.equal(renderMarkdown('1. one\n2. two'),
    '<ol class="md-list"><li>one</li><li>two</li></ol>');
});

test('renderMarkdown: blockquote and horizontal rule', () => {
  assert.equal(renderMarkdown('> quoted'),
    '<blockquote class="md-quote">quoted</blockquote>');
  assert.equal(renderMarkdown('---'), '<hr>');
});

test('renderMarkdown: single newlines become <br> within a paragraph', () => {
  assert.equal(renderMarkdown('line one\nline two'),
    '<p class="md-p">line one<br>line two</p>');
});

test('renderMarkdown: links sanitize the scheme', () => {
  assert.equal(renderMarkdown('[x](https://example.com)'),
    '<p class="md-p"><a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a></p>');
  // javascript: is rejected — the literal text is kept, no anchor emitted
  const js = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!js.includes('<a '));
});

test('sanitizeUrl: allows safe schemes, rejects dangerous ones', () => {
  assert.equal(sanitizeUrl('https://a.com'), 'https://a.com');
  assert.equal(sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(sanitizeUrl('/relative/path'), '/relative/path');
  assert.equal(sanitizeUrl('#anchor'), '#anchor');
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('data:text/html,x'), '');
  assert.equal(sanitizeUrl('vbscript:x'), '');
});

test('renderMarkdown: empty / nullish input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});
