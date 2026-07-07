// Copies the built Angular app into server/public so the NestJS service can
// serve the SPA and the API from a single origin (used by the Render deploy).
const { cpSync, rmSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const src = join(root, 'client', 'dist', 'client', 'browser');
const dest = join(root, 'server', 'public');

if (!existsSync(src)) {
  console.error(`[copy-client] Angular build not found at ${src}. Run the client build first.`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-client] Copied ${src} -> ${dest}`);
