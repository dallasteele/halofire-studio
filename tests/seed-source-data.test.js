import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { readBidLogRows } from '../src/data/bid-log-importer.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('database seed source data', () => {
  test('seeds bids from actual bid log rows without synthetic surrounding bids', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'halofire-seed-source-'));
    const dbPath = path.join(tempDir, 'halofire.db');
    const result = spawnSync(process.execPath, ['src/db/seed.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HALOFIRE_DB_PATH: dbPath,
        HALOFIRE_ADMIN_PASSWORD: 'seed-test-password',
        HALOFIRE_ALLOW_DEV_DEFAULTS: '0',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const expectedBidRows = readBidLogRows(ROOT).filter((row) => row.project);
    const db = new Database(dbPath, { readonly: true });
    const bids = db.prepare('SELECT project, value, notes FROM bids ORDER BY id').all();
    const projects = db.prepare('SELECT name, notes FROM projects ORDER BY id').all();
    const compliance = db.prepare('SELECT project_name, notes FROM compliance ORDER BY id').all();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    expect(bids).toHaveLength(expectedBidRows.length);
    expect(bids.some((bid) => bid.project === 'Walmart Supercenter - Twin Falls')).toBe(false);
    expect(bids.some((bid) => bid.project === "St. Luke's Medical - Meridian")).toBe(false);

    const homeDepot = bids.find((bid) => bid.project === 'Home Depot - Rexburg ID');
    expect(homeDepot).toMatchObject({ value: 792543.84 });
    expect(homeDepot.notes).toContain('actual_bid_log');
    expect(homeDepot.notes).toContain('BID_LOG_SQFT_DIFFERS_FROM_PROPOSAL');

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Home Depot - Rexburg ID');
    expect(compliance).toHaveLength(1);
    expect(compliance[0].project_name).toBe('Home Depot - Rexburg ID');
  });
});
