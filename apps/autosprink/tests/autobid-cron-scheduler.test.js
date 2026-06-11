import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import scheduler, { CronScheduler } from '../src/cron/scheduler.js';

// AB2 regression — the headline feature is a 15-minute intake watcher. It only
// runs if (a) scheduler.init() registers the autobid-intake skill's cron, and
// (b) `npm run cron` (node src/cron/scheduler.js) actually starts the scheduler
// and stays alive. The original module exported a constructed-but-never-started
// singleton with no main-guard, so the process exited 0 with zero jobs.

const ROOT = path.resolve(import.meta.dirname, '..');

describe('CronScheduler.init — registers the 15-minute intake job', () => {
  afterEach(() => { scheduler.stop(); });

  it('registers the autobid-intake skill cron at */15 * * * *', () => {
    const s = new CronScheduler();
    s.init();
    const status = s.status();
    const intake = status.jobs.find((j) => j.id === 'autobid-intake');
    expect(intake, 'autobid-intake job must be registered by init()').toBeTruthy();
    expect(intake.schedule).toBe('*/15 * * * *');
    expect(intake.action).toBe('cronRun');
    s.stop();
    expect(s.status().totalJobs).toBe(0);
  });
});

describe('npm run cron — main-guard starts the scheduler and stays alive', () => {
  let child;
  afterEach(() => { if (child && !child.killed) child.kill('SIGTERM'); });

  it('node src/cron/scheduler.js registers jobs and does NOT exit immediately', async () => {
    child = spawn(process.execPath, ['src/cron/scheduler.js'], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    // Watch for an early exit (the original bug) vs. a healthy keep-alive.
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    const stillAlive = new Promise((resolve) => setTimeout(() => resolve('alive'), 1500));

    const race = await Promise.race([exited, stillAlive]);
    expect(race, 'scheduler must stay alive, not exit immediately').toBe('alive');

    // It must have registered at least the intake job and announced keep-alive.
    expect(out).toMatch(/Scheduler ready: \d+ jobs registered/);
    expect(out).toMatch(/autobid-intake/);
    expect(out).toMatch(/keep-alive/i);

    // Tear it down. On POSIX the SIGTERM handler exits 0; on Windows kill()
    // terminates by signal (code null). Either way it must actually stop.
    child.kill('SIGTERM');
    const { code, signal } = await exited;
    expect(code === 0 || signal != null, `clean stop expected, got code=${code} signal=${signal}`).toBe(true);
  }, 15000);
});
