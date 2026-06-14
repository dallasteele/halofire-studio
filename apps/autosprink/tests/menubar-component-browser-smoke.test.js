// HFMenuBar (public/halofire-menubar.js) browser smoke — loads the dev harness
// page over file:// (the component is fully self-contained, no fetch/API) and
// exercises the menu contract: 20 menus, dropdowns, Alt-mnemonics, Esc,
// keyboard nav, File > Export submenu, wired vs stubbed (flag-don't-gate).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const DEV_PAGE = pathToFileURL(
  path.resolve(import.meta.dirname, '../public/menubar-dev.html')
).href;

let browser;
let page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto(DEV_PAGE);
  await page.waitForSelector('.hf-menubar');
}, 60000);

afterAll(async () => {
  await browser?.close();
});

describe('HFMenuBar component', () => {
  beforeEach(async () => {
    // each test starts with every menu closed regardless of prior test state
    await page.evaluate(() => window.__menubarApi.close());
  });

  it('renders all 20 AutoSprink menus in order', async () => {
    const labels = await page.$$eval('.hf-menubar-btn', (els) => els.map((e) => e.textContent.trim()));
    expect(labels).toEqual([
      'File', 'Edit', 'Select', 'Snaps', 'Tools', 'Actions', 'Commands', 'Auto Draw',
      'Roof Planes', 'Wizards', 'Hydraulics', 'Finish', 'Alerts', 'Listing',
      'Parts Database', 'AutoPREP', 'Settings', 'View', 'Window', 'Help',
    ]);
  });

  it('reports honest wired/stubbed stats with provenance', async () => {
    const stats = await page.evaluate(() => window.__menubarApi.stats());
    expect(stats.menus).toBe(20);
    expect(stats.items).toBeGreaterThan(300); // 354 scraped + 4 export formats
    expect(stats.wired).toBeGreaterThanOrEqual(7); // dev harness wires 6 items + export(4 formats)+parent
    expect(stats.stubbed).toBeGreaterThan(300);
    expect(stats.wired + stats.stubbed).toBe(stats.items);
    expect(stats.provenance).toContain('needs-verification');
  });

  it('click opens a dropdown, outside click closes it', async () => {
    await page.click('.hf-menubar-btn[data-menu="file"]');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(true);
    await page.click('h1');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(false);
  });

  it('Alt+F opens File menu, Esc closes it', async () => {
    await page.keyboard.press('Alt+F');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(false);
  });

  it('arrow keys navigate items in an open menu', async () => {
    await page.keyboard.press('Alt+E'); // Edit, focuses first item
    const first = await page.evaluate(() => document.activeElement.dataset.id);
    await page.keyboard.press('ArrowDown');
    const second = await page.evaluate(() => document.activeElement.dataset.id);
    expect(first).toMatch(/^edit\./);
    expect(second).toMatch(/^edit\./);
    expect(second).not.toBe(first);
    await page.keyboard.press('Escape');
  });

  it('stubbed items are grayed with the needs-verification tooltip and do nothing', async () => {
    await page.click('.hf-menubar-btn[data-menu="file"]');
    const stub = await page.$('.hf-menu[data-menu="file"] .hf-menu-item[aria-disabled="true"]');
    expect(stub).toBeTruthy();
    const title = await stub.getAttribute('title');
    expect(title).toContain('not yet wired — needs-verification');
    // force: Playwright's actionability check treats aria-disabled as disabled
    await stub.click({ force: true });
    // menu stays open (stub click is a no-op, not an action)
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(true);
    await page.keyboard.press('Escape');
  });

  it('wired item invokes its action and closes the menu', async () => {
    await page.click('.hf-menubar-btn[data-menu="file"]');
    await page.click('.hf-menu-item[data-id="file.save"]');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(false);
    const log = await page.textContent('#log');
    expect(log).toContain('File > Save');
  });

  it('File > Export submenu offers DXF/STEP/IFC/STL and calls actions.export(format)', async () => {
    await page.click('.hf-menubar-btn[data-menu="file"]');
    await page.click('.hf-menu-item[data-id="file.export"]');
    const formats = await page.$$eval(
      '.hf-submenu .hf-menu-item',
      (els) => els.map((e) => e.textContent.trim())
    );
    expect(formats).toEqual(['DXF', 'STEP', 'IFC', 'STL']);
    await page.click('.hf-menu-item[data-id="file.export.step"]');
    const log = await page.textContent('#log');
    expect(log).toContain('actions.export("step") called');
    expect(await page.isVisible('.hf-menu[data-menu="file"]')).toBe(false);
  });

  it('every dropdown opens and every menu has items plus a provenance footer', async () => {
    const result = await page.evaluate(() => {
      const out = [];
      for (const btn of document.querySelectorAll('.hf-menubar-btn')) {
        btn.click();
        const panel = document.querySelector(`.hf-menu[data-menu="${btn.dataset.menu}"]`);
        out.push({
          menu: btn.dataset.menu,
          open: panel && !panel.hidden,
          items: panel ? panel.querySelectorAll('.hf-menu-item').length : 0,
          foot: panel ? panel.querySelector('.hf-menu-foot')?.textContent || '' : '',
        });
        btn.click(); // close again
      }
      return out;
    });
    expect(result).toHaveLength(20);
    for (const r of result) {
      expect(r.open, `menu ${r.menu} should open`).toBe(true);
      expect(r.items, `menu ${r.menu} should have items`).toBeGreaterThan(0);
      expect(r.foot).toContain('needs-verification');
    }
  });
});
