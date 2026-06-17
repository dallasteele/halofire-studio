import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOKENS_CSS = path.join(ROOT, 'public', 'styles', 'halofire-tokens.css');
const AUTOSPRINK_HTML = path.join(ROOT, 'autosprink.html');
const SHARED_SHELL_PAGES = [
  'autosprink.html',
  'workbench.html',
  'calendar.html',
  'crm.html',
  'reports.html',
  'vendors.html',
  'settings.html',
];

test('halofire typography tokens define the shared 4-tier type scale', () => {
  const css = fs.readFileSync(TOKENS_CSS, 'utf8');
  const expectedTokens = {
    '--type-xs': '10px/1.4',
    '--type-sm': '12px/1.45',
    '--type-md': '13px/1.5',
    '--type-lg': '14px/1.5',
  };

  for (const [token, value] of Object.entries(expectedTokens)) {
    const pattern = new RegExp(`${token}:\\s*${value.replace('.', '\\.')}\\s*;`);
    assert.match(css, pattern, `missing ${token}: ${value}`);
  }
});

test('autosprink body uses the shared body-default type token', () => {
  const html = fs.readFileSync(AUTOSPRINK_HTML, 'utf8');
  assert.match(
    html,
    /body\{[\s\S]*font:400 var\(--type-md\) var\(--font\);/,
    'autosprink body should use var(--type-md)',
  );
});

test('studio-adjacent pages all include the shared Halo shell script', () => {
  for (const page of SHARED_SHELL_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(
      html,
      /<script src="\/public\/halofire-shell\.js\?v=13"><\/script>/,
      `${page} should include /public/halofire-shell.js?v=13`,
    );
  }
});
