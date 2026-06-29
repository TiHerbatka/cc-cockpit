// features-gui-mapping/tooling/probe.js
// DEV-ONLY browser-side capture helper for the /gui-map skill. The skill injects
// this whole file into the fixture page once (via the Playwright MCP's
// browser_evaluate), together with the manifest as window.__M. Thereafter each
// state is captured with a tiny call:  window.__guiMap.capture('<state>')
// which (1) closes any open overlay, (2) arranges the named state, (3) measures
// the bounding rect of every manifest element assigned to that state, and (4)
// stashes the result in window.__captures[state]. A final read of
// window.__captures is written to captures.json and fed to build.js.
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

  function measure(state) {
    const els = (window.__M.elements || []).filter((e) => e.state === state);
    const rects = {};
    for (const e of els) {
      const node = document.querySelector(e.selector);
      if (!node) continue; // missing -> drift (build.js reports it)
      const r = node.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects[e.handle] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return { viewport: { width: window.innerWidth, height: window.innerHeight }, rects };
  }

  window.__captures = window.__captures || {};
  window.__guiMap = {
    version: 1,
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
      const cap = measure(state);
      window.__captures[state] = cap;
      const want = (window.__M.elements || []).filter((e) => e.state === state).map((e) => e.handle);
      const got = Object.keys(cap.rects);
      const missing = want.filter((h) => !got.includes(h));
      return { state, captured: got.length, missing };
    },
  };
  return { ok: true, version: window.__guiMap.version, states: window.__guiMap.STATE_ORDER.length };
})();
