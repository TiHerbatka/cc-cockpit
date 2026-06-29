// .claude/skills/gui-map/probe.js
// DEV-ONLY browser-side capture helper for the /gui-map skill. The skill injects
// this whole file into the fixture page once (via the Playwright MCP's
// browser_evaluate). Thereafter each state is captured with a tiny call:
//   window.__guiMap.capture('<state>')
// which (1) closes any open overlay, (2) arranges the named state, (3) AUTO-DISCOVERS
// the significant elements visible in that state straight from the live DOM —
// deriving a handle / name / area / description and measuring the bounding rect —
// and (4) stashes the result in window.__captures[state]. A final read of
// window.__captures is written to captures.json and fed to build.js. There is no
// hand-curated manifest: the element list is whatever the DOM yields.
//
// NOT product code: it drives the real GUI from the outside, exactly as a user
// would (clicking rows, opening panels), and reads layout via getBoundingClientRect.

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(pred, { timeout = 5000, interval = 80 } = {}) {
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try { ok = pred(); } catch { ok = false; }
      if (ok) return true;
      if (Date.now() - t0 > timeout) return false;
      await sleep(interval);
    }
  }

  const rowByLabel = (label) =>
    [...document.querySelectorAll('#session-list li')].find((li) => {
      const s = li.querySelector('.sess-label');
      return s && s.textContent === label;
    });

  async function focusSession(label) {
    const row = rowByLabel(label);
    if (!row) throw new Error('no session row: ' + label);
    row.click();
    await waitFor(() => document.getElementById('head-label').textContent === label);
    await sleep(150);
  }

  async function rightClickRow(label) {
    const row = rowByLabel(label);
    if (!row) throw new Error('no session row: ' + label);
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 10),
    }));
    await waitFor(() => document.querySelector('.ctx-menu'));
  }

  const ctxItem = (label) =>
    [...document.querySelectorAll('.ctx-menu .ctx-item')].find((b) => b.textContent.trim() === label);

  // Reset to a clean base: drop menus, panels, modals, and preview/interaction
  // overlays so the next arrange starts from the bare main view.
  async function closeOverlays() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
    for (const sel of ['.ctx-menu', '.mode-menu', '.modal-overlay', '.float-panel', '.preview-box', '.interaction-overlay', '.img-ctx-menu']) {
      document.querySelectorAll(sel).forEach((el) => {
        const host = el.closest('.modal-overlay') || el;
        host.remove();
      });
    }
    // The error panel is a sidebar element (hidden via attribute, not an overlay);
    // hide it so it doesn't linger over the sidebar in later captures.
    const ep = document.getElementById('error-panel');
    if (ep) ep.hidden = true;
    await sleep(120);
  }

  // Per-state arrangement. Each leaves the page showing exactly the target state.
  async function arrange(state) {
    switch (state) {
      case 'main':
        await focusSession('alpha new 1');
        await waitFor(() => (document.getElementById('usage-chip').textContent || '').includes('tok'));
        return;
      case 'panel-topics':
        await focusSession('alpha new 1');
        await waitFor(() => document.querySelector('.float-topics li') || true); // topics poll
        document.getElementById('open-topics').click();
        await waitFor(() => document.querySelector('.float-topics li'));
        return;
      case 'panel-insession':
        await focusSession('alpha new 1');
        document.getElementById('open-insession').click();
        await waitFor(() => document.querySelector('.float-body .gui-todos li'));
        return;
      case 'panel-todomd':
        await focusSession('alpha new 1');
        document.getElementById('open-todomd').click();
        await waitFor(() => document.querySelector('.todomd-item'));
        return;
      case 'menu-mode':
        await focusSession('alpha new 1');
        document.getElementById('claude-mode').click();
        await waitFor(() => document.querySelector('.mode-menu .mode-menu-row'));
        return;
      case 'compose': {
        await focusSession('alpha new 1');
        const ed = document.querySelector('.gui-compose-input');
        ed.innerHTML = '';
        ed.appendChild(document.createTextNode('Match this screen: '));
        const span = document.createElement('span');
        span.className = 'img-token'; span.contentEditable = 'false'; span.textContent = '[Image #1]';
        ed.appendChild(span);
        ed.appendChild(document.createTextNode(' please.'));
        await waitFor(() => document.querySelector('.gui-compose-input .img-token'));
        return;
      }
      case 'working':
        await focusSession('alpha new 2');
        await waitFor(() => !document.getElementById('interrupt-btn').hidden);
        if (typeof window.composeSend === 'function') window.composeSend('Refactor the scanner now.');
        await waitFor(() => !document.querySelector('#gui-pane .gui-waiting').hidden);
        return;
      case 'menu-context':
        await rightClickRow('beta new 1');
        return;
      case 'modal-rename':
        await rightClickRow('beta new 1');
        ctxItem('Rename').click();
        await waitFor(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent === 'Rename session'));
        return;
      case 'modal-preview':
        await rightClickRow('beta new 1');
        ctxItem('Quick preview').click();
        await waitFor(() => document.querySelector('.preview-box'));
        await sleep(250); // let the peeked model render
        return;
      case 'picker-new':
        document.getElementById('add-btn').click();
        await waitFor(() => document.querySelector('.modal .project-row'));
        return;
      case 'picker-resume':
        document.getElementById('resume-btn').click();
        await waitFor(() => document.querySelector('.modal .recent-row'));
        return;
      case 'error-center':
        window.dispatchEvent(new ErrorEvent('error', { message: 'Demo: preview failed to render', error: new Error('demo: render path threw') }));
        await waitFor(() => !document.getElementById('error-toggle').hidden);
        document.getElementById('error-toggle').click();
        await waitFor(() => !document.getElementById('error-panel').hidden && document.querySelector('#error-list li'));
        return;
      case 'interaction-permission':
        await focusSession('beta new 2');
        await waitFor(() => document.querySelector('.interaction-card .interaction-input'));
        return;
      case 'interaction-plan':
        await focusSession('gamma new 1');
        await waitFor(() => document.querySelector('.interaction-card .interaction-input'));
        return;
      case 'interaction-question':
        await focusSession('gamma new 2');
        await waitFor(() => document.querySelector('.interaction-opt'));
        return;
      case 'interaction-elicitation':
        await focusSession('gamma new 3');
        await waitFor(() => document.querySelector('.interaction-field'));
        return;
      default:
        throw new Error('unknown state: ' + state);
    }
  }

  // ---- auto-discovery --------------------------------------------------------
  // Each known on-screen region maps to a glossary AREA. Overlays (modal/menu/
  // panel/interaction) also contribute a container entry (`captureRoot`); the
  // large base regions (sidebar/header/conv/compose) do not, to avoid a giant
  // full-region hotspot. Order matters: overlays first so their descendants are
  // claimed before the base regions sweep them up.
  const REGIONS = [
    { sel: '.interaction-card', area: 'INTERACTION', captureRoot: true, rootName: 'Interaction modal' },
    { sel: '.ctx-menu', area: 'MENU', captureRoot: true, rootName: 'Context menu' },
    { sel: '.mode-menu', area: 'MENU', captureRoot: true, rootName: 'Permission-mode menu' },
    { sel: '.preview-box', area: 'MODAL', captureRoot: true, rootName: 'Quick-preview window' },
    { sel: '.modal', area: 'MODAL', captureRoot: true, rootName: 'Modal dialog' },
    { sel: '.float-panel', area: 'PANEL', captureRoot: true, rootName: 'Floating panel' },
    { sel: '#session-head', area: 'HEADER', captureRoot: false },
    { sel: '.gui-compose', area: 'COMPOSE', captureRoot: false },
    { sel: '#gui-pane', area: 'CONV', captureRoot: false },
    { sel: '#sidebar', area: 'SIDEBAR', captureRoot: false },
  ];

  const GENERIC_CLASS = new Set(['icon', 'doc-btn', 'mode-chip', 'usage-chip', 'model-select', 'sess-label']);

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity || '1') === 0) return false;
    return true;
  }

  function hasAlnum(s) { return /[a-z0-9]/i.test(s); }
  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'el';
  }
  function humanize(s) { return String(s || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()); }
  function meaningfulClass(el) {
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean);
    return cls.find((c) => !GENERIC_CLASS.has(c) && !/^(active|sel|flash|seen)$/.test(c)) || cls[0] || '';
  }

  // A DOM element worth mapping: an interactive control, an identified element
  // (id / title / aria-label), or a labeled leaf (a classed element with short text
  // and no element children).
  function isCandidate(el) {
    const tag = el.tagName.toLowerCase();
    if (['button', 'select', 'input', 'textarea'].includes(tag)) return true;
    if (tag === 'a' && el.getAttribute('href')) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('role') === 'button') return true;
    if (el.id) return true;
    if (el.getAttribute('title') || el.getAttribute('aria-label')) return true;
    if (el.className && typeof el.className === 'string' && el.children.length === 0) {
      const t = (el.textContent || '').trim();
      if (t.length > 0 && t.length <= 80) return true;
    }
    return false;
  }

  // Generic hygiene (not per-element curation): a label is "noisy" if it is
  // volatile or path-like, so it must not become an element name (it would make
  // the doc non-deterministic, leak filesystem paths, or read as a JSON blob).
  function isNoisy(s) {
    if (!s) return true;
    if (/[A-Za-z]:[\\/]/.test(s)) return true;                       // windows path (C:\ , D:/)
    if (/\/[\w.-]+\/[\w.-]+/.test(s)) return true;                   // unix-ish path
    if (/\b\d{1,2}:\d{2}(:\d{2})?\b/.test(s)) return true;           // clock time
    if (/\d+\s*(m|h|d|min|mins|hour|hours|day|days)\s+ago\b/i.test(s)) return true; // relative time (also catches concatenated "alpha1m ago")
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(s)) return true;        // date
    if (/^[\s{[]/.test(s)) return true;                             // json-ish blob
    return false;
  }
  function clip(s) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length <= 60 ? s : s.slice(0, 57) + '…'; }

  function nameOf(el) {
    const tag = el.tagName.toLowerCase();
    const title = el.getAttribute('title');
    if (title && title.trim() && !isNoisy(title)) return clip(title);
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim() && !isNoisy(aria)) return clip(aria);
    if (tag === 'input') { const ph = el.getAttribute('placeholder'); if (ph && ph.trim() && !isNoisy(ph)) return clip(ph); }
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    // Short, non-volatile text is a good name; long text means a container (its
    // concatenated children) — fall back to a class/id name instead.
    if (txt && hasAlnum(txt) && !isNoisy(txt) && txt.length <= 60) return clip(txt);
    // volatile / container / symbol-only / no usable text: fall back to a meaningful class, then id, then tag.
    const mc = meaningfulClass(el);
    if (mc) return humanize(mc);
    if (el.id) return humanize(el.id);
    if (txt && hasAlnum(txt)) return clip(txt);
    return tag;
  }

  function descOf(el, name) {
    const title = el.getAttribute('title');
    if (title && title.trim() && !isNoisy(title) && title.trim() !== name) return clip(title);
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim() && !isNoisy(aria) && aria.trim() !== name) return clip(aria);
    const tag = el.tagName.toLowerCase();
    const kind = tag === 'a' ? 'link' : (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') ? tag : 'element';
    return `The "${name}" ${kind}.`;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // Discover the elements visible in the currently-arranged DOM. Deduped by handle
  // within the state (so repeated identical elements — e.g. many session rows —
  // collapse to one representative entry per kind).
  function discover(state) {
    const assigned = new Set();
    const byHandle = new Map();
    const add = (el, area, forcedName) => {
      if (assigned.has(el) || !visible(el)) return;
      assigned.add(el);
      const name = (forcedName || nameOf(el) || el.tagName.toLowerCase()).trim() || el.tagName.toLowerCase();
      const handle = 'GUI-' + area + '-' + slugify(name);
      if (byHandle.has(handle)) return; // dedup by kind within this state
      byHandle.set(handle, { handle, name, area, description: descOf(el, name), rect: rectOf(el) });
    };
    for (const region of REGIONS) {
      for (const root of document.querySelectorAll(region.sel)) {
        if (!visible(root)) continue;
        if (region.captureRoot) add(root, region.area, region.rootName);
        for (const el of root.querySelectorAll('*')) {
          if (assigned.has(el)) continue;
          if (!isCandidate(el)) continue;
          add(el, region.area);
        }
      }
    }
    return { title: STATE_TITLES[state] || state, viewport: { width: window.innerWidth, height: window.innerHeight }, elements: [...byHandle.values()] };
  }

  const STATE_TITLES = {
    main: 'Main view — focused conversation',
    'panel-topics': 'Topics panel',
    'panel-insession': 'In-session todos panel',
    'panel-todomd': 'TODO.md panel',
    'menu-mode': 'Permission-mode dropdown',
    compose: 'Compose box with an attached image token',
    working: 'A working session (stop button, current tool, waiting spinner)',
    'menu-context': 'Session right-click context menu',
    'modal-rename': 'Rename dialog',
    'modal-preview': 'Quick-preview window',
    'picker-new': 'New-session picker',
    'picker-resume': 'Resume picker',
    'error-center': 'GUI error center',
    'interaction-permission': 'Blocking modal — tool permission',
    'interaction-plan': 'Blocking modal — plan review',
    'interaction-question': 'Blocking modal — question',
    'interaction-elicitation': 'Blocking modal — MCP elicitation',
  };

  window.__captures = window.__captures || {};
  window.__guiMap = {
    version: 2,
    // Capture order: 'main' first (it needs all five status dots, which the
    // interaction states consume by focusing needs-you sessions); interactions last.
    STATE_ORDER: [
      'main', 'panel-topics', 'panel-insession', 'panel-todomd', 'menu-mode',
      'compose', 'working', 'menu-context', 'modal-rename', 'modal-preview',
      'picker-new', 'picker-resume', 'error-center',
      'interaction-permission', 'interaction-plan', 'interaction-question', 'interaction-elicitation',
    ],
    async capture(state) {
      await closeOverlays();
      await arrange(state);
      await sleep(120);
      const cap = discover(state);
      window.__captures[state] = cap;
      return { state, discovered: cap.elements.length };
    },
  };
  return { ok: true, version: window.__guiMap.version, states: window.__guiMap.STATE_ORDER.length };
})();
