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

test('renderMarkdown: bold/italic can span an inline-code span', () => {
  // regression: the previous split-on-code-spans approach left the **…** markers in
  // different segments, so this rendered the literal asterisks.
  assert.equal(renderMarkdown('**use `let` here**'),
    '<p class="md-p"><strong>use <code class="md-icode">let</code> here</strong></p>');
  assert.equal(renderMarkdown('_wrap `code` in italic_'),
    '<p class="md-p"><em>wrap <code class="md-icode">code</code> in italic</em></p>');
  // bold immediately followed by a code span + period (the exact shape Claude emitted)
  assert.equal(renderMarkdown('**Default to `const`.**'),
    '<p class="md-p"><strong>Default to <code class="md-icode">const</code>.</strong></p>');
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

test('sanitizeUrl: strips control chars so they cannot smuggle a blocked scheme (XSS)', () => {
  const SOH = String.fromCharCode(1);   // leading C0 control byte
  const TAB = String.fromCharCode(9);   // embedded tab
  const NL = String.fromCharCode(10);   // embedded newline
  assert.equal(sanitizeUrl(SOH + 'javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('java' + TAB + 'script:alert(1)'), '');
  assert.equal(sanitizeUrl('java' + NL + 'script:alert(1)'), '');
  assert.equal(sanitizeUrl('//evil.com'), '');               // protocol-relative
  assert.equal(sanitizeUrl('https://ok.com'), 'https://ok.com'); // real link unaffected
});

test('renderMarkdown: a control-char-smuggled javascript: link emits no anchor', () => {
  const SOH = String.fromCharCode(1);
  const html = renderMarkdown('[x](' + SOH + 'javascript:alert(1))');
  assert.ok(!html.includes('<a'));     // link rejected — no anchor at all
  assert.ok(!html.includes('href'));   // and no href attribute
});

test('renderMarkdown: CRLF line endings do not break headings/lists', () => {
  const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
  assert.equal(renderMarkdown('# Title' + CRLF + 'body'),
    '<h1 class="md-h">Title</h1><p class="md-p">body</p>');
  assert.equal(renderMarkdown('- a' + CRLF + '- b'),
    '<ul class="md-list"><li>a</li><li>b</li></ul>');
});

test('renderMarkdown: empty / nullish input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});

// --- Tables ---

test('renderMarkdown: basic GFM table', () => {
  const src = '| Name | Age |\n| --- | --- |\n| Bob | 30 |';
  const html = renderMarkdown(src);
  assert.ok(html.startsWith('<table class="md-table">'), 'has table element');
  assert.ok(html.includes('<thead>') && html.includes('<tbody>'), 'has thead and tbody');
  assert.ok(html.includes('<th>Name</th>') && html.includes('<th>Age</th>'), 'header cells');
  assert.ok(html.includes('<td>Bob</td>') && html.includes('<td>30</td>'), 'body cells');
  assert.ok(html.endsWith('</table>'), 'table is closed');
});

test('renderMarkdown: table with column alignment', () => {
  const src = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
  const html = renderMarkdown(src);
  assert.ok(html.includes('<th style="text-align:left">Left</th>'), 'left-aligned header');
  assert.ok(html.includes('<th style="text-align:center">Center</th>'), 'center-aligned header');
  assert.ok(html.includes('<th style="text-align:right">Right</th>'), 'right-aligned header');
  assert.ok(html.includes('<td style="text-align:left">a</td>'), 'alignment on body cell');
});

test('renderMarkdown: inline formatting inside table cells is rendered and XSS-safe', () => {
  const src = '| Item | Status |\n| --- | --- |\n| **bold** | `code` |';
  const html = renderMarkdown(src);
  assert.ok(html.includes('<strong>bold</strong>'), 'bold in cell');
  assert.ok(html.includes('<code class="md-icode">code</code>'), 'inline code in cell');
  // HTML inside a cell must be escaped, not passed through raw
  const xss = '| head |\n| --- |\n| <script>evil()</script> |';
  const safe = renderMarkdown(xss);
  assert.ok(!safe.includes('<script>'), 'script tag not injected');
  assert.ok(safe.includes('&lt;script&gt;'), 'angle brackets escaped');
});

test('renderMarkdown: pipe-containing lines without a valid delimiter row are NOT tables', () => {
  // A lone | line with no following delimiter — must become a paragraph
  const single = renderMarkdown('hello | world');
  assert.ok(!single.includes('<table'), 'lone | does not create table');
  assert.ok(single.includes('<p'), 'falls through to paragraph');
  // Two pipe rows but the second is not a delimiter row
  const twoRows = renderMarkdown('| a | b |\n| x | y |');
  assert.ok(!twoRows.includes('<table'), 'two data rows with no delimiter are not a table');
});

// --- Nested lists ---

test('renderMarkdown: 2-level nested unordered list', () => {
  const src = '- a\n  - b\n  - c\n- d';
  const html = renderMarkdown(src);
  assert.ok(html.startsWith('<ul class="md-list">'), 'outer ul');
  assert.ok(html.endsWith('</ul>'), 'outer ul closed');
  // Inner list must be nested INSIDE the parent <li>, not after it
  assert.ok(
    html.includes('<li>a<ul class="md-list"><li>b</li><li>c</li></ul></li>'),
    'inner ul nested inside parent li'
  );
  assert.ok(html.includes('<li>d</li>'), 'sibling after nested block');
});

test('renderMarkdown: nested ordered list inside unordered list', () => {
  const src = '- item\n  1. first\n  2. second';
  const html = renderMarkdown(src);
  assert.ok(html.includes('<ul class="md-list">'), 'outer ul');
  assert.ok(html.includes('<ol class="md-list">'), 'inner ol');
  assert.ok(
    html.includes('<li>item<ol class="md-list"><li>first</li><li>second</li></ol></li>'),
    'ol nested inside ul li'
  );
});
