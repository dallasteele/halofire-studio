/**
 * Outbound-email (SMTP) settings view helper (AS-1).
 *
 * Renders the plain user-facing status line for the Settings page outbound
 * SMTP card. Takes the GET /api/settings/outbound-email body (which never
 * contains the password) and NEVER echoes credentials — no host, username,
 * from address, or password value ever appears in the output. Configuring
 * SMTP only makes the per-message admin approval gate able to transmit;
 * there is no auto-send path.
 */

/**
 * Returns the plain status string for the outbound SMTP config.
 *
 * @param {object} cfg - GET /api/settings/outbound-email body
 *   ({ configured, enabled, password_set, last_send_at, last_error, ... }).
 * @returns {string}
 */
export function renderOutboundStatus(cfg) {
  const c = cfg || {};
  if (!c.configured) {
    const pw = c.password_set ? 'set' : 'not set';
    return `Outbound SMTP not configured — password ${pw} (write-only). No client invite or bid email can send until host, port, username, and password are saved.`;
  }
  const state = c.enabled
    ? 'enabled — every send still requires explicit admin approval'
    : 'disabled — nothing sends until an admin enables it';
  const last = c.last_send_at ? ` Last send ${c.last_send_at}.` : '';
  const err = c.last_error ? ` Last error: ${c.last_error}.` : '';
  return `Outbound SMTP configured and ${state}. Password set (write-only, never shown).${last}${err}`;
}
