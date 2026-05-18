#!/usr/bin/env node
/**
 * AlianHub Developer Setup
 *
 * One command, zero technical knowledge required:
 *   npm run setup              → installs deps, configures, starts, auto-completes wizard, opens browser
 *   npm run dev                → fast restart (skip install)
 *   npm run setup -- --force   → wipe node_modules and reinstall
 *   npm run setup -- --no-open → don't auto-open a browser
 *   npm run setup -- --manual  → skip auto-setup; open the interactive wizard UI instead
 *
 * Custom admin credentials (optional):
 *   SETUP_ADMIN_EMAIL=you@you.com SETUP_ADMIN_PASSWORD=mypw npm run setup
 *
 * All existing scripts (npm start, npm run nodemon, npm run basic-install) are untouched.
 */
'use strict';

const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
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
const MANUAL       = argv.includes('--manual'); // skip auto-setup, open wizard manually

// ─── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_ADMIN = {
  firstName:     process.env.SETUP_ADMIN_FIRST    || 'Admin',
  lastName:      process.env.SETUP_ADMIN_LAST     || 'User',
  email:         process.env.SETUP_ADMIN_EMAIL    || 'admin@admin.local',
  password:      process.env.SETUP_ADMIN_PASSWORD || 'admin123',
  companyName:   process.env.SETUP_COMPANY        || 'My Company',
  phoneNumber:   process.env.SETUP_PHONE          || '0000000000',
  country:       process.env.SETUP_COUNTRY        || 'United States',
  city:          process.env.SETUP_CITY           || 'San Francisco',
  state:         process.env.SETUP_STATE          || 'California',
  countryCodeObj: { name: 'United States', dialCode: '+1', isoCode: 'US' },
};

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
const dash  = msg => console.log(`${DIM}-  ${msg}${R}`);
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
// Don't orphan backend/frontend children if the orchestrator itself crashes.
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
  // Only skip if a real built dist exists somewhere. The wizard UI is served
  // from installation/dist; if frontend/dist is already built we skip too
  // (full setup already completed; user can go straight to the app).
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
      if (code !== 0) warn('Wizard UI build failed — wizard may not be visible if auto-setup falls back.');
      else tick('Installation wizard UI built');
      resolve();
    });
  });
}

