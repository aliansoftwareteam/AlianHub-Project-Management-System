const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ROOT } = require('./env');
const { startEmbeddingsStub } = require('./embeddings');
const { startGitlabStub } = require('./gitlab');

const HEALTH_TIMEOUT_MS = Number(process.env.E2E_HEALTH_TIMEOUT_MS) || 120000;
const STOP_TIMEOUT_MS = 10000;
const START_ATTEMPTS = 5;

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

function serverEnv({ port, mongoUrl, workDir, embeddingsUrl, gitlabApiUrl }) {
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
        // The harness exercises every screen's downloads under the rule the owner will switch to.
        STORAGE_DOWNLOAD_SCOPE: 'enforce',
        LOG_DIR: path.join(workDir, 'log'),
        BACKUP_DIR: path.join(workDir, 'backups'),
        MIGRATIONS_AUTO: 'true',
        CRON_ENABLED: 'false',
        AUTOMATION_ENGINE: 'true',
        AUTOMATION_QUEUE_DRIVER: 'inline',
        // Retrieval and the page indexer turn on only for a company whose own switch is "on" or "hybrid".
        KNOWLEDGE_RETRIEVAL: 'tenant',
        KNOWLEDGE_INDEXER: 'tenant',
        // Embeddings go to the harness stub; they only happen once a suite sets AI_API_KEY through the instance settings.
        OPENAI_EMBEDDINGS_URL: embeddingsUrl,
        GITLAB_BASE_API_URL: gitlabApiUrl,
        AGENT_PERFORMANCE_READ: 'on',
        SKILL_EXTERNAL_READS: 'on',
        GLOBAL_RATE_LIMIT_PER_MIN: 'off',
        AUTH_RATE_LIMIT_MAX_ATTEMPTS: '10000',
        MEMBERSHIP_CACHE_TTL_SECONDS: '0',
        // A workspace enforcement mode or knowledge switch a test writes to the company row applies to the next request.
        PERMISSION_ENFORCEMENT_CACHE_TTL_SECONDS: '0',
        KNOWLEDGE_FLAG_CACHE_TTL_SECONDS: '0',
        // With no list set, every workspace fetches as it does with the flag off.
        AGENT_EGRESS_ALLOWLIST: 'true',
        // Session cookies are httpOnly here, so the browser specs exercise the migrated client.
        SESSION_COOKIE_HTTPONLY: 'on',
        // Port 9 (discard) refuses at once, so invite mail fails fast instead of timing out.
        NODEMAILER_HOST: '127.0.0.1',
        NODEMAILER_PORT: '9',
        MAGIC_LINK_ENABLED: 'false',
    };
}

class PortTakenError extends Error {}

async function waitForHealth(baseURL, child, state, logTail) {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (state.portTaken) throw new PortTakenError(`Port of ${baseURL} was taken before the server bound it.`);
        if (child.exitCode !== null) {
            throw new Error(`Server exited with code ${child.exitCode} before /health answered.\n${logTail()}`);
        }
        // Until our child logs that it is listening, whatever answers on the port is someone else.
        if (state.listening) {
            try {
                const res = await fetch(`${baseURL}/health`);
                if (res.status === 200) return;
            } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, state.listening ? 500 : 100));
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

async function startServerOn(port, { mongoUrl, logFile, env, entry }) {
    const baseURL = `http://127.0.0.1:${port}`;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alianhub-e2e-'));
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.createWriteStream(logFile);
    const tail = [];
    const state = { listening: false, portTaken: false };
    const readyLine = `Server ready on ${port}`;
    const portInUse = new RegExp(`EADDRINUSE[^\\n]*:${port}\\b`);
    let recent = '';
    const record = (chunk) => {
        log.write(chunk);
        tail.push(...String(chunk).split('\n'));
        tail.splice(0, Math.max(0, tail.length - 60));
        if (state.listening) return;
        recent = (recent + chunk).slice(-4096);
        if (recent.includes(readyLine)) state.listening = true;
        else if (portInUse.test(recent)) state.portTaken = true;
    };

    const embeddings = await startEmbeddingsStub();
    const gitlab = await startGitlabStub();
    const child = spawn(process.execPath, ['-r', path.join(__dirname, 'ignore-dotenv.js'), entry], {
        cwd: ROOT,
        env: { ...serverEnv({ port, mongoUrl, workDir, embeddingsUrl: embeddings.url, gitlabApiUrl: gitlab.url }), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', record);
    child.stderr.on('data', record);

    const stop = async ({ companyIds = [] } = {}) => {
        await stopChild(child);
        await embeddings.stop();
        await gitlab.stop();
        log.end();
        fs.rmSync(workDir, { recursive: true, force: true });
        // Local storage has no configurable root: company files land in <repo>/storage/<companyId>.
        for (const companyId of companyIds) {
            if (/^[a-f0-9]{24}$/i.test(companyId)) fs.rmSync(path.join(ROOT, 'storage', companyId), { recursive: true, force: true });
        }
    };

    try {
        await waitForHealth(baseURL, child, state, () => `--- last lines of ${logFile} ---\n${tail.join('\n')}`);
    } catch (error) {
        await stop();
        throw error;
    }
    return { baseURL, port, logFile, logDir: path.join(workDir, 'log'), pid: child.pid, embeddingsUrl: embeddings.url, stop };
}

/* The app needs its own URL in APIURL before it starts, so the port is picked here and can be
 * taken by another process before the server binds it; that attempt is thrown away for a fresh port.
 * `port` and `entry` let the harness test drive the collision with a stand-in server. */
async function startServer({ mongoUrl, logFile, env = {}, port, entry = 'index.js' }) {
    for (let attempt = 1; ; attempt += 1) {
        const chosen = attempt === 1 && port ? port : await freePort();
        try {
            return await startServerOn(chosen, { mongoUrl, logFile, env, entry });
        } catch (error) {
            if (!(error instanceof PortTakenError) || attempt >= START_ATTEMPTS) throw error;
        }
    }
}

module.exports = { startServer };
