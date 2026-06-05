/**
 * HaloFire Skill Runner
 *
 * Executes skills with:
 *   - Idempotency guards (lock files)
 *   - Timeout enforcement
 *   - Structured logging
 *   - State persistence
 *   - Error recovery
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSkill, loadSkillModule, advertiseSkills } from './skill-loader.js';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCK_DIR = path.resolve(__dirname, '../../data/locks');
const STATE_DIR = path.resolve(__dirname, '../../data/state');

const log = createLogger('skill-runner');

// Ensure directories exist
[LOCK_DIR, STATE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

class SkillRunner {
  constructor() {
    this.running = new Map(); // skillId -> { startTime, timeout }
    this.maxConcurrent = 3;
  }

  // Acquire lock (prevent double-execution)
  acquireLock(skillId, action) {
    const lockFile = path.join(LOCK_DIR, `${skillId}-${action}.lock`);
    if (fs.existsSync(lockFile)) {
      const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      const age = Date.now() - lockData.timestamp;
      // Stale lock (older than 5 minutes) — force release
      if (age > 300000) {
        log.warn(`Stale lock found for ${skillId}:${action}, forcing release`);
        fs.unlinkSync(lockFile);
      } else {
        return false;
      }
    }

    fs.writeFileSync(lockFile, JSON.stringify({
      skillId, action,
      timestamp: Date.now(),
      pid: process.pid,
    }));
    return true;
  }

  releaseLock(skillId, action) {
    const lockFile = path.join(LOCK_DIR, `${skillId}-${action}.lock`);
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  }

  // Get/set persistent state for a skill
  getState(skillId) {
    const stateFile = path.join(STATE_DIR, `${skillId}.json`);
    if (!fs.existsSync(stateFile)) return {};
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }

  setState(skillId, state) {
    const stateFile = path.join(STATE_DIR, `${skillId}.json`);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }

  // Execute a skill action
  async run(skillId, action, params = {}, options = {}) {
    const timeout = options.timeout || 60000;
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    log.info(`[${runId}] Starting ${skillId}:${action}`, { params: Object.keys(params) });

    // Check concurrency
    if (this.running.size >= this.maxConcurrent) {
      throw new Error(`Max concurrent skills reached (${this.maxConcurrent})`);
    }

    // Acquire lock
    if (!this.acquireLock(skillId, action)) {
      throw new Error(`Skill ${skillId}:${action} is already running`);
    }

    this.running.set(runId, { skillId, action, startTime: Date.now() });

    try {
      // Load skill module
      const skillModule = await loadSkillModule(skillId);

      // Find the handler
      const handler = skillModule[action] || skillModule.default?.[action];
      if (!handler) {
        throw new Error(`Handler not found: ${skillId}:${action}`);
      }

      // Build context
      const context = {
        runId,
        skillId,
        action,
        params,
        state: this.getState(skillId),
        log: createLogger(`skill:${skillId}`),
        saveState: (newState) => this.setState(skillId, { ...this.getState(skillId), ...newState }),
        loadRef: (refName) => {
          const skill = loadSkill(skillId);
          const refPath = path.join(skill.path, 'refs', refName);
          return fs.readFileSync(refPath, 'utf8');
        },
      };

      // Execute with timeout
      const result = await Promise.race([
        handler(context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Skill timeout after ${timeout}ms`)), timeout)
        ),
      ]);

      log.info(`[${runId}] Completed ${skillId}:${action}`, {
        duration: Date.now() - this.running.get(runId).startTime,
      });

      return {
        success: true,
        runId,
        skillId,
        action,
        result,
        duration: Date.now() - this.running.get(runId).startTime,
      };

    } catch (error) {
      log.error(`[${runId}] Failed ${skillId}:${action}: ${error.message}`);
      return {
        success: false,
        runId,
        skillId,
        action,
        error: error.message,
        duration: Date.now() - (this.running.get(runId)?.startTime || Date.now()),
      };

    } finally {
      this.running.delete(runId);
      this.releaseLock(skillId, action);
    }
  }

  getRunningSkills() {
    return Array.from(this.running.entries()).map(([runId, info]) => ({
      runId,
      ...info,
      elapsed: Date.now() - info.startTime,
    }));
  }
}

// Singleton
const runner = new SkillRunner();

// CLI support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const skills = advertiseSkills();
    console.log('\n  HALOFIRE SKILLS\n');
    for (const s of skills) {
      const status = s.enabled ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
      console.log(`  [${status}] ${s.id.padEnd(15)} ${s.description.slice(0, 60)}`);
      if (s.cronSchedule) console.log(`       cron: ${s.cronSchedule}`);
    }
    console.log('');
  }

  if (args.includes('--run')) {
    const idx = args.indexOf('--run');
    const [skillId, action] = (args[idx + 1] || '').split(':');
    if (!skillId || !action) {
      console.error('Usage: --run skill-id:action');
      process.exit(1);
    }
    runner.run(skillId, action).then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    });
  }
}

export { SkillRunner };
export default runner;
