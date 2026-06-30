// public/markdown.js — a small, self-contained, XSS-safe Markdown→HTML renderer for
// assistant messages (H8). No dependencies, no bundler. Dual export (same pattern as
// compose.js): browser gets a window global, node --test can require it.
//
// Safety model: ALL source text is HTML-escaped before any markup is constructed, and
// the only HTML emitted comes from this file's own templates with escaped
// interpolations. Link hrefs are scheme-checked (with control chars stripped first).
// So no source text can inject markup.
//
// Supported: fenced code blocks (```), inline code, bold, italic, strikethrough,
// headings, unordered/ordered lists, blockquotes, horizontal rules, links, and
// single-newline-as-<br> (chat-style hard breaks). It is intentionally a subset —
// enough for what Claude emits in the terminal, not a full CommonMark engine.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Remove ASCII control characters (codes 0-31, the C0 set incl. tab/newline/CR) and
// DEL (127). Browsers ignore these when parsing an href, so an embedded control char
// is used to smuggle a blocked scheme past a naive allowlist. Done via char codes
// (not a regex literal) so no control byte ever lives in this source file.
function stripControlChars(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 31 && c !== 127) out += s[i];
  }
  return out;
}

// Allow only safe link schemes; reject javascript:, data:, vbscript:, etc. Relative,
// anchor, and schemeless URLs pass through. Control chars are stripped FIRST so
// "\x01javascript:…" / "java\tscript:…" can't evade the scheme check (XSS hardening).
function sanitizeUrl(url) {
  const u = stripControlChars(String(url == null ? '' : url)).trim();
  if (!u) return '';
  if (u.startsWith('//')) return ''; // protocol-relative (//host) — unneeded for a local tool
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // any other explicit scheme -> reject
  return u; // schemeless / relative
}

// Apply emphasis/link formatting to an already-escaped, code-free text segment.
function applyEmphasis(s) {
  // links [label](url) — reject unsafe schemes (keeps the literal text on reject)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = sanitizeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  // emphasis: bold before italic so the inner markers aren't consumed
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w])__([^_]+?)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>'); // _italic_, not snake_case
  s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
  return s;
}

// Inline formatting. Escape first, then split out inline-code spans so their contents
// are NOT reformatted (no fragile placeholder round-trip — code segments render
// verbatim while only the in-between segments get emphasis/links).
function renderInline(raw) {
  const escaped = escapeHtml(raw);
  const parts = escaped.split(/(`[^`]+`)/g); // capturing split keeps the code spans
  let out = '';
  for (const part of parts) {
    if (part.length >= 2 && part[0] === '`' && part[part.length - 1] === '`') {
      out += `<code class="md-icode">${part.slice(1, -1)}</code>`; // contents already escaped
    } else {
      out += applyEmphasis(part);
    }
  }
  return out;
}

// Render a paragraph/blockquote inner block: inline-format, then turn the remaining
// single newlines into hard breaks (chat-style).
function renderTextBlock(text) {
  return renderInline(text).replace(/\n/g, '<br>');
}

const RE = {
  fence: /^\s*```/,
  fenceClose: /^\s*```\s*$/,
  heading: /^\s*(#{1,6})\s+(.*)$/,
  hr: /^\s*([-*_])\1\1+\s*$/,
  quote: /^\s*>\s?/,
  ul: /^\s*[-*+]\s+(.*)$/,
  ol: /^\s*\d+[.)]\s+(.*)$/,
  blank: /^\s*$/,
};

// Split source into lines, tolerating CRLF: split on LF, then drop a trailing CR (code
// 13) so the $-anchored block regexes (heading/list) aren't defeated by a stray \r.
function splitLines(src) {
  return String(src == null ? '' : src).split('\n').map((l) => (l.charCodeAt(l.length - 1) === 13 ? l.slice(0, -1) : l));
}

function renderMarkdown(src) {
  const lines = splitLines(src);
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code block — content is literal until the closing fence (or end of input)
    if (RE.fence.test(line)) {
      closeList();
      const code = [];
      i++;
      while (i < lines.length && !RE.fenceClose.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // consume the closing fence if present
      out.push(`<pre class="md-code"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    // horizontal rule
    if (RE.hr.test(line)) { closeList(); out.push('<hr>'); i++; continue; }
    // heading
    const h = line.match(RE.heading);
    if (h) { closeList(); const lvl = h[1].length; out.push(`<h${lvl} class="md-h">${renderInline(h[2])}</h${lvl}>`); i++; continue; }
    // blockquote — gather consecutive quote lines
    if (RE.quote.test(line)) {
      closeList();
      const quote = [];
      while (i < lines.length && RE.quote.test(lines[i])) { quote.push(lines[i].replace(RE.quote, '')); i++; }
      out.push(`<blockquote class="md-quote">${renderTextBlock(quote.join('\n'))}</blockquote>`);
      continue;
    }
    // unordered list item
    const ul = line.match(RE.ul);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul class="md-list">'); listType = 'ul'; }
      out.push(`<li>${renderInline(ul[1])}</li>`); i++; continue;
    }
    // ordered list item
    const ol = line.match(RE.ol);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol class="md-list">'); listType = 'ol'; }
      out.push(`<li>${renderInline(ol[1])}</li>`); i++; continue;
    }
    // blank line ends any open list/paragraph
    if (RE.blank.test(line)) { closeList(); i++; continue; }
    // paragraph — gather consecutive lines that don't start another block
    closeList();
    const para = [];
    while (i < lines.length
        && !RE.blank.test(lines[i]) && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i])
        && !RE.hr.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    out.push(`<p class="md-p">${renderTextBlock(para.join('\n'))}</p>`);
  }
  closeList();
  return out.join('');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { renderMarkdown, sanitizeUrl, escapeHtml };
if (typeof window !== 'undefined') { window.renderMarkdown = renderMarkdown; }
