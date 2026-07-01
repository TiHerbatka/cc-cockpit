// .claude/skills/gui-map/probe.js
// DEV-ONLY browser-side capture helper for the /gui-map skill. The skill injects
// this whole file into the fixture page once (via the Playwright MCP's
// browser_evaluate). Thereafter each state is captured with a tiny call:
//   window.__guiMap.capture('<state>')
// which (1) closes any open overlay, (2) arranges the named state, (3) AUTO-DISCOVERS
// the significant elements visible in that state straight from the live DOM —
// deriving a handle / name / area / description and measuring the bounding rect —
// and (4) stashes the result in window.__captures[state]. A final read of
// window.__captures is written to captures.json and fed to build.js.
//
// v2 — ZERO product-code footprint. Identity comes from the cockpit's EXISTING
// markup, never from author-added markers: an element is mapped if it matches a
// SKILL-SIDE curated allowlist (durable classes / structural selectors → a stable
// slug + name, defined below) OR it is an interactive control with a stable label.
// Pure-data leaves are excluded. The allowlist lives here, in the skill, so the
// cockpit carries no `data-gui` attributes.
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
    // Clear any accumulated GUI errors so #error-toggle (the "GUI errors" pill) returns
    // to hidden between states — else the demo error fired by the error-center arrange
    // leaks the `gui-errors` element into every later capture and makes the run
    // non-reproducible (it would attach to a different state run-to-run after dedup).
    const ecl = document.getElementById('error-clear');
    if (ecl) ecl.click();
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

  // ---- the skill-side identity allowlist -------------------------------------
  // The cockpit carries NO mapping markers; identity for durable non-control
  // elements (and for controls whose visible text is volatile data) lives HERE.
  // Each entry: { sel, slug, name, opaque?, area? }. `el.matches(sel)` decides a
  // hit; the FIRST matching entry (list order) wins. `area` constrains an entry to
  // one region so a class shared across regions can't leak a handle into the wrong
  // area. A hit OVERRIDES auto-control-labeling, so a data-text button (project row,
  // mode row, ctx item, interaction option) gets a stable slug, not its text. To
  // surface a NEW durable element, add an entry here — never a marker in public/.
  // Slugs reproduce the established GUI-<area>-<slug> handle set exactly.
  const ALLOWLIST = [
    // SIDEBAR
    { sel: '#session-list', slug: 'session-list', name: 'Session List' },
    { sel: '#session-list li:not(.group-header)', slug: 'session-row', name: 'Session Row' }, // row <li> has no class
    { sel: '.group-header', slug: 'session-group-header', name: 'Session Group Header' },
    { sel: '#error-panel', slug: 'error-panel', name: 'Error Panel' },
    { sel: '#error-list', slug: 'error-list', name: 'Error List' },
    { sel: '#error-list li', slug: 'error-row', name: 'Error Row' },                          // row <li> has no class
    // HEADER — list #head-state BEFORE the generic .icon so the header icon keeps its own slug.
    { sel: '#head-state', slug: 'header-status-icon', name: 'Focused session status' },
    { sel: '#head-label', slug: 'header-label', name: 'Focused session name' },
    { sel: '#open-insession', slug: 'in-session-todo', name: 'In-session todos' },
    { sel: '#open-topics', slug: 'topics', name: 'Topics' },
    { sel: '#claude-mode', slug: 'mode', name: 'Permission mode' },
    { sel: '#model-select', slug: 'model', name: 'Model' },
    { sel: '#effort-select', slug: 'effort', name: 'Reasoning effort' },
    { sel: '#open-docs', slug: 'docs', name: 'Docs' },
    { sel: '#open-todomd', slug: 'todomd', name: 'TODO.md' },
    { sel: '#overflow-btn', slug: 'overflow-menu', name: 'Overflow actions menu' },
    { sel: '#interrupt-btn', slug: 'interrupt', name: 'Interrupt turn' },
    // SIDEBAR status icon — after #head-state; constrained to SIDEBAR (.icon also on #head-state).
    { sel: '.icon', area: 'SIDEBAR', slug: 'status-icon', name: 'Status Icon' },
    // CONV
    { sel: '.gui-status', slug: 'conv-status', name: 'Conv Status' },
    { sel: '.gui-log', slug: 'conv-log', name: 'Conv Log' },
    { sel: '.gui-user', slug: 'conv-user-message', name: 'Conv User Message' },
    { sel: '.gui-think', slug: 'conv-thinking', name: 'Conv Thinking' },
    { sel: '.gui-asst', slug: 'conv-assistant-message', name: 'Conv Assistant Message' },
    { sel: '.gui-tool', slug: 'conv-tool-card', name: 'Conv Tool Card' },
    { sel: '.gui-todoblock', slug: 'conv-todos', name: 'Conv Todos' },
    { sel: '.gui-tool-group', slug: 'conv-tool-group', name: 'Conv Tool Group' },
    // COMPOSE — also contenteditable; the allowlist fixes the slug to compose-input.
    { sel: '.gui-compose-input', slug: 'compose-input', name: 'Compose Input' },
    // PANEL — scoped selectors so CONV's own .gui-todos lis stay excluded.
    { sel: '.float-title', slug: 'panel-title', name: 'Panel Title' },
    { sel: '.float-topics > li', slug: 'panel-topic', name: 'Panel Topic' },
    { sel: '.float-body .gui-todos > li', slug: 'panel-todo-item', name: 'Panel Todo Item' },
    { sel: '.todomd-section', slug: 'panel-todomd-section', name: 'Panel Todomd Section' },
    { sel: '.todomd-item', slug: 'panel-todomd-item', name: 'Panel Todomd Item' },
    // INTERACTION
    { sel: '.interaction-head', slug: 'interaction-head', name: 'Interaction Head' },
    { sel: '.interaction-sub', slug: 'interaction-sub', name: 'Interaction Sub' },
    { sel: '.interaction-input', slug: 'interaction-input', name: 'Interaction Input' },
    { sel: '.interaction-opt', slug: 'interaction-option', name: 'Interaction Option' },
    { sel: '.interaction-field', slug: 'interaction-field', name: 'Interaction Field' },
    // MODAL
    { sel: '.modal h2', slug: 'modal-title', name: 'Modal Title' },                            // h2 has no class
    { sel: '.modal-create input:not([placeholder])', slug: 'rename-input', name: 'Rename Input' }, // no id/class/placeholder
    { sel: '.preview-gui', slug: 'preview-body', name: 'Preview Body', opaque: true },
    { sel: '.modal-search', slug: 'modal-search', name: 'Modal Search' },
    { sel: '.older-toggle', slug: 'older-toggle', name: 'Older Toggle' },
    { sel: '.never-used-chip', slug: 'never-used-chip', name: 'Never Used Chip' },
    { sel: '.resume-col-head', slug: 'resume-col-head', name: 'Resume Col Head' },
    { sel: '.project-row', slug: 'project-row', name: 'Project Row' },                          // button w/ volatile text
    { sel: '.recent-group', slug: 'recent-group', name: 'Recent Group' },
    { sel: '.recent-row', slug: 'recent-row', name: 'Recent Row' },                             // button w/ volatile text
    // MENU
    { sel: '.mode-menu-name', slug: 'mode-menu-option', name: 'Mode Menu Option' },             // button w/ volatile mode text
    { sel: '.mode-menu-help', slug: 'mode-menu-help', name: 'Mode Menu Help' },
    { sel: '.ctx-item', slug: 'context-menu-item', name: 'Context Menu Item' },                 // button w/ menu text
  ];

  // Selector union for opaque subtrees (map the element, but don't descend into it).
  const OPAQUE_SEL = ALLOWLIST.filter((a) => a.opaque).map((a) => a.sel).join(',');

  // First allowlist entry whose selector this element matches within `area`.
  function matchAllow(el, area) {
    for (const a of ALLOWLIST) {
      if (a.area && a.area !== area) continue;
      let hit = false;
      try { hit = el.matches(a.sel); } catch { hit = false; }
      if (hit) return a;
    }
    return null;
  }

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

  // A DOM element worth mapping: one matched by the skill-side allowlist (durable
  // identity), or an unambiguous interactive control with a stable label. Pure-data
  // leaves (classed text with neither) are intentionally NOT candidates.
  function isInteractiveControl(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'select' || tag === 'input' || tag === 'textarea') return true;
    if (tag === 'a' && el.getAttribute('href')) return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('role') === 'button') return true;
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

  // Stable label for an UNMARKED interactive control (one with no allowlist entry):
  // never free-text-first as identity, but a short fixed caption IS acceptable (every
  // volatile-text control is in the allowlist, so the text reaching here is a stable
  // caption like "Send", "Save", "Approve & auto-accept edits").
  function controlLabel(el) {
    const aria = el.getAttribute('aria-label'); if (aria && aria.trim() && !isNoisy(aria)) return clip(aria);
    const title = el.getAttribute('title');     if (title && title.trim() && !isNoisy(title)) return clip(title);
    if (el.tagName.toLowerCase() === 'input') { const ph = el.getAttribute('placeholder'); if (ph && ph.trim() && !isNoisy(ph)) return clip(ph); }
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt && hasAlnum(txt) && !isNoisy(txt) && txt.length <= 48) return clip(txt);
    if (el.id) return humanize(el.id);
    const mc = meaningfulClass(el); if (mc) return humanize(mc);   // e.g. ✕-only buttons → class
    return el.tagName.toLowerCase();
  }

  // Returns { slug, name }. An allowlist hit supplies the literal slug/name; an
  // unmarked control derives them from its stable label.
  function identity(el, allow) {
    if (allow) return { slug: allow.slug, name: allow.name };
    const label = controlLabel(el);
    return { slug: slugify(label), name: humanize(label) };
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

  // Skip descendants of an opaque element (map the opaque element itself, but do NOT
  // re-map its subtree — e.g. the read-only preview conv mirror, .preview-gui).
  function inOpaqueSubtree(el) {
    if (!OPAQUE_SEL) return false;
    const op = el.closest(OPAQUE_SEL);
    return !!op && op !== el;
  }

  // Backstop for UNMARKED repeats: collapse 3+ siblings that share a NON-EMPTY
  // meaningful class within the same region. The allowlist already folds intended
  // repeats by handle; this only catches a future un-listed data list of controls.
  // It deliberately does NOT fire for allowlisted elements or for classless controls
  // (so distinct fixed-label tabs/buttons are never merged).
  function signature(el, area) {
    return area + '|' + el.tagName + '|' + meaningfulClass(el);
  }

  // Discover the elements visible in the currently-arranged DOM. Deduped by handle
  // within the state (so repeated identical elements — e.g. many session rows —
  // collapse to one representative entry per kind, because they share a slug).
  function discover(state) {
    const assigned = new Set();
    const byHandle = new Map();
    const add = (el, area, forcedName, allow) => {
      if (assigned.has(el) || !visible(el)) return;
      assigned.add(el);
      let slug, name;
      if (forcedName) { name = forcedName; slug = slugify(forcedName); }   // captureRoot path
      else { ({ slug, name } = identity(el, allow)); }
      const handle = 'GUI-' + area + '-' + slug;
      if (byHandle.has(handle)) return;                                    // folds repeats with the same slug
      byHandle.set(handle, { handle, name, area, description: descOf(el, name), rect: rectOf(el) });
    };
    for (const region of REGIONS) {
      for (const root of document.querySelectorAll(region.sel)) {
        if (!visible(root)) continue;
        if (region.captureRoot) add(root, region.area, region.rootName);
        const sigCount = new Map();
        for (const el of root.querySelectorAll('*')) {
          if (assigned.has(el)) continue;
          if (inOpaqueSubtree(el)) continue;
          const allow = matchAllow(el, region.area);
          if (!allow && !isInteractiveControl(el)) continue;     // not a candidate
          // signature backstop: only for UNMARKED candidates with a non-empty class
          if (!allow && meaningfulClass(el)) {
            const sig = signature(el, region.area);
            const n = (sigCount.get(sig) || 0) + 1; sigCount.set(sig, n);
            if (n >= 3) continue;   // 3rd+ identical sibling → drop (keep the first representative)
          }
          add(el, region.area, undefined, allow);
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
    version: 3,
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

  // F3-1 determinism: freeze CSS transitions/animations once at init, before any
  // capture. An element mid-transition has opacity<1 or a sub-final size, so it would
  // flip in/out of visible()/rectOf() depending on timing (the run-to-run handle drift).
  // Snapping every element to its final computed style makes discovery deterministic.
  if (!document.getElementById('__guimap_freeze')) {
    const freeze = document.createElement('style');
    freeze.id = '__guimap_freeze';
    freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(freeze);
  }

  return { ok: true, version: window.__guiMap.version, states: window.__guiMap.STATE_ORDER.length };
})();
