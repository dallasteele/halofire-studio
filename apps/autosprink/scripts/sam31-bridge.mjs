#!/usr/bin/env node

import { createSam31BridgeApp } from '../src/sam31/bridge.js';

const port = Number(process.env.HALOFIRE_SAM31_BRIDGE_PORT || 15000);
const host = process.env.HALOFIRE_SAM31_BRIDGE_HOST || '127.0.0.1';

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  process.stderr.write('HALOFIRE_SAM31_BRIDGE_PORT must be an integer between 1 and 65535\n');
  process.exit(1);
}

const app = createSam31BridgeApp();
const server = app.listen(port, host, () => {
  process.stdout.write(
    `HaloFire SAM 3.1 bridge listening at http://${host}:${port} ` +
      '(temporary best-effort shim; no claim gates cleared)\n',
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
