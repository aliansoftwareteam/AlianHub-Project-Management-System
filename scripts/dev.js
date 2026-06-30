#!/usr/bin/env node
/**
 * AlianHub Setup
 *
 * Mirrors the production first-run flow locally — no dummy account, no auto-fill:
 *   npm run setup              → installs deps, prepares .env, starts the server
 *   npm run dev                → start without reinstalling deps (--skip-install)
 *   npm run setup -- --force   → wipe node_modules and reinstall
 *   npm run setup -- --no-open → don't auto-open a browser
 *
 * On a fresh system the server serves the installation wizard. You complete it
 * yourself — connecting MongoDB, choosing storage, and creating your OWN company
 * and admin account. Exactly like production: nothing is created automatically.
 *
 * The wizard's final step rebuilds the frontend and the process exits — the same
 * behaviour production relies on (pm2 then restarts the app). Locally there is no
 * process manager, so just run `npm start` again afterwards and sign in.
 *
 * All existing scripts (npm start, npm run nodemon, npm run basic-install) are untouched.
 */
'use strict';

const { spawn, exec } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Paths ────────────────────────────────────────────────────────────────────
const ROOT          = path.join(__dirname, '..');
const FRONTEND_DIR  = path.join(ROOT, 'frontend');
const INSTALL_DIR   = path.join(ROOT, 'installation');
const ENV_PATH      = path.join(ROOT, '.env');
const ENV_EXAMPLE   = path.join(ROOT, '.env.example');
const FRONTEND_DIST = path.join(FRONTEND_DIR, 'dist');
const INSTALL_DIST  = path.join(INSTALL_DIR, 'dist');

// ─── Flags ────────────────────────────────────────────────────────────────────
const argv         = process.argv.slice(2);
const SKIP_INSTALL = argv.includes('--skip-install');
const FORCE        = argv.includes('--force');
const NO_OPEN      = argv.includes('--no-open');

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const R      = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';

const tag   = (label, color) => `${color}${BOLD}[${label}]${R}`;
const tick  = msg => console.log(`${GREEN}✓${R}  ${msg}`);
const warn  = msg => console.log(`${YELLOW}⚠${R}  ${msg}`);
const fatal = msg => { console.error(`${RED}✗${R}  ${msg}`); process.exit(1); };
const step  = msg => console.log(`\n${BOLD}▶ ${msg}${R}`);
const info  = msg => console.log(`${DIM}   ${msg}${R}`);

// ─── Child-process tracking ───────────────────────────────────────────────────
const children = [];
function cleanupChildren() {
  children.forEach(c => { try { c.kill('SIGTERM'); } catch (_) { } });
}
process.on('SIGINT',  () => { process.stdout.write('\n'); cleanupChildren(); process.exit(0); });
process.on('SIGTERM', () => { cleanupChildren(); process.exit(0); });
process.on('uncaughtException', err => {
  console.error(`${RED}✗${R}  Setup script crashed: ${err && err.stack || err}`);
  cleanupChildren();
  process.exit(1);
});
process.on('unhandledRejection', err => {
  console.error(`${RED}✗${R}  Unhandled rejection: ${err && err.stack || err}`);
  cleanupChildren();
  process.exit(1);
});

// ─── Stage 1 : Pre-flight ─────────────────────────────────────────────────────
function checkNode() {
  const major = Number(process.version.match(/^v(\d+)/)[1]);
  if (major < 20) {
    fatal(`Node.js v20+ required — found ${process.version}.\nInstall from https://nodejs.org or use nvm.`);
  }
  tick(`Node.js ${process.version}`);
}

// ─── Stage 2 : Install dependencies ──────────────────────────────────────────
function npmInstall(cwd, label) {
  return new Promise((resolve, reject) => {
    const nmPath = path.join(cwd, 'node_modules');
    if (!FORCE && fs.existsSync(nmPath)) {
      tick(`${label} deps — already installed`);
      return resolve();
    }
    info(`Installing ${label} dependencies (this may take a few minutes)…`);
    const child = spawn('npm', ['install'], { cwd, shell: true, stdio: 'pipe' });
    child.stdout.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && process.stdout.write(`${DIM}${tag(label, CYAN)} ${l}\n${R}`))
    );
    child.stderr.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && process.stderr.write(`${DIM}${tag(label, CYAN)} ${l}\n${R}`))
    );
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`npm install failed in "${label}" (exit ${code})`));
      tick(`${label} dependencies installed`);
      resolve();
    });
  });
}

async function installAll() {
  if (SKIP_INSTALL) {
    warn('Skipping dependency install (--skip-install).');
    return;
  }
  step('Installing dependencies');
  const tasks = [
    npmInstall(ROOT, 'root'),
    npmInstall(FRONTEND_DIR, 'frontend'),
  ];
  if (fs.existsSync(INSTALL_DIR)) {
    tasks.push(npmInstall(INSTALL_DIR, 'wizard'));
  }
  await Promise.all(tasks);
}

