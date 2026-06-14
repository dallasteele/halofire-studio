import { describe, it, expect } from 'vitest';
import { renderOutboundStatus } from '../src/autobid/outbound-settings-view.js';

describe('renderOutboundStatus', () => {
  it('renders not configured with password not set', () => {
    const line = renderOutboundStatus({ configured: false, enabled: false, password_set: false });
    expect(line).toContain('not configured');
    expect(line).toContain('password not set');
    expect(line).toContain('write-only');
  });

  it('renders not configured but password set', () => {
    const line = renderOutboundStatus({ configured: false, enabled: true, password_set: true });
    expect(line).toContain('not configured');
    expect(line).toContain('password set');
  });

  it('renders configured and enabled with the admin-approval reminder', () => {
    const line = renderOutboundStatus({ configured: true, enabled: true, password_set: true });
    expect(line).toContain('configured and enabled');
    expect(line).toContain('admin approval');
    expect(line).toContain('never shown');
  });

  it('renders configured but disabled (kill switch)', () => {
    const line = renderOutboundStatus({ configured: true, enabled: false, password_set: true });
    expect(line).toContain('configured and disabled');
    expect(line).toContain('nothing sends');
  });

  it('includes last send and last error when present', () => {
    const line = renderOutboundStatus({
      configured: true,
      enabled: true,
      password_set: true,
      last_send_at: '2026-06-12T00:00:00.000Z',
      last_error: 'relay refused',
    });
    expect(line).toContain('Last send 2026-06-12T00:00:00.000Z');
    expect(line).toContain('Last error: relay refused');
  });

  it('never includes credentials even when present on the config', () => {
    const line = renderOutboundStatus({
      configured: true,
      enabled: true,
      password_set: true,
      host: 'smtp.halofire.com',
      port: 587,
      username: 'bids@halofire.com',
      from_email: 'no-reply@halofire.com',
      password: 'hunter2-should-never-appear',
    });
    expect(line).not.toContain('smtp.halofire.com');
    expect(line).not.toContain('bids@halofire.com');
    expect(line).not.toContain('no-reply@halofire.com');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('587');
  });

  it('treats a missing config as not configured', () => {
    expect(renderOutboundStatus(null)).toContain('not configured');
    expect(renderOutboundStatus(undefined)).toContain('not configured');
  });
});
