import { configDefaults, defineConfig } from 'vitest/config';

const NODE_TEST_SUITES = [
  'tests/fitting-orient.test.js',
  'tests/prep-resync.test.js',
  'tests/real-sprinkler-head.test.js',
  'tests/reducer-position.test.js',
  'tests/scale-audit.test.js',
  'tests/sel-bracket.test.js',
  'tests/threaded-nipple.test.js',
  'tests/toolbar-modal.test.js',
  'tests/typography-shell.test.js',
];

// Several suites spawn a real HaloFire API server (src/api/server.js) on its own
// port and exercise it over HTTP (evidence-api, resolve-gate, settings-documents,
// api-security). Running those in parallel oversubscribes the machine — many
// concurrent Node servers + bcrypt(cost 12) logins race and intermittently 401 /
// time out. Disabling file parallelism makes the spawned-server suites
// deterministic; the pure engine tests are fast enough that the serial cost is
// negligible (full suite ~16s).
export default defineConfig({
  test: {
    fileParallelism: false,
    // These files intentionally use Node's built-in test runner. Vitest executes
    // their assertions but then reports "No test suite found", turning green
    // standalone tests into a false deploy failure. Run them through test:node.
    exclude: [...configDefaults.exclude, ...NODE_TEST_SUITES],
  },
});