// A dist dir is only "valid" if it contains a built index.html — a half-built
// dir from a Ctrl+C'd build would otherwise be silently treated as ready.
function isDistValid(dir) {
  return fs.existsSync(path.join(dir, 'index.html'));
}

// ─── Stage 2b : Build installation wizard UI (one-time) ──────────────────────
async function buildWizard() {
  if (SKIP_INSTALL) return;
  if (!fs.existsSync(INSTALL_DIR)) return;
  // Skip only if a real built dist already exists. The wizard UI is served from
  // installation/dist; if the main app (frontend/dist) is already built the
  // system is set up and the wizard isn't needed.
  if (isDistValid(INSTALL_DIST) || isDistValid(FRONTEND_DIST)) return;

  step('Building installation wizard UI (one-time, ~1 min)');
  return new Promise(resolve => {
    const child = spawn('npm', ['run', 'build'], { cwd: INSTALL_DIR, shell: true, stdio: 'pipe' });
    child.stdout.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && process.stdout.write(`${DIM}${tag('wizard', YELLOW)} ${l}\n${R}`))
    );
    child.stderr.on('data', d =>
      d.toString().split('\n').forEach(l => l.trim() && process.stderr.write(`${DIM}${tag('wizard', YELLOW)} ${l}\n${R}`))
    );
    child.on('close', code => {
      if (code !== 0) warn('Wizard UI build failed — the wizard may not display until it is built.');
      else tick('Installation wizard UI built');
      resolve();
    });
  });
}

// ─── Stage 3 : Bootstrap .env ────────────────────────────────────────────────
// Ensures a valid .env exists so the server can boot (random secrets, a local
// MongoDB default, server-side storage). This is environment scaffolding only —
// the operator still connects MongoDB, chooses storage, and creates their
// account in the wizard, exactly as in production.
function bootstrapEnv() {
  step('Environment');
  if (fs.existsSync(ENV_PATH)) {
    tick('.env already exists — skipping bootstrap');
    patchMissingEnvKeys();
    return;
  }
  if (!fs.existsSync(ENV_EXAMPLE)) {
    fatal('.env.example not found — cannot bootstrap .env. Please create it manually.');
  }

  let src = fs.readFileSync(ENV_EXAMPLE, 'utf8');

  src = src.replace(/^JWT_SECRET=.*$/m,    `JWT_SECRET="${crypto.randomBytes(16).toString('hex')}"`);
  src = src.replace(/^PRECOMPANYKEY=.*$/m, `PRECOMPANYKEY="${crypto.randomBytes(4).toString('hex')}"`);
  src = src.replace(/^STORAGE_TYPE=.*$/m,  'STORAGE_TYPE="server"');
  src = src.replace(/^SERVICE_FILE=.*$/m,  'SERVICE_FILE="./firebase-adminsdk.json"');

  fs.writeFileSync(ENV_PATH, src, 'utf8');
  tick('.env created (secrets auto-generated; STORAGE_TYPE=server for local dev)');
  info('Wasabi / Firebase / AI / SMTP can be configured in the wizard or later via the admin UI.');
}

// Defensive: an existing .env created by an older bootstrap (or hand-edited)
// might be missing keys the backend reads at module-load time. Append any
// missing critical keys so the backend doesn't crash on startup.
function patchMissingEnvKeys() {
  const required = {
    'PORT':         '4000',
    'NODE_ENV':     'development',
    'APIURL':       '"http://localhost:4000/"',
    'WEBURL':       '"http://localhost:4000"',
    'MONGODB_URL':  '"mongodb://localhost:27017"',
    'STORAGE_TYPE': '"server"',
    'JWT_SECRET':   `"${crypto.randomBytes(16).toString('hex')}"`,
    'SERVICE_FILE': '"./firebase-adminsdk.json"',
  };
  const current = fs.readFileSync(ENV_PATH, 'utf8');
  const missing = [];
  for (const [k, v] of Object.entries(required)) {
    const re = new RegExp(`^${k}=`, 'm');
    if (!re.test(current)) missing.push(`${k}=${v}`);
  }
  if (!missing.length) return;
  const patched = current.replace(/\s*$/, '') + '\n\n# Added by `npm run setup` (defensive defaults)\n' + missing.join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, patched, 'utf8');
  info(`.env was missing ${missing.length} required key(s) — added defaults: ${missing.map(s => s.split('=')[0]).join(', ')}`);
}

// ─── Stage 4 : Start the server (same entry production uses) ──────────────────
function spawnService(cmd, args, cwd, label, color) {
  const child = spawn(cmd, args, { cwd, shell: true });
  const prefix = `${tag(label, color)} `;
  child.stdout.on('data', d =>
    d.toString().split('\n').forEach(l => l.trim() && process.stdout.write(`${prefix}${l}\n`))
  );
  child.stderr.on('data', d =>
    d.toString().split('\n').forEach(l => l.trim() && process.stderr.write(`${prefix}${l}\n`))
  );
  children.push(child);
  return child;
}

