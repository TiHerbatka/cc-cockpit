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
// headings, unordered/ordered lists (with multi-level nesting via indentation),
// GitHub-flavored pipe tables (with column alignment), blockquotes, horizontal rules,
// links, and single-newline-as-<br> (chat-style hard breaks). It is intentionally a
// subset — enough for what Claude emits in the terminal, not a full CommonMark engine.

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

// Inline formatting. Escape first, then PROTECT inline-code spans behind runtime
// sentinels before applying emphasis. The sentinel is a private-use char built via its
// code (so no literal control byte lives in this source). This shields code contents
// from emphasis AND — unlike a plain split — lets emphasis span across a code span, so
// `**use `let` here**` renders as bold including the code (the split approach left the
// opening/closing `**` in different segments, so it rendered the markers literally).
function renderInline(raw) {
  const escaped = escapeHtml(raw);
  const S = String.fromCharCode(0xE000);
  const codes = [];
  const protectedStr = escaped.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c); // already-escaped code content
    return S + (codes.length - 1) + S;
  });
  let out = applyEmphasis(protectedStr);
  out = out.replace(new RegExp(S + '(\\d+)' + S, 'g'), (_m, i) => `<code class="md-icode">${codes[+i]}</code>`);
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

// --- Table helpers ---

// Parse pipe-separated cells from a table row, stripping optional leading/trailing pipes.
function parseTableCells(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s.length > 0 && s[s.length - 1] === '|') s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

// Return true if a line is a GFM table delimiter row (cells like ---, :---, ---:, :---:).
function isTableDelimiter(line) {
  const cells = parseTableCells(line);
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

// Derive text-align value from a delimiter cell; returns null for no explicit alignment.
function getColumnAlignment(cell) {
  const c = cell.trim();
  if (!c.length) return null;
  const left = c[0] === ':';
  const right = c[c.length - 1] === ':';
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function renderMarkdown(src) {
  const lines = splitLines(src);
  const out = [];

  // Stack-based list state. Each entry = { type: 'ul'|'ol', indent: number, liOpen: boolean }.
  // liOpen tracks whether the most recently opened <li> at that level is still unclosed
  // (needed so a nested list can be inserted inside the parent <li> before closing it).
  let listStack = [];

  // Close all lists deeper than targetIndent, emitting closing tags in innermost-first order.
  function closeListsToLevel(targetIndent) {
    while (listStack.length > 0 && listStack[listStack.length - 1].indent > targetIndent) {
      const top = listStack[listStack.length - 1];
      if (top.liOpen) { out.push('</li>'); top.liOpen = false; }
      out.push('</' + top.type + '>');
      listStack.pop();
    }
  }

  function closeAllLists() { closeListsToLevel(-1); }

  // Emit a list item at the given indent depth, opening/closing nesting levels as needed.
  function handleListItem(indent, type, content) {
    closeListsToLevel(indent);
    const top = listStack.length > 0 ? listStack[listStack.length - 1] : null;
    if (top === null || top.indent < indent) {
      // Open a new list (may be a nested child — the parent <li> stays open so this
      // child list renders inside it before the parent </li> is eventually emitted).
      out.push('<' + type + ' class="md-list">');
      listStack.push({ type, indent, liOpen: false });
    } else if (top.type !== type) {
      // Same indent level but list type switched (e.g. ol → ul): close old, open new.
      if (top.liOpen) { out.push('</li>'); top.liOpen = false; }
      out.push('</' + top.type + '>');
      listStack.pop();
      out.push('<' + type + ' class="md-list">');
      listStack.push({ type, indent, liOpen: false });
    }
    const cur = listStack[listStack.length - 1];
    if (cur.liOpen) { out.push('</li>'); cur.liOpen = false; }
    out.push('<li>' + renderInline(content));
    cur.liOpen = true;
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // fenced code block — content is literal until the closing fence (or end of input)
    if (RE.fence.test(line)) {
      closeAllLists();
      const code = [];
      i++;
      while (i < lines.length && !RE.fenceClose.test(lines[i])) { code.push(lines[i]); i++; }
      i++; // consume the closing fence if present
      out.push(`<pre class="md-code"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    // horizontal rule
    if (RE.hr.test(line)) { closeAllLists(); out.push('<hr>'); i++; continue; }
    // heading
    const h = line.match(RE.heading);
    if (h) { closeAllLists(); const lvl = h[1].length; out.push(`<h${lvl} class="md-h">${renderInline(h[2])}</h${lvl}>`); i++; continue; }
    // blockquote — gather consecutive quote lines
    if (RE.quote.test(line)) {
      closeAllLists();
      const quote = [];
      while (i < lines.length && RE.quote.test(lines[i])) { quote.push(lines[i].replace(RE.quote, '')); i++; }
      out.push(`<blockquote class="md-quote">${renderTextBlock(quote.join('\n'))}</blockquote>`);
      continue;
    }
    // unordered list item — group 1 = leading whitespace (indent), group 2 = content
    const ulm = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (ulm) { handleListItem(ulm[1].length, 'ul', ulm[2]); i++; continue; }
    // ordered list item — group 1 = leading whitespace (indent), group 2 = content
    const olm = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (olm) { handleListItem(olm[1].length, 'ol', olm[2]); i++; continue; }
    // blank line ends any open list/paragraph
    if (RE.blank.test(line)) { closeAllLists(); i++; continue; }
    // GitHub-flavored pipe table: current line has | and the next line is a delimiter row
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      closeAllLists();
      const headers = parseTableCells(line);
      const alignments = parseTableCells(lines[i + 1]).map(getColumnAlignment);
      i += 2; // consume header row + delimiter row
      let thtml = '<table class="md-table"><thead><tr>';
      for (let col = 0; col < headers.length; col++) {
        const align = col < alignments.length ? alignments[col] : null;
        const style = align ? ` style="text-align:${align}"` : '';
        thtml += `<th${style}>${renderInline(headers[col])}</th>`;
      }
      thtml += '</tr></thead><tbody>';
      while (i < lines.length && lines[i].includes('|') && !RE.blank.test(lines[i])) {
        const cells = parseTableCells(lines[i]);
        thtml += '<tr>';
        for (let col = 0; col < headers.length; col++) {
          const cell = col < cells.length ? cells[col] : '';
          const align = col < alignments.length ? alignments[col] : null;
          const style = align ? ` style="text-align:${align}"` : '';
          thtml += `<td${style}>${renderInline(cell)}</td>`;
        }
        thtml += '</tr>';
        i++;
      }
      thtml += '</tbody></table>';
      out.push(thtml);
      continue;
    }
    // paragraph — gather consecutive lines that don't start another block
    closeAllLists();
    const para = [];
    while (i < lines.length
        && !RE.blank.test(lines[i]) && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i])
        && !RE.hr.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i])
        && !(lines[i].includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1]))) {
      para.push(lines[i]); i++;
    }
    out.push(`<p class="md-p">${renderTextBlock(para.join('\n'))}</p>`);
  }
  closeAllLists();
  return out.join('');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { renderMarkdown, sanitizeUrl, escapeHtml };
if (typeof window !== 'undefined') { window.renderMarkdown = renderMarkdown; }
