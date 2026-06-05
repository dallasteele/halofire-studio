import { defineConfig } from 'vitest/config';

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
  },
});
