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
  var THEMES = {
    ember:  { name: 'Ember',  tint: '22,18,14', sw: '#221812' },
    onyx:   { name: 'Onyx',   tint: '14,12,10', sw: '#0e0c0a' },
    ash:    { name: 'Ash',    tint: '40,39,36', sw: '#282724' },
    gold:   { name: 'Gold',   tint: '38,31,17', sw: '#3a3018' },
    steel:  { name: 'Steel',  tint: '24,32,44', sw: '#18202c' },
    azure:  { name: 'Azure',  tint: '18,30,50', sw: '#121e32' }
  };

  // ---- EMBER BACKGROUND COLOR (control 2) — the static ember image's glow tint ----
  // Independent of the glass tint. Changing this recolors the background, not the glass.
  var EMBERS = {
    amber:   { name: 'Amber',   rgb: '240,116,46' },
    crimson: { name: 'Crimson', rgb: '216,54,34' },
    gold:    { name: 'Gold',    rgb: '216,160,70' },
    azure:   { name: 'Azure',   rgb: '70,138,226' },
    violet:  { name: 'Violet',  rgb: '150,96,212' },
    emerald: { name: 'Emerald', rgb: '70,168,120' }
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
  }
  function savedEmber() { try { return localStorage.getItem('hf-ember') || 'amber'; } catch (e) { return 'amber'; } }
  function setEmber(id) { try { localStorage.setItem('hf-ember', id); } catch (e) {} applyEmber(id); }

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
    // fill the role chip from the session if available
    fetch('/api/auth/me', { credentials: 'include' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var el = document.getElementById('hfRole'); if (!el) return;
      var u = d && (d.user || d) || {};
      var name = u.name || u.username || 'User';
      var role = u.position || u.role || '';
      el.innerHTML = '<span class="dot"></span> ' + name + (role ? ' · ' + role : '');
    }).catch(function () {});
  }

  function boot() {
    document.body.classList.add('hf');
    applyMode(savedMode());
    applyTheme(savedTheme());
    applyEmber(savedEmber());
    applyFire();
    injectAppbar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // public API for the Settings appearance controls
  window.HFTheme = {
    themes: THEMES, get: savedTheme, set: setTheme, apply: applyTheme,
    embers: EMBERS, getEmber: savedEmber, setEmber: setEmber, applyEmber: applyEmber,
    fireMap: FIRE, getMode: savedMode, setMode: setMode
  };
})();
