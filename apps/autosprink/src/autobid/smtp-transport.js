/**
 * AB5 — Outbound SMTP transport seam (fail-closed).
 *
 * The ONLY place an email is actually transmitted. Mirrors AB2's read-only IMAP
 * transport but for sending. There is NO auto-send path: this is invoked only
 * from the per-message admin approval route.
 *
 * Test seam: when HALOFIRE_SMTP_MOCK is set (or a transport is injected via
 * app.locals.smtpTransportFactory), a mock transport is used and NO real network
 * call is made. Production uses nodemailer.
 *
 * createSmtpTransport(cfg, { logger }) -> { sendMail({from,to,subject,html}) }
 */

/**
 * Build a nodemailer-backed transport. Imported lazily so the module loads even
 * in environments where nodemailer is only a transitive dependency.
 */
export async function createSmtpTransport(cfg, { logger = console } = {}) {
  if (!cfg || !cfg.host || !cfg.port || !cfg.username || !cfg.password) {
    throw new Error('SMTP not configured');
  }
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port),
    // 465 implies implicit TLS; other ports use STARTTLS upgrade.
    secure: Number(cfg.port) === 465,
    auth: { user: cfg.username, pass: cfg.password },
  });
  return {
    async sendMail({ from, to, subject, html }) {
      const info = await transporter.sendMail({ from, to, subject, html });
      logger.info?.(`smtp: sent message ${info?.messageId || ''} to ${to}`);
      return { messageId: info?.messageId || null, accepted: info?.accepted || [to] };
    },
  };
}

/**
 * In-memory mock transport for tests. Records every sent message on `.sent`.
 * Set `failWith` to force a send failure (to exercise the failure path).
 */
export function createMockSmtpTransport({ failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(message) {
      if (failWith) throw new Error(failWith);
      sent.push(message);
      return { messageId: `mock-${sent.length}`, accepted: [message.to] };
    },
  };
}

export default { createSmtpTransport, createMockSmtpTransport };