function startServer(apiPort) {
  step('Starting the server');
  const child = spawnService('npm', ['start'], ROOT, 'SERVER', GREEN);
  child.on('close', code => {
    // The installation wizard's final step rebuilds the frontend and calls
    // process.exit() — the same flow production uses, where pm2 then restarts
    // the app. We deliberately do NOT auto-respawn: a recursive restart wrapper
    // previously exhausted the process table and took staging down (see
    // server.js). Just tell the operator how to bring the app back up.
    console.log(`\n${YELLOW}${BOLD}Server stopped${R}${DIM} (exit ${code}).${R}`);
    console.log(`${DIM}  If you just finished the installation wizard, this is expected — the app was rebuilt.${R}`);
    console.log(`${DIM}  Start it again:  ${R}${CYAN}npm start${R}${DIM}   then open ${R}${CYAN}http://localhost:${apiPort}${R}${DIM} and sign in.${R}\n`);
  });
  return child;
}

// ─── Stage 5 : Wait helpers ───────────────────────────────────────────────────
function poll(url, intervalMs = 1500, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      http.get(url, res => {
        if (res.statusCode < 500) return resolve();
        retry();
      }).on('error', retry);
      function retry() {
        if (Date.now() >= deadline) return reject(new Error(`Timeout waiting for ${url}`));
        setTimeout(attempt, intervalMs);
      }
    })();
  });
}

// ─── Stage 6 : Install-state probe ───────────────────────────────────────────
function fetchJson(url, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port:     u.port,
      path:     u.pathname + u.search,
      method:   'GET',
      headers:  { 'Content-Type': 'application/json' },
      timeout:  timeoutMs,
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Timeout: GET ${url}`)));
    req.end();
  });
}

// Best-effort: has installation finished already? Used only to tailor the
// console banner (wizard vs. ready-to-sign-in). Any failure → treat as not done.
async function isInstallationComplete(apiPort) {
  try {
    const { body } = await fetchJson(`http://localhost:${apiPort}/api/v1/installstep/get`);
    if (!body?.data || !Array.isArray(body.data)) return false;
    const step7 = body.data.find(s => s.step === 7);
    const step8 = body.data.find(s => s.step === 8);
    return step7?.status === 'done' && step8?.status === 'done';
  } catch {
    return false;
  }
}

// ─── Stage 7 : Open browser ───────────────────────────────────────────────────
function openBrowser(url) {
  if (NO_OPEN) {
    info(`Browser launch skipped (--no-open). Visit: ${CYAN}${url}${R}`);
    return;
  }
  let cmd;
  if (process.platform === 'win32')  cmd = `start "" "${url}"`;
  else if (process.platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) warn(`Could not open browser automatically. Visit ${CYAN}${url}${R} manually.`);
  });
}

// ─── Utility : read PORT from .env ────────────────────────────────────────────
function readEnvValue(key) {
  if (!fs.existsSync(ENV_PATH)) return null;
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const m = content.match(new RegExp(`^${key}=["']?([^"'\\n]+)["']?`, 'm'));
  return m ? m[1] : null;
}
function readApiPort() {
  const v = readEnvValue('PORT');
  return v ? parseInt(v, 10) : 4000;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}◆ AlianHub Setup${R}`);
  console.log(`${DIM}  Installs, prepares the environment, and starts the server.${R}\n`);

  checkNode();

  await installAll();
  await buildWizard();
  bootstrapEnv();

  const apiPort = readApiPort();
  startServer(apiPort);

  step('Waiting for the server');
  try {
    await poll(`http://localhost:${apiPort}/health`, 1500, 120_000);
    tick(`Server ready → http://localhost:${apiPort}`);
  } catch (e) {
    fatal(`Server never came up: ${e.message}. Scroll up for [SERVER] errors.`);
  }

  const url = `http://localhost:${apiPort}`;
  const installed = await isInstallationComplete(apiPort);
  openBrowser(url);

  const bar = '─'.repeat(60);
  console.log(`\n${GREEN}${bar}${R}`);
  if (installed) {
    console.log(`  ${GREEN}${BOLD}✓  AlianHub is ready${R}`);
    console.log(`${GREEN}${bar}${R}\n`);
    console.log(`  URL:   ${CYAN}${BOLD}${url}${R}`);
    console.log(`  ${DIM}Log in with the account you created during installation.${R}`);
  } else {
    console.log(`  ${GREEN}${BOLD}✓  Server running — finish installation in your browser${R}`);
    console.log(`${GREEN}${bar}${R}\n`);
    console.log(`  URL:   ${CYAN}${BOLD}${url}${R}`);
    console.log(`  ${DIM}The wizard guides you to connect MongoDB, choose storage, and create${R}`);
    console.log(`  ${DIM}your own company and admin account.${R}`);
    console.log(`  ${DIM}When it finishes, the app rebuilds and the server stops (same as${R}`);
    console.log(`  ${DIM}production). Run ${R}${CYAN}npm start${R}${DIM} again, then sign in.${R}`);
  }
  console.log(`  ${DIM}Stop:  Ctrl+C${R}`);
  console.log(`${GREEN}${bar}${R}\n`);
}

main().catch(e => fatal(e.message || String(e)));
