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

  // ---- glass-color themes (all within the Halo Fire palette) ----
  var THEMES = {
    charcoal: { name: 'Charcoal', tint: '18,22,28',  accent: '#d9a441', accentRgb: '217,164,65',  accentBright: '#f0bd5a' },
    onyx:     { name: 'Onyx',     tint: '13,15,19',   accent: '#d9a441', accentRgb: '217,164,65',  accentBright: '#f0bd5a' },
    ember:    { name: 'Ember',    tint: '34,21,18',   accent: '#e8432d', accentRgb: '232,67,45',   accentBright: '#ff6a52' },
    gold:     { name: 'Gold',     tint: '30,26,17',   accent: '#c89a3c', accentRgb: '200,154,60',  accentBright: '#e6bf63' },
    halo:     { name: 'Halo',     tint: '33,29,15',   accent: '#ffd54f', accentRgb: '255,213,79',  accentBright: '#ffe48a' },
    slate:    { name: 'Slate',    tint: '19,25,33',   accent: '#5aa9e6', accentRgb: '90,169,230',  accentBright: '#86c4f5' }
  };

  // ---- per-page "Fire" color, by function ----
  var FIRE = {
    workbench: '#f2ece0', // paper
    studio:    '#e8432d', // fire red
    calendar:  '#c89a3c', // gold
    crm:       '#ffd54f', // halo yellow
    reports:   '#5aa9e6', // blue
    vendors:   '#54b67a', // green
    settings:  '#9aa4b2', // muted
    _default:  '#e8432d'
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
    var t = THEMES[id] || THEMES.charcoal;
    var r = document.documentElement.style;
    r.setProperty('--hf-glass-tint', t.tint);
    r.setProperty('--hf-accent', t.accent);
    r.setProperty('--hf-accent-rgb', t.accentRgb);
    r.setProperty('--hf-accent-bright', t.accentBright);
    document.documentElement.setAttribute('data-hf-theme', id);
  }
  function savedTheme() { try { return localStorage.getItem('hf-theme') || 'charcoal'; } catch (e) { return 'charcoal'; } }
  function setTheme(id) { try { localStorage.setItem('hf-theme', id); } catch (e) {} applyTheme(id); }

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
        '<span class="hf-icon" title="Assistant" id="hfAsk">✦</span>' +
        '<span class="hf-role-chip" id="hfRole"><span class="dot"></span> …</span>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);
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
    applyTheme(savedTheme());
    applyFire();
    injectAppbar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  // public API for the Settings glass-color picker
  window.HFTheme = { themes: THEMES, get: savedTheme, set: setTheme, apply: applyTheme, fireMap: FIRE };
})();
