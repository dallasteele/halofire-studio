/**
 * HaloFire Cron Scheduler
 *
 * Reads cron schedules from SKILL.md frontmatter and executes
 * skills automatically. Integrates with Qwen AI for intelligent
 * task orchestration.
 *
 * Features:
 *   - Lock-based idempotency (no double runs)
 *   - Skill-level cron expressions
 *   - Qwen AI can dynamically schedule ad-hoc jobs
 *   - Structured logging for all executions
 *   - Health check endpoint
 */

import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';
import cron from 'node-cron';
import { advertiseSkills } from '../core/skill-loader.js';
import runner from '../core/skill-runner.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('cron-scheduler');

class CronScheduler {
  constructor() {
    this.jobs = new Map();    // jobId -> cron.ScheduledTask
    this.history = [];        // Last 100 execution records
    this.maxHistory = 100;
  }

  // Load all skills with cron schedules and register them
  init() {
    log.info('Initializing cron scheduler');
    const skills = advertiseSkills();

    for (const skill of skills) {
      if (skill.cronSchedule && skill.enabled) {
        this.register(skill.id, skill.cronSchedule, skill.id, 'cronRun');
      }
    }

    // Built-in system cron jobs
    this.registerSystemJobs();

    log.info(`Scheduler ready: ${this.jobs.size} jobs registered`);
  }

  // Register a cron job
  register(jobId, schedule, skillId, action, params = {}) {
    if (!cron.validate(schedule)) {
      log.error(`Invalid cron expression for ${jobId}: ${schedule}`);
      return false;
    }

    if (this.jobs.has(jobId)) {
      this.jobs.get(jobId).stop();
    }

    const task = cron.schedule(schedule, async () => {
      log.info(`Cron firing: ${jobId} -> ${skillId}:${action}`);

      const record = {
        jobId,
        skillId,
        action,
        startTime: new Date().toISOString(),
        status: 'running',
      };

      try {
        const result = await runner.run(skillId, action, params);
        record.status = result.success ? 'success' : 'failed';
        record.result = result;
        record.duration = result.duration;
      } catch (error) {
        record.status = 'error';
        record.error = error.message;
        log.error(`Cron job ${jobId} failed: ${error.message}`);
      }

      record.endTime = new Date().toISOString();
      this.history.unshift(record);
      if (this.history.length > this.maxHistory) this.history.pop();
    });

    this.jobs.set(jobId, { task, schedule, skillId, action });
    log.info(`Registered: ${jobId} [${schedule}] -> ${skillId}:${action}`);
    return true;
  }

  // System-level cron jobs
  registerSystemJobs() {
    // Daily: pricebook sync check (6 AM)
    this.register('sys:pricebook-sync', '0 6 * * *', 'pricebook', 'syncCheck');

    // Hourly: bid follow-up reminders
    this.register('sys:bid-followups', '0 * * * *', 'bid-log', 'checkFollowups');

    // Weekly Monday 7 AM: compliance inspection due dates
    this.register('sys:compliance-check', '0 7 * * 1', 'compliance', 'checkDueDates');

    // Every 5 min: AI agent heartbeat
    this.register('sys:ai-heartbeat', '*/5 * * * *', 'ai-agent', 'heartbeat');

    // Daily midnight: database backup
    this.register('sys:db-backup', '0 0 * * *', 'auth', 'backupDb');

    // Daily 8 AM: revenue dashboard refresh
    this.register('sys:dashboard-refresh', '0 8 * * *', 'analytics', 'refreshDashboard');
  }

  // Ad-hoc execution (called by Qwen AI or API)
  async runNow(skillId, action, params = {}) {
    log.info(`Ad-hoc run: ${skillId}:${action}`);
    return runner.run(skillId, action, params);
  }

  // Unregister a job
  unregister(jobId) {
    if (this.jobs.has(jobId)) {
      this.jobs.get(jobId).task.stop();
      this.jobs.delete(jobId);
      log.info(`Unregistered: ${jobId}`);
      return true;
    }
    return false;
  }

  // Status report
  status() {
    return {
      totalJobs: this.jobs.size,
      jobs: Array.from(this.jobs.entries()).map(([id, info]) => ({
        id,
        schedule: info.schedule,
        skill: info.skillId,
        action: info.action,
      })),
      recentHistory: this.history.slice(0, 10),
      runningNow: runner.getRunningSkills(),
    };
  }

  // Shutdown
  stop() {
    for (const [id, { task }] of this.jobs) {
      task.stop();
    }
    this.jobs.clear();
    log.info('Scheduler stopped');
  }
}

const scheduler = new CronScheduler();
export { CronScheduler };
export default scheduler;

// Main-guard: `npm run cron` (node src/cron/scheduler.js) must actually START
// the scheduler, not just construct the singleton. Without this the 15-minute
// intake job (and every other skill cron) is registered nowhere and never
// fires. We register jobs, then keep the event loop alive (node-cron's timers
// are not enough to hold the process on their own across all platforms) and
// shut down cleanly on SIGINT/SIGTERM.
function isMainModule() {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  scheduler.init();
  log.info('Cron scheduler running (keep-alive). Ctrl-C to stop.');
  // Explicit keep-alive timer so the process never exits while jobs are armed.
  const keepAlive = setInterval(() => {}, 1 << 30);
  const shutdown = (sig) => {
    log.info(`Received ${sig}; stopping scheduler`);
    clearInterval(keepAlive);
    scheduler.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
