/* HaloFire shared auth guard — HFAuth (cookie-session based).
 *
 * The server issues an HttpOnly+Secure+SameSite=Lax `halofire_session` cookie
 * on login. Pages must NEVER gate on localStorage/sessionStorage tokens (the
 * cookie is invisible to JS by design) and must NEVER blanket-redirect on any
 * 401 from a feature API call — that caused false "logouts" mid-session.
 *
 * NOTE: This module is UI-gating only ([data-role] show/hide is cosmetic).
 * Server-side RBAC enforcement per-endpoint is a later phase — do not rely on
 * this file for security.
 */
(function () {
  'use strict';

  var BASE_PATH = window.location.pathname.indexOf('/halo-fire/') === 0 ? '/halo-fire' : '';
  var API_BASE = BASE_PATH + '/api';

  function normalizeRole(role) {
    return String(role || 'user').trim().toLowerCase();
  }

  /* Legacy pages stored a bearer token that cookie-login never sets; stale
   * copies caused false logout loops. Clear them everywhere, always. */
  function clearLegacyTokens() {
    try { localStorage.removeItem('halofire_token'); localStorage.removeItem('halofire_user'); } catch (_) {}
    try { sessionStorage.removeItem('halofire_token'); sessionStorage.removeItem('halofire_user'); } catch (_) {}
  }

  /* api(path, opts): fetch API_BASE+path with cookies. 401 -> throw (err.status
   * = 401), NO auto-redirect. Other !ok -> throw with server error message.
   * JSON responses are parsed; anything else returns text. */
  function api(path, opts) {
    opts = opts || {};
    var options = {};
    for (var k in opts) options[k] = opts[k];
    options.credentials = 'include';
    options.headers = {};
    var inHeaders = opts.headers || {};
    for (var h in inHeaders) options.headers[h] = inHeaders[h];
    if (options.body && typeof options.body !== 'string') options.body = JSON.stringify(options.body);
    if (options.body && !options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
    var url = API_BASE + (String(path).charAt(0) === '/' ? path : '/' + path);
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        var unauth = new Error('unauthorized');
        unauth.status = 401;
        unauth.response = res;
        throw unauth;
      }
      if (!res.ok) {
        return res.text().then(function (raw) {
          var message = raw;
          try { message = JSON.parse(raw).error || raw; } catch (_) {}
          var err = new Error(message || ('HTTP ' + res.status));
          err.status = res.status;
          err.response = res;
          throw err;
        });
      }
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
  }

  function applyWhoami(user) {
    var label = (user.name || user.username || 'user') + ' · ' + normalizeRole(user.role);
    var nodes = document.querySelectorAll('[data-whoami]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = label;
  }

  /* [data-role="admin"] / [data-role="admin estimator"]: element is visible
   * only to the listed roles. Admin always sees everything. UI-only. */
  function applyRoleGates(user) {
    var role = normalizeRole(user.role);
    var nodes = document.querySelectorAll('[data-role]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var allowed = (el.getAttribute('data-role') || '')
        .split(/[\s,]+/)
        .map(normalizeRole)
        .filter(Boolean);
      var visible = role === 'admin' || allowed.length === 0 || allowed.indexOf(role) !== -1;
      el.hidden = !visible;
      if (!visible) { el.style.display = 'none'; } else { el.style.removeProperty('display'); }
    }
  }

  function redirectToLogin() {
    var target = window.location.pathname + window.location.search + window.location.hash;
    window.location = BASE_PATH + '/?redirect=' + encodeURIComponent(target);
  }

  /* guard(): the ONLY place that may redirect to login, and only on a real
   * 401 from /api/auth/me. Network/server errors do NOT bounce the user. */
  function guard() {
    clearLegacyTokens();
    return api('/auth/me').then(function (me) {
      HFAuth.user = me;
      applyWhoami(me);
      applyRoleGates(me);
      return me;
    }).catch(function (err) {
      if (err && err.status === 401) {
        redirectToLogin();
        return new Promise(function () {}); // page is navigating away
      }
      throw err;
    });
  }

  function logout() {
    return fetch(API_BASE + '/auth/logout', { method: 'POST', credentials: 'include' })
      .catch(function () {})
      .then(function () {
        clearLegacyTokens();
        HFAuth.user = null;
        window.location = BASE_PATH + '/';
      });
  }

  function hasRole(role) {
    var current = normalizeRole(HFAuth.user && HFAuth.user.role);
    return current === 'admin' || current === normalizeRole(role);
  }

  var HFAuth = {
    api: api,
    guard: guard,
    logout: logout,
    hasRole: hasRole,
    user: null,
    BASE_PATH: BASE_PATH,
    API_BASE: API_BASE,
  };
  window.HFAuth = HFAuth;
})();
