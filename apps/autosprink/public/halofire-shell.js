/* ============================================================================
 * HaloFire — shared shell (one nav + glass theming + per-page Fire color).
 * Pairs with public/styles/halofire-glass.css. Include on every page:
 *   <body class="hf" data-hf-page="workbench"> ... <script src="/public/halofire-shell.js"></script>
 * - injects ONE consistent top app bar (brandmark + nav + role chip)  -> nav stability
 * - applies the saved glass-color THEME (Settings picker)              -> themeable glass
 * - sets the per-page "Fire" brandmark color (by function)             -> color coding
 * Opt out of the auto app bar with data-hf-appbar="off" (e.g. Studio mounts its own).
 * ========================================================================== */
(function () {
  var BUST = 'g1'; // cache-bust token; bump on redesign waves

  // ---- GLASS TINT (control 1) — the color of the glass WINDOWS only ----
  // The brand accent (login gold) stays constant for consistency; only the glass
  // tint changes. Set INDEPENDENTLY of the ember background (control 2 below).
  // Ordered ROYGBIV (warm -> cool), with the neutral darks last. Claude = the
  // Anthropic clay/coral accent, offered as both a glass tint and a background.
  var THEMES = {
    claude: { name: 'Claude', tint: '52,30,22', sw: '#341e16' }, // R/O — Claude clay
    ember:  { name: 'Ember',  tint: '34,22,14', sw: '#22160e' }, // O
    gold:   { name: 'Gold',   tint: '38,31,17', sw: '#3a3018' }, // Y
    steel:  { name: 'Steel',  tint: '24,32,44', sw: '#18202c' }, // B
    azure:  { name: 'Azure',  tint: '18,30,50', sw: '#121e32' }, // B/indigo
    onyx:   { name: 'Onyx',   tint: '14,12,10', sw: '#0e0c0a' }, // neutral
    ash:    { name: 'Ash',    tint: '40,39,36', sw: '#282724' }  // neutral
  };

  // ---- EMBER BACKGROUND COLOR (control 2) — the static ember image's glow tint ----
  // Independent of the glass tint. Ordered ROYGBIV. Changing this recolors the
  // background only, not the glass.
  var EMBERS = {
    crimson: { name: 'Crimson', rgb: '216,54,34' },   // R
    claude:  { name: 'Claude',  rgb: '217,119,87' },  // R/O — Claude clay
    amber:   { name: 'Amber',   rgb: '240,116,46' },  // O
    gold:    { name: 'Gold',    rgb: '216,160,70' },  // Y
    emerald: { name: 'Emerald', rgb: '70,168,120' },  // G
    azure:   { name: 'Azure',   rgb: '70,138,226' },  // B
    violet:  { name: 'Violet',  rgb: '150,96,212' }   // V
  };

  // ---- per-page "Fire" color, by function — every color from the login palette ----
  var FIRE = {
    workbench:    '#f2ece0', // paper
    studio:       '#e8432d', // fire red
    vendors:      '#e32621', // login red
    calendar:     '#c89a3c', // gold
    reports:      '#f7d516', // ember yellow (login bg)
    crm:          '#ffd54f', // halo yellow
    settings:     '#b8b8b2', // login muted
    officialflow: '#e8432d', // fire red
    _default:     '#e8432d'
  };

  var NAV = [
    { id: 'workbench', label: 'Workbench', href: 'workbench.html' },
    { id: 'studio',    label: 'Studio',    href: 'autosprink.html' },
    { id: 'calendar',  label: 'Calendar',  href: 'calendar.html' },
    { id: 'crm',       label: 'CRM',       href: 'crm.html' },
    { id: 'reports',   label: 'Reports',   href: 'reports.html' },
    { id: 'vendors',   label: 'Vendors',   href: 'vendors.html' },
    { id: 'settings',  label: 'Settings',  href: 'settings.html' }
  ];

  function applyTheme(id) {
    var t = THEMES[id] || THEMES.ember;
    var r = document.documentElement.style;
    r.setProperty('--hf-glass-tint', t.tint);
    // Sync the legacy token surfaces so flat token-based cards recolor with the tint too.
    r.setProperty('--hf-color-surface', 'rgba(' + t.tint + ',0.80)');
    r.setProperty('--hf-color-surface-raised', 'rgba(' + t.tint + ',0.90)');
    r.setProperty('--surface', 'rgba(' + t.tint + ',0.80)');
    r.setProperty('--surface2', 'rgba(' + t.tint + ',0.90)');
    document.documentElement.setAttribute('data-hf-theme', id);
  }
  function savedTheme() { try { return localStorage.getItem('hf-theme') || 'ember'; } catch (e) { return 'ember'; } }
  function setTheme(id) { try { localStorage.setItem('hf-theme', id); } catch (e) {} applyTheme(id); }

  // ---- ember background color (control 2, independent of the glass tint) ----
  function applyEmber(id) {
    var e = EMBERS[id] || EMBERS.amber;
    document.documentElement.style.setProperty('--hf-ember-rgb', e.rgb);
    document.documentElement.setAttribute('data-hf-ember', id);
    if (window.__hfEmberRedraw) window.__hfEmberRedraw();   // recolor static embers
  }
  function savedEmber() { try { return localStorage.getItem('hf-ember') || 'amber'; } catch (e) { return 'amber'; } }
  function setEmber(id) { try { localStorage.setItem('hf-ember', id); } catch (e) {} applyEmber(id); }

  // ---- floating embers (static by default; optional SLOW drift) ----------------
  // Soft glow comes from the CSS + the glow SVG; these are the floating embers the
  // user asked for. Static unless the Settings "Moving" toggle is on, and even then
  // the drift is intentionally slow + capped, and forced off under prefers-reduced-motion.
  function savedEmberMotion() { try { return localStorage.getItem('hf-ember-motion') || 'off'; } catch (e) { return 'off'; } }
  function setEmberMotion(v) { try { localStorage.setItem('hf-ember-motion', v); } catch (e) {} applyEmberMotion(v); }

  var _emb = { c: null, x: null, parts: [], raf: 0, motion: false, dpr: 1 };
  function _embColor() { return (getComputedStyle(document.documentElement).getPropertyValue('--hf-ember-rgb').trim()) || '240,116,46'; }
  function _embBuild() {
    var c = _emb.c; if (!c) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2); _emb.dpr = dpr;
    var w = c.width = Math.floor(window.innerWidth * dpr), h = c.height = Math.floor(window.innerHeight * dpr);
    c.style.width = window.innerWidth + 'px'; c.style.height = window.innerHeight + 'px';
    var n = Math.round(Math.min(64, Math.max(24, (window.innerWidth * window.innerHeight) / 38000)));
    _emb.parts = [];
    for (var i = 0; i < n; i++) _emb.parts.push({
      x: Math.random() * w, y: Math.random() * h,
      r: (0.5 + Math.random() * 1.9) * dpr,
      a: 0.16 + Math.random() * 0.55,
      vy: -(3 + Math.random() * 7) * dpr / 60,   // slow upward px/frame
      ph: Math.random() * 6.28, sway: 0.3 + Math.random() * 0.6, sx: (7 + Math.random() * 12) * dpr
    });
  }
  function _embDraw() {
    var c = _emb.c, x = _emb.x; if (!c || !x) return;
    x.clearRect(0, 0, c.width, c.height);
    var col = _embColor();
    for (var i = 0; i < _emb.parts.length; i++) {
      var p = _emb.parts[i], px = p.x + Math.sin(p.ph) * p.sx, rr = p.r * 3.0;
      var g = x.createRadialGradient(px, p.y, 0, px, p.y, rr);
      g.addColorStop(0, 'rgba(' + col + ',' + p.a + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, p.y, rr, 0, 6.2832); x.fill();
    }
  }
  function _embTick() {
    var c = _emb.c; if (!c) return;
    for (var i = 0; i < _emb.parts.length; i++) {
      var p = _emb.parts[i]; p.y += p.vy; p.ph += 0.004 * p.sway;   // slow
      if (p.y < -12) { p.y = c.height + 12; p.x = Math.random() * c.width; }
    }
    _embDraw(); _emb.raf = requestAnimationFrame(_embTick);
  }
  function applyEmberMotion(v) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    _emb.motion = (v === 'on') && !reduce;
    if (_emb.raf) { cancelAnimationFrame(_emb.raf); _emb.raf = 0; }
    if (_emb.motion) _emb.raf = requestAnimationFrame(_embTick); else _embDraw();
  }
  function injectEmberCanvas() {
    if (document.getElementById('hf-ember-canvas')) return;
    if (document.body.getAttribute('data-hf-embers') === 'off') return;
    var c = document.createElement('canvas'); c.id = 'hf-ember-canvas';
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none';
    document.body.insertBefore(c, document.body.firstChild);
    _emb.c = c; _emb.x = c.getContext('2d');
    _embBuild();
    window.__hfEmberRedraw = function () { if (!_emb.motion) _embDraw(); };  // recolor hook (static)
    var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { _embBuild(); if (!_emb.motion) _embDraw(); }, 200); });
    applyEmberMotion(savedEmberMotion());
  }

  // ---- light / dark MODE (separate from the glass color) ----
  function savedMode() { try { return localStorage.getItem('hf-mode') || 'dark'; } catch (e) { return 'dark'; } }
  function applyMode(m) { document.documentElement.setAttribute('data-hf-mode', m === 'light' ? 'light' : 'dark'); }
  function setMode(m) { try { localStorage.setItem('hf-mode', m); } catch (e) {} applyMode(m); }

  function page() { return (document.body && document.body.getAttribute('data-hf-page')) || '_default'; }
  function applyFire() { document.documentElement.style.setProperty('--hf-fire-color', FIRE[page()] || FIRE._default); }

  function brand() {
    return '<span class="hf-brand">Halo<span class="fire">Fire</span><span class="sub">' +
      (page() === 'studio' ? 'Sprinkler CAD' : 'Halo Fire Protection') + '</span></span>';
  }

  function navHtml() {
    var cur = page();
    var links = NAV.map(function (n) {
      var active = n.id === cur ? ' active' : '';
      return '<a class="' + n.id + active + '" href="/' + n.href + '?hf=' + BUST + '">' + n.label + '</a>';
    }).join('');
    return '<nav class="hf-nav">' + links + '</nav>';
  }

  // Keep the app bar's identity state truthful. A 401 means the operator needs
  // to sign in; a network/5xx response is a runtime/session-health problem and
  // must not be presented as either an authenticated user or a sign-in prompt.
  function applyAuthSurface(root, response, payload) {
    var query = root && root.querySelector
      ? function (selector) { return root.querySelector(selector); }
      : function (selector) { return document.querySelector(selector); };
    var role = query('#hfRole');
    var signout = query('#hfSignout');
    if (!role) return;
    if (response && response.status === 401) {
      role.innerHTML = '<span class="dot"></span> Sign in required';
      role.setAttribute('aria-label', 'Sign in required');
      if (signout) {
        signout.textContent = 'Sign in';
        signout.href = '/';
        signout.removeAttribute('aria-hidden');
        signout.onclick = null;
      }
      return;
    }
    if (!response || !response.ok || !payload) {
      role.innerHTML = '<span class="dot"></span> Session unavailable';
      role.setAttribute('aria-label', 'Session unavailable');
      if (signout) {
        signout.hidden = true;
        signout.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    var u = payload.user || payload;
    var name = u.name || u.username || 'User';
    var jobRole = u.position || u.role || '';
    role.innerHTML = '<span class="dot"></span> ' + name + (jobRole ? ' · ' + jobRole : '');
    role.removeAttribute('aria-label');
  }

  function hydrateAuthSurface(root) {
    return fetch('/api/auth/me', { credentials: 'include' }).then(function (response) {
      if (!response.ok) {
        applyAuthSurface(root, response, null);
        return null;
      }
      return response.json().then(function (payload) {
        applyAuthSurface(root, response, payload);
        return payload;
      });
    }).catch(function () {
      applyAuthSurface(root, null, null);
      return null;
    });
  }

  function injectAppbar() {
    if (document.body.getAttribute('data-hf-appbar') === 'off') return;
    if (document.querySelector('.hf-appbar')) return;
    var bar = document.createElement('header');
    bar.className = 'hf-appbar';
    bar.innerHTML =
      brand() + navHtml() +
      '<div class="hf-right">' +
        '<span class="hf-role-chip" id="hfRole"><span class="dot"></span> …</span>' +
        '<a class="hf-signout" id="hfSignout" href="#">Sign out</a>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);
    var so = document.getElementById('hfSignout');
    if (so) so.onclick = function (e) {
      e.preventDefault();
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(function () { location.href = '/index.html'; })
        .catch(function () { location.href = '/index.html'; });
    };
    // Fill the identity surface from the cookie session, preserving 401 versus
    // runtime/network failure semantics in the visible app bar.
    hydrateAuthSurface(document);
  }

  function boot() {
    document.body.classList.add('hf');
    applyMode(savedMode());
    applyTheme(savedTheme());
    applyEmber(savedEmber());
    applyFire();
    injectAppbar();
    injectEmberCanvas();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // public API for the Settings appearance controls
  window.HFTheme = {
    themes: THEMES, get: savedTheme, set: setTheme, apply: applyTheme,
    embers: EMBERS, getEmber: savedEmber, setEmber: setEmber, applyEmber: applyEmber,
    getEmberMotion: savedEmberMotion, setEmberMotion: setEmberMotion,
    fireMap: FIRE, getMode: savedMode, setMode: setMode
  };
})();