// ─── Stage 3 : Bootstrap .env ────────────────────────────────────────────────
function bootstrapEnv() {
  step('Environment');
  if (fs.existsSync(ENV_PATH)) {
    tick('.env already exists — skipping bootstrap');
    // Defensive: ensure critical keys are present (APIURL/WEBURL/PORT) — patch in-place if missing
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
  info('Wasabi / Firebase / AI / SMTP can be configured later via the admin UI.');
}

// Defensive: an existing .env created by an older bootstrap (or hand-edited)
// might be missing keys the backend reads at module-load time. We append any
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

// ─── Stage 4 : Spawn backend + frontend ──────────────────────────────────────
function spawnService(cmd, args, cwd, label, color) {
  const child = spawn(cmd, args, { cwd, shell: true });
  const prefix = `${tag(label, color)} `;
  child.stdout.on('data', d =>
    d.toString().split('\n').forEach(l => l.trim() && process.stdout.write(`${prefix}${l}\n`))
  );
  child.stderr.on('data', d =>
    d.toString().split('\n').forEach(l => l.trim() && process.stderr.write(`${prefix}${l}\n`))
  );
  child.on('close', code => {
    if (code != null && code !== 0) {
      console.log(`${prefix}process exited (code ${code})`);
    }
  });
  children.push(child);
  return child;
}

function startServices() {
  step('Starting backend and frontend');
  spawnService('npm', ['run', 'nodemon'], ROOT,        'API', GREEN);
  spawnService('npm', ['run', 'serve'],  FRONTEND_DIR, 'WEB', CYAN);
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

// ─── Stage 6 : HTTP helpers for headless wizard ──────────────────────────────
function fetchJson(url, { method = 'GET', body = null } = {}, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname,
      port:     u.port,
      path:     u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
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
    req.on('timeout', () => req.destroy(new Error(`Timeout: ${method} ${url}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Stage 6b : MongoDB probe (with retry) ───────────────────────────────────
function probeMongoOnce(host, port) {
  return new Promise(resolve => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error',   () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}
async function probeMongo(url) {
  // Only probe plain mongodb:// URLs; mongodb+srv:// requires DNS SRV lookup.
  const m = url && url.match(/^mongodb:\/\/(?:[^@\/]+@)?([^:\/?]+)(?::(\d+))?/);
  if (!m) return true; // SRV or unrecognised → don't block; let wizard try
  const host = m[1];
  const port = parseInt(m[2] || '27017', 10);
  // Retry up to 3 times with a 2s delay — handles a still-starting `docker run`
  // container or a Windows service that takes a moment to come up.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await probeMongoOnce(host, port)) return true;
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

function readEnvValue(key) {
  if (!fs.existsSync(ENV_PATH)) return null;
  const content = fs.readFileSync(ENV_PATH, 'utf8');
  const m = content.match(new RegExp(`^${key}=["']?([^"'\\n]+)["']?`, 'm'));
  return m ? m[1] : null;
}

// ─── Stage 7 : Headless wizard auto-completion ───────────────────────────────
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

async function wizardStep(apiPort, body, timeoutMs = 60_000) {
  const { statusCode, body: resp } = await fetchJson(
    `http://localhost:${apiPort}/api/v1/checkinstallstep`,
    { method: 'POST', body },
    { timeoutMs },
  );
  if (statusCode >= 400 || resp?.status === false) {
    const err = resp?.error || resp?.message || `HTTP ${statusCode}`;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return resp;
}

async function autoCompleteWizard(apiPort) {
  if (MANUAL) {
    info('--manual flag set — skipping auto-setup. The wizard UI will open instead.');
    return { mode: 'manual' };
  }

  // Already done?
  if (await isInstallationComplete(apiPort)) {
    return { mode: 'already-done' };
  }

  // Probe MongoDB
  const mongoUrl = readEnvValue('MONGODB_URL') || 'mongodb://localhost:27017';
  const mongoOk = await probeMongo(mongoUrl);
  if (!mongoOk) {
    warn(`MongoDB doesn't appear to be running at ${mongoUrl}.`);
    info('Install & start MongoDB locally, then re-run `npm run setup`. Quick options:');
    info('  • Docker:   docker run -d -p 27017:27017 --name mongo mongo:7');
    info('  • Windows:  https://www.mongodb.com/try/download/community');
    info('Opening the wizard UI so you can enter a different MongoDB URL manually…');
    return { mode: 'no-mongo' };
  }

  step('Auto-configuring AlianHub (no input required)');

  try {
    await wizardStep(apiPort, { step: 1 });
    tick('Step 1/8  Token verified');

    await wizardStep(apiPort, { step: 2, mongodbUrl: mongoUrl });
    tick(`Step 2/8  MongoDB connected (${mongoUrl})`);

    await wizardStep(apiPort, { step: 3, chooseStorage: 'default' });
    tick('Step 3/8  Storage set to local server');

    await wizardStep(apiPort, { step: 4, isDoItLater: true });
    dash('Step 4/8  Firebase skipped (configure later if you need push notifications)');

    await wizardStep(apiPort, { step: 5, isDoItLater: true });
    dash('Step 5/8  AI skipped (configure later in Settings)');

    await wizardStep(apiPort, { step: 6, isDoItLater: true });
    dash('Step 6/8  SMTP skipped (configure later in Settings)');

    info('Saving configuration and initializing database (10-15s)…');
    await wizardStep(apiPort, { step: 7 }, 90_000);
    tick('Step 7/8  Configuration saved + database initialized');

    info('Creating your admin account and company (10s)…');
    const { statusCode, body } = await fetchJson(
      `http://localhost:${apiPort}/api/v1/installstep/createUserAndCompany`,
      { method: 'POST', body: DEFAULT_ADMIN },
      { timeoutMs: 90_000 },
    );
    if (statusCode === 420) {
      tick('Step 8/8  Admin account already exists');
      return { mode: 'partial-already-done' };
    }
    if (statusCode >= 400) {
      // The controller's error paths use both `message` and `error` depending on
      // which branch fails — check both, and stringify objects for visibility.
      const raw = body?.message || body?.error || `HTTP ${statusCode}`;
      throw new Error(typeof raw === 'string' ? raw : JSON.stringify(raw));
    }
    tick(`Step 8/8  Admin account created (${DEFAULT_ADMIN.email})`);

    return { mode: 'completed', credentials: { email: DEFAULT_ADMIN.email, password: DEFAULT_ADMIN.password } };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    warn(`Auto-setup hit a snag: ${msg}`);
    info('Falling back to the interactive wizard so you can complete the missing step.');
    return { mode: 'failed', error: msg };
  }
}

// ─── Stage 8 : Open browser ───────────────────────────────────────────────────
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

// ─── Stage 9 : Print credentials banner ───────────────────────────────────────
// Flexible — gracefully handles long custom emails / passwords without breaking
// alignment, because there's no fixed-width box to maintain.
function printReadyBanner(apiPort, creds) {
  const bar = '─'.repeat(58);
  console.log(`\n${GREEN}${bar}${R}`);
  console.log(`  ${GREEN}${BOLD}✓  AlianHub is ready!${R}`);
  console.log(`${GREEN}${bar}${R}\n`);
  console.log(`  URL:       ${CYAN}${BOLD}http://localhost:8080${R}`);
  if (creds) {
    console.log(`  Email:     ${BOLD}${creds.email}${R}`);
    console.log(`  Password:  ${BOLD}${creds.password}${R}`);
  }
  console.log('');
  console.log(`  API:       ${DIM}http://localhost:${apiPort}${R}`);
  console.log(`  Stop:      ${DIM}Ctrl+C in this terminal${R}`);
  console.log(`  Logs:      ${DIM}[API] and [WEB] streaming above${R}`);
  console.log(`${GREEN}${bar}${R}\n`);
}

// ─── Utility : read PORT from .env ────────────────────────────────────────────
function readApiPort() {
  const v = readEnvValue('PORT');
  return v ? parseInt(v, 10) : 4000;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}◆ AlianHub Developer Setup${R}`);
  console.log(`${DIM}  One command — installs, configures, starts, and opens the app.${R}\n`);

  checkNode();

  await installAll();
  await buildWizard();
  bootstrapEnv();

  const apiPort = readApiPort();
  startServices();

  // Wait for backend first so we can talk to the wizard API while the frontend builds.
  step('Waiting for backend');
  try {
    await poll(`http://localhost:${apiPort}/health`, 1500, 90_000);
    tick(`Backend ready → http://localhost:${apiPort}`);
  } catch (e) {
    fatal(`Backend never came up: ${e.message}. Scroll up for [API] errors.`);
  }

  // Auto-complete the wizard while the Vue dev server is still compiling.
  const autoResult = await autoCompleteWizard(apiPort);

  // Wait for the frontend dev server (Vue first compile ~30–60s).
  step('Waiting for frontend (first compile takes ~30-60s)');
  try {
    await poll('http://localhost:8080', 2000, 180_000);
    tick('Frontend ready → http://localhost:8080');
  } catch (e) {
    warn(`Frontend dev server not responding yet. You can still visit http://localhost:8080 once it finishes compiling.`);
  }

  // Decide where to send the user based on the auto-setup outcome.
  switch (autoResult.mode) {
    case 'completed':
      openBrowser('http://localhost:8080');
      printReadyBanner(apiPort, autoResult.credentials);
      break;

    case 'already-done':
    case 'partial-already-done':
      step('Setup already complete — opening login page');
      openBrowser('http://localhost:8080');
      printReadyBanner(apiPort, null);
      info('Log in with the credentials you created previously.');
      break;

    case 'no-mongo':
    case 'failed':
    case 'manual':
    default: {
      const wizardUrl = fs.existsSync(INSTALL_DIST) ? `http://localhost:${apiPort}` : 'http://localhost:8080';
      step('Opening installation wizard');
      openBrowser(wizardUrl);
      console.log(`\n${YELLOW}${BOLD}Manual setup needed.${R}`);
      console.log(`${DIM}  Wizard:  ${wizardUrl}${R}`);
      console.log(`${DIM}  App:     http://localhost:8080 (after wizard completes)${R}`);
      console.log(`${DIM}  Stop:    Ctrl+C${R}\n`);
      break;
    }
  }
}

main().catch(e => fatal(e.message || String(e)));
