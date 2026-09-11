const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('./env');

const HEALTH_TIMEOUT_MS = Number(process.env.E2E_HEALTH_TIMEOUT_MS) || 120000;
const STOP_TIMEOUT_MS = 10000;

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function serverEnv({ port, mongoUrl, workDir }) {
    const baseURL = `http://127.0.0.1:${port}`;
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: os.tmpdir(),
        NODE_ENV: 'development',
        PORT: String(port),
        APIURL: `${baseURL}/`,
        WEBURL: baseURL,
        MONGODB_URL: mongoUrl,
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
        JWT_EXP: '24h',
        JWT_ALGORITHM: 'HS256',
        PRECOMPANYKEY: crypto.randomBytes(16).toString('hex'),
        STORAGE_TYPE: 'server',
        LOG_DIR: path.join(workDir, 'log'),
        BACKUP_DIR: path.join(workDir, 'backups'),
        MIGRATIONS_AUTO: 'true',
        CRON_ENABLED: 'false',
        AUTOMATION_ENGINE: 'true',
        AUTOMATION_QUEUE_DRIVER: 'inline',
        GLOBAL_RATE_LIMIT_PER_MIN: 'off',
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000',
        MEMBERSHIP_CACHE_TTL_SECONDS: '0',
        // Port 9 (discard) refuses at once, so invite mail fails fast instead of timing out.
        NODEMAILER_HOST: '127.0.0.1',
        NODEMAILER_PORT: '9',
        MAGIC_LINK_ENABLED: 'false',
    };
}

async function waitForHealth(baseURL, child, logTail) {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Server exited with code ${child.exitCode} before /health answered.\n${logTail()}`);
        }
        try {
            const res = await fetch(`${baseURL}/health`);
            if (res.status === 200) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Server did not report healthy within ${HEALTH_TIMEOUT_MS / 1000}s.\n${logTail()}`);
}

function stopChild(child) {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        child.kill('SIGTERM');
    });
}

async function startServer({ mongoUrl, logFile }) {
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alianhub-e2e-'));
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile);
    const tail = [];
    const record = (chunk) => {
        log.write(chunk);
        tail.push(...String(chunk).split('\n'));
        tail.splice(0, Math.max(0, tail.length - 60));
    };

    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'ignore-dotenv.js'), 'index.js'], {
        cwd: ROOT,
        env: serverEnv({ port, mongoUrl, workDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', record);
    child.stderr.on('data', record);

    const stop = async ({ companyIds = [] } = {}) => {
        await stopChild(child);
        log.end();
        fs.rmSync(workDir, { recursive: true, force: true });
        // Local storage has no configurable root: company files land in <repo>/storage/<companyId>.
        for (const companyId of companyIds) {
            if (/^[a-f0-9]{24}$/i.test(companyId)) fs.rmSync(path.join(ROOT, 'storage', companyId), { recursive: true, force: true });
        }
    };

    try {
        await waitForHealth(baseURL, child, () => `--- last lines of ${logFile} ---\n${tail.join('\n')}`);
    } catch (error) {
        await stop();
        throw error;
    }
    return { baseURL, port, logFile, logDir: path.join(workDir, 'log'), pid: child.pid, stop };
}

module.exports = { startServer };
