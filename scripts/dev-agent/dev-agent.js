#!/usr/bin/env node
/*
 * AlianHub AI dev-agent — runner.
 *
 * The bridge between a task's "Development" chat in AlianHub and Claude Code on
 * your machine. The user chats instructions in the task's Development tab; this
 * runner (poll mode) picks them up, develops with Claude Code, and replies in
 * the same chat — then iterates on follow-up messages.
 *
 * It works freely with whatever the developer points it at:
 *   • a git URL         → cloned into the workspace, develop → push → open/update a PR
 *   • a local git repo  → develop on a branch → push → open/update a PR (if it has a remote)
 *   • a plain/empty folder → the agent just builds there; you open & test it locally
 *
 * The "agent" is just this script + Claude Code (the actual developer). It talks
 * to AlianHub over its REST API with a Personal API Token — nothing special on
 * the server. Runs on YOUR machine (where Claude Code, git and gh live).
 *
 * Modes:
 *   node dev-agent.js --poll [--interval <ms>]              watch the Development chats (recommended)
 *   node dev-agent.js --task <id> [--repo|--git] [--base]   one-shot, for testing
 *
 * Config (env, or config.json next to this file):
 *   ALIANHUB_URL, ALIANHUB_PAT, ALIANHUB_COMPANY_ID, ALIANHUB_USER_ID (optional),
 *   ALIANHUB_WORKSPACE (where URL clones go; default ./workspace),
 *   and an optional "repos" map: { "<projectId|projectCode>": { gitUrl?, localPath?, base? } }
 *
 * Prereqs on this machine: Node 18+, the `claude` CLI (logged in), `git`, `gh` (authed, for PRs).
 */

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node's fetch resolves `localhost` to IPv6 (::1) first on Windows, but many dev
// servers bind IPv4 only → ECONNREFUSED (the browser silently tries both). Retry
// once on 127.0.0.1 so a localhost URL just works.
async function httpFetch(url, opts) {
    try {
        return await fetch(url, opts);
    } catch (e) {
        // Only fall back for a genuine "nothing listened" (localhost → ::1 refused).
        // Never retry a post-send failure — it would re-send a non-idempotent POST.
        const code = e && e.cause && e.cause.code;
        if ((code === 'ECONNREFUSED' || code === 'ENOTFOUND') && /^https?:\/\/localhost([:/]|$)/i.test(url)) {
            return fetch(url.replace('//localhost', '//127.0.0.1'), opts);
        }
        throw e;
    }
}

// ── config ──────────────────────────────────────────────────────────────
function loadConfig() {
    const cfgPath = path.join(__dirname, 'config.json');
    const file = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    return {
        url: String(process.env.ALIANHUB_URL || file.url || '').replace(/\/+$/, ''),
        pat: process.env.ALIANHUB_PAT || file.pat || '',
        companyId: process.env.ALIANHUB_COMPANY_ID || file.companyId || '',
        userId: process.env.ALIANHUB_USER_ID || file.userId || '',
        workspace: path.resolve(process.env.ALIANHUB_WORKSPACE || file.workspace || path.join(__dirname, 'workspace')),
        repos: file.repos || {},
        claudeBin: process.env.ALIANHUB_CLAUDE_BIN || file.claudeBin || 'claude',
    };
}

function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i += 1) {
        const k = argv[i];
        if (k === '--poll') a.poll = true;
        else if (k === '--interval') a.interval = Number(argv[++i]);
        else if (k === '--task') a.task = argv[++i];
        else if (k === '--repo') a.repo = argv[++i];
        else if (k === '--git') a.git = argv[++i];
        else if (k === '--base') a.base = argv[++i];
        else if (k === '--pair') a.pair = argv[++i];
        else if (k === '--url') a.url = argv[++i];
    }
    return a;
}

// Find an executable the way the OS would, but robustly: scan PATH with PATHEXT
// so Windows npm shims (`claude` → `claude.cmd`) resolve even though Node's
// bare-name spawn only auto-appends `.exe`. An absolute path is returned as-is.
function findOnPath(cmd) {
    if (cmd.includes('\\') || cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
    const isWin = process.platform === 'win32';
    // Prefer real executables (.EXE/.CMD/.BAT) over an extension-less unix shim
    // (Windows can't spawn the latter), so put '' last.
    const exts = isWin ? [...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean), ''] : [''];
    // Search PATH, plus the Node install dir and %APPDATA%\npm: npm global shims
    // live alongside node.exe, and Node's own dir doesn't depend on PATH being set.
    const extra = isWin ? [path.dirname(process.execPath), path.join(process.env.APPDATA || '', 'npm')] : [];
    for (const dir of [...(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean)) {
        for (const ext of exts) {
            const p = path.join(dir, cmd + ext);
            try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch (e) { /* ignore */ }
        }
    }
    return null;
}

// Resolve a command to a concrete executable. On Windows a `.cmd`/`.bat` shim
// (e.g. claude.cmd) must be run through cmd.exe — Node won't spawn it directly.
const _exeCache = {};
function resolveExe(cmd) {
    if (_exeCache[cmd]) return _exeCache[cmd];
    let result = { exe: cmd, viaCmd: false, found: process.platform !== 'win32' };
    if (process.platform === 'win32') {
        let found = findOnPath(cmd);
        if (!found) {
            try {
                const w = spawnSync('where', [cmd], { encoding: 'utf8', windowsHide: true });
                if (w.status === 0 && w.stdout) {
                    const lines = w.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
                    found = lines.find((l) => /\.exe$/i.test(l)) || lines.find((l) => /\.(cmd|bat)$/i.test(l)) || lines[0];
                }
            } catch (e) { /* not found */ }
        }
        if (found) result = { exe: found, viaCmd: /\.(cmd|bat)$/i.test(found), found: true };
    }
    _exeCache[cmd] = result;
    return result;
}

// ── run a command with an arg array (no shell → no quoting headaches). ─────
// `input` (optional) is written to the child's stdin — used to hand Claude the
// prompt, which avoids quoting a large multi-line arg (esp. on Windows).
function run(cmd, cmdArgs, cwd, { capture = false, allowFail = false, input, timeout } = {}) {
    const { exe, viaCmd } = resolveExe(cmd);
    const file = viaCmd ? (process.env.ComSpec || 'cmd.exe') : exe;
    // No `/s`: it strips the quotes around a space-containing exe path
    // ("C:\Program Files\…\claude.cmd") and cmd then splits on the space.
    // Without it, cmd preserves the quoted path (our cmdArgs carry no quotes).
    const args = viaCmd ? ['/d', '/c', exe, ...cmdArgs] : cmdArgs;
    const r = spawnSync(file, args, {
        cwd,
        input,
        stdio: [input !== undefined ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit', 'pipe'],
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout,
        // Never block the runner on an interactive git/gh credential prompt — fail fast.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
    });
    if (r.error) { if (allowFail) return ''; throw new Error(`${cmd}: ${r.error.message}`); }
    if (r.status !== 0 && !allowFail) {
        throw new Error(`\`${cmd} ${cmdArgs.join(' ')}\` failed (exit ${r.status})${r.stderr ? `\n${String(r.stderr).trim()}` : ''}`);
    }
    return (r.stdout || '').trim();
}

// Kill a spawned child AND its descendants. On Windows child.kill() only kills the
// cmd.exe wrapper, orphaning the real `claude` (node) process — so the work keeps
// running after a Stop; taskkill /T /F kills the whole tree. POSIX gets SIGKILL.
function killTree(child) {
    if (!child) return;
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); } // kill the detached group; fall back to the child (C10)
        }
    } catch (e) { try { child.kill(); } catch (_) { /* ignore */ } }
}

// Run Claude Code headless with streaming JSON events so we can surface a live
// activity feed. Resolves on success, rejects on non-zero exit. `onEvent` gets
// each parsed stream-json event (system / assistant / tool_use / result).
function runClaude(cfg, dir, prompt, onEvent, cancel) {
    const TIMEOUT_MS = 30 * 60 * 1000; // watchdog: a hung Claude must not wedge the poller forever
    return new Promise((resolve, reject) => {
        if (cancel && cancel.requested) return reject(new Error('__CANCELLED__')); // stopped before we spawned (C9)
        const { exe, viaCmd } = resolveExe(cfg.claudeBin);
        const file = viaCmd ? (process.env.ComSpec || 'cmd.exe') : exe;
        const claudeArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
        const child = spawn(file, viaCmd ? ['/d', '/c', exe, ...claudeArgs] : claudeArgs, { cwd: dir, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
        if (cancel) cancel.child = child; // expose the child so an emergency Stop can kill it mid-run (Point 3)
        let stderr = ''; let buf = ''; let settled = false; let resultText = '';
        const finish = (err) => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (cancel) cancel.child = null;
            if (cancel && cancel.requested) return reject(new Error('__CANCELLED__')); // Stop won the race
            if (err) reject(err); else resolve(resultText); // resolve with Claude's final message (B5)
        };
        const timer = setTimeout(() => { try { killTree(child); } catch (e) { /* ignore */ } finish(new Error(`claude timed out after ${TIMEOUT_MS / 60000} min`)); }, TIMEOUT_MS);
        child.stdout.on('data', (chunk) => {
            buf += chunk.toString();
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                if (line) { try { const ev = JSON.parse(line); if (ev && ev.type === 'result' && typeof ev.result === 'string') resultText = ev.result; onEvent(ev); } catch (e) { /* non-JSON line */ } }
            }
        });
        child.stderr.on('data', (c) => { stderr += c.toString(); });
        child.on('error', finish);
        child.stdin.on('error', () => {}); // ignore EPIPE if the child already exited (else it throws + kills the runner)
        child.on('close', (code) => finish(code === 0 ? null : new Error(`claude exited ${code}${stderr ? `\n${stderr.trim().slice(0, 300)}` : ''}`)));
        try { child.stdin.write(prompt); child.stdin.end(); } catch (e) { /* 'error'/'close' will settle */ }
    });
}

// Turn a stream-json event into a short human activity line (or null to skip).
function activityLine(ev) {
    if (!ev || ev.type !== 'assistant' || !ev.message) return null;
    const blocks = ev.message.content || [];
    for (const b of blocks) {
        if (b && b.type === 'tool_use') {
            const inp = b.input || {};
            const file = String(inp.file_path || inp.path || inp.notebook_path || '').split(/[\\/]/).pop();
            if (b.name === 'Bash') return `▶ ${String(inp.command || '').replace(/\s+/g, ' ').slice(0, 100)}`;
            if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) return `✏️ ${b.name} ${file}`;
            if (b.name === 'Read') return `👀 read ${file}`;
            if (b.name === 'Grep' || b.name === 'Glob') return `🔎 ${b.name} ${String(inp.pattern || '')}`.slice(0, 70);
            return `🔧 ${b.name}`;
        }
    }
    const txt = blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
    return txt ? `💬 ${txt.slice(0, 120)}` : null;
}

// ── AlianHub REST (PAT auth) ──────────────────────────────────────────────
async function api(cfg, method, endpoint, body) {
    let res;
    try {
        res = await httpFetch(`${cfg.url}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${cfg.pat}`,
                companyid: cfg.companyId,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (e) {
        const cause = e && e.cause ? (e.cause.code || e.cause.message) : (e && e.message);
        throw new Error(`connection to ${cfg.url} failed (${cause}) — is AlianHub running?`);
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = text; }
    if (!res.ok) throw new Error(`API ${method} ${endpoint} → ${res.status}: ${String(text).slice(0, 300)}`);
    return json;
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';

// Commits are authored as the bot (clear ownership in git history + audit) and this
// also avoids a "no git identity configured" failure on a fresh machine. (B8)
const BOT_GIT = ['-c', 'user.name=AlianHub AI Agent', '-c', 'user.email=ai-bot@alianhub.local'];
const prWatch = new Map(); // branch → PR opened this session, watched for reviewer feedback (B4)

// Conventional-commit naming so the branch, commit, and PR title pass this repo's
// branch-name + commitlint CI (types feat|fix|…; lowercase type + scope; subject not
// Start/Sentence/UPPER-case; no trailing period; header ≤100). Type is data-driven from
// the task (a bug/defect → fix) with a safe 'feat' default; slug() is already CI-legal.
function conventional(task, taskKey) {
    const hay = [task && task.type, task && task.Task_type, task && task.taskType, task && task.TaskType, task && task.label, task && task.Task_Label, task && task.category]
        .filter(Boolean).map((v) => String(v).toLowerCase()).join(' ');
    const type = /\b(bug|fix|hotfix|defect|issue|error)\b/.test(hay) ? 'fix' : 'feat';
    const scope = slug(taskKey); // lowercase kebab, non-empty ('task' fallback) → scope-case ok
    const branch = `${type}/${scope}`;
    const headerFor = (subject) => {
        const prefix = `${type}(${scope}): `;
        let s = String(subject || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.\s]+$/, '');
        const max = 100 - prefix.length;
        if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') || s.slice(0, max);
        return prefix + (s || 'update');
    };
    return { type, scope, branch, headerFor };
}

// Strip rich-text HTML → readable text (task descriptions + comments are HTML).
function htmlToText(html) {
    return String(html || '')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
        .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Lightweight secret scan of ADDED diff lines — refuse to commit obvious credentials.
function findSecrets(diff) {
    const patterns = [
        [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key'],
        [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
        [/\baws_secret_access_key\b/i, 'AWS secret'],
        [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
        [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
        [/\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/i, 'hardcoded credential'],
    ];
    const hits = new Set();
    for (const line of String(diff || '').split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        for (const [re, label] of patterns) { if (re.test(line)) hits.add(label); }
    }
    return [...hits];
}

// Stage the AI's changes (excluding env files) and refuse if the staged diff carries
// obvious secrets — so nothing leaks into a commit/PR. Throws a clear message on a hit.
function stageChanges(dir) {
    run('git', ['add', '-A', '--', '.', ':(exclude).env', ':(exclude).env.*', ':(exclude)**/.env', ':(exclude)**/.env.*'], dir, { allowFail: true });
    const secrets = findSecrets(run('git', ['diff', '--cached'], dir, { capture: true, allowFail: true }));
    if (secrets.length) {
        run('git', ['reset'], dir, { allowFail: true });
        throw new Error(`possible secret(s) in the changes (${secrets.join(', ')}) — not committing. Remove the credential(s) and resend.`);
    }
}

// Task comments (best-effort) — requirements & clarifications often live there.
async function fetchComments(cfg, projectId, taskId) {
    if (!projectId || !taskId) return [];
    try {
        const res = await api(cfg, 'GET', `/api/v1/comments/get-paginated-messages?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}&batchLimit=30`);
        const d = res && res.data;
        const rows = Array.isArray(d) ? d : ((d && (d.messages || d.data || d.comments)) || []);
        return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
}

// Prior Development-tab conversation. The task memory file only carries what the
// agent chose to write down, so without this an earlier instruction it didn't
// record is lost on the next turn.
async function fetchDevChat(cfg, taskId) {
    if (!taskId) return [];
    try {
        const res = await api(cfg, 'GET', `/api/v2/dev-agent/messages?taskId=${encodeURIComponent(taskId)}`);
        const rows = res && res.data;
        return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
}

// The agent's live-progress message holds the whole activity log (dozens of
// lines, rewritten in place as it works) — that is a UI artifact, not
// conversation, so it must never reach the prompt. Both headers come from
// renderProgress() below.
const isProgressLog = (text) => /^(🧾 Activity —|⚙️ Working…)/.test(String(text || '').trim());

// Verify the AI's work before it becomes a PR (A1): syntax-check every changed JS file
// with `node --check` (instant, no deps) so a parse error is caught + self-fixed here,
// not in CI. Build/lint/test verification comes in a later pass (it needs a non-blocking
// spawn so a long build can't wedge the poller). Returns { ok, report }. Best-effort.
// Like run() but never throws; returns { code, out } (stdout+stderr) and honours a timeout.
function runResult(cmd, cmdArgs, cwd, { timeout } = {}) {
    const { exe, viaCmd } = resolveExe(cmd);
    const file = viaCmd ? (process.env.ComSpec || 'cmd.exe') : exe;
    const args = viaCmd ? ['/d', '/c', exe, ...cmdArgs] : cmdArgs;
    const r = spawnSync(file, args, {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: false, windowsHide: true,
        timeout, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', CI: '1' },
    });
    const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
    return { code: r.error ? (timedOut ? 124 : -1) : (r.status == null ? -1 : r.status), out: `${r.stdout || ''}${r.stderr || ''}`, timedOut };
}
function hasScript(pkgDir, name) {
    try { const p = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')); return !!(p.scripts && p.scripts[name]); } catch (e) { return false; }
}

function verifyWork(dir, changed, onProgress) {
    const notes = []; let ok = true;
    const touched = changed || [];
    // 1) Syntax-check changed JS with `node --check` (instant, no deps). This is the HARD
    //    signal that drives the self-fix loop — a parse error is always the AI's to fix.
    const jsFiles = touched.filter((f) => /\.(js|cjs|mjs)$/.test(f) && fs.existsSync(path.join(dir, f)));
    if (jsFiles.length && onProgress) onProgress(`🔎 syntax-checking ${jsFiles.length} changed JS file(s)…`);
    for (const f of jsFiles) {
        const r = spawnSync(process.execPath, ['--check', path.join(dir, f)], { cwd: dir, encoding: 'utf8', timeout: 30000, windowsHide: true });
        if (r.status !== 0) {
            ok = false;
            notes.push(`✗ ${f}: ${String(r.stderr || (r.error && r.error.message) || 'check failed').trim().split('\n').slice(0, 4).join(' ').slice(0, 300)}`);
        }
    }
    if (ok && jsFiles.length) notes.push(`✓ ${jsFiles.length} changed JS file(s) parse cleanly`);
    // 2) Build/lint (C3) — only where deps are ALREADY installed (never auto-install: too
    //    heavy). REPORT-ONLY: surfaced to the reviewer but does NOT drive the fix-loop, since a
    //    build can fail for environment reasons (missing build-time vars) the AI can't fix.
    if (touched.some((f) => f.startsWith('frontend/')) && fs.existsSync(path.join(dir, 'frontend', 'node_modules'))) {
        for (const s of ['lint', 'build']) {
            if (!hasScript(path.join(dir, 'frontend'), s)) continue;
            if (onProgress) onProgress(`🔎 frontend ${s}…`);
            const r = runResult('npm', ['run', s], path.join(dir, 'frontend'), { timeout: 12 * 60 * 1000 });
            notes.push(r.code === 0 ? `✓ frontend ${s}` : `⚠️ frontend ${s} failed${r.timedOut ? ' (timed out)' : ''}:\n${r.out.trim().slice(-600)}`);
        }
    }
    if (touched.some((f) => /\.(js|cjs|mjs)$/.test(f) && !f.startsWith('frontend/')) && fs.existsSync(path.join(dir, 'node_modules')) && hasScript(dir, 'lint')) {
        if (onProgress) onProgress('🔎 lint…');
        const r = runResult('npm', ['run', 'lint'], dir, { timeout: 6 * 60 * 1000 });
        notes.push(r.code === 0 ? '✓ lint' : `⚠️ lint failed${r.timedOut ? ' (timed out)' : ''}:\n${r.out.trim().slice(-600)}`);
    }
    return { ok, report: notes.join('\n') };
}

const isGitUrl = (s) => /^(https?:\/\/|git@|ssh:\/\/)/i.test(String(s || '').trim());

// A repo location string ("https://…" or a local path) → resolveWorkdir() args.
function repoArgsFromLocation(location, base) {
    const loc = String(location || '').trim();
    return { repo: isGitUrl(loc) ? '' : loc, git: isGitUrl(loc) ? loc : '', base };
}

// Resolve the working directory — the agent works freely with whatever it's given:
//   • a git URL       → clone into the workspace (reuse + pull next time), pushable;
//   • a local path    → use as-is, CREATED if missing, git repo or not.
// Returns { dir, base, pushable } where pushable === the repo has a git remote.
// Sources, in priority: CLI/message args → config.repos[projectId|projectCode].
function resolveWorkdir(cfg, projectId, projectCode, args) {
    const perProject = cfg.repos[projectId] || cfg.repos[projectCode] || {};
    const localPath = args.repo || perProject.localPath || '';
    const gitUrl = args.git || perProject.gitUrl || '';
    const base = args.base || perProject.base || 'main';

    // Prefer an explicit local path (a folder the developer chose to work in).
    if (localPath) {
        const dir = path.resolve(localPath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); console.log(`📁  Created folder: ${dir}`); }
        else { console.log(`📁  Local folder: ${dir}`); }
        let pushable = false;
        if (run('git', ['rev-parse', '--is-inside-work-tree'], dir, { capture: true, allowFail: true }) === 'true') {
            pushable = !!run('git', ['remote'], dir, { capture: true, allowFail: true }).trim();
        }
        return { dir, base, pushable };
    }
    if (gitUrl) {
        // Namespace the clone by a short hash of the FULL url so two repos with the same
        // basename (orgA/api vs orgB/api) never collide into one clone (C4).
        const base0 = slug((gitUrl.split('/').pop() || 'repo').replace(/\.git$/i, ''));
        const dir = path.join(cfg.workspace, `${base0}-${crypto.createHash('sha1').update(gitUrl).digest('hex').slice(0, 8)}`);
        if (fs.existsSync(path.join(dir, '.git'))) {
            // Reuse only if it is genuinely the same remote; otherwise the dir is stale → reclone.
            const origin = run('git', ['remote', 'get-url', 'origin'], dir, { capture: true, allowFail: true }).trim();
            if (origin === gitUrl) {
                console.log(`📁  Workspace clone: ${dir}`);
            } else {
                console.log(`♻️  Stale clone (${origin || 'no remote'} ≠ ${gitUrl}) — recloning ${dir} …`);
                fs.rmSync(dir, { recursive: true, force: true });
                run('git', ['clone', gitUrl, dir], cfg.workspace);
            }
        } else {
            fs.mkdirSync(cfg.workspace, { recursive: true });
            console.log(`📥  Cloning ${gitUrl} → ${dir} …`);
            run('git', ['clone', gitUrl, dir], cfg.workspace);
        }
        return { dir, base, pushable: true };
    }
    throw new Error('No repository set for this task — set it once in the Development tab (send a message with the repo), or add the project to config.json "repos".');
}

async function fetchTask(cfg, taskId) {
    const res = await api(cfg, 'GET', `/api/v1/task/${taskId}`);
    return (res && res.data) || res || {};
}

// The per-task shared memory lives IN the repo (.alianhub/tasks/<TaskKey>.md) so
// it travels between developers — anyone picking up the task, on any machine or
// Claude account, gets the full history from a git pull/clone. No external store.
const contextRel = (taskKey) => `.alianhub/tasks/${String(taskKey).replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
function readContext(dir, taskKey) {
    try {
        const f = path.join(dir, ...contextRel(taskKey).split('/'));
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 12000) : '';
    } catch (e) { return ''; }
}

function buildPrompt({ taskKey, taskName, description, instruction, pushable, contextPath, contextText, comments, chat, meta }) {
    return [
        `You are developing AlianHub task ${taskKey}: ${taskName}.`,
        meta ? `\n${meta}` : '',
        description ? `\nTask description / acceptance criteria:\n${description}` : '',
        comments ? `\nTask discussion so far (oldest → newest) — requirements and clarifications often live in the comments, so read them and honour them:\n${comments}` : '',
        chat ? `\nDevelopment tab conversation so far (oldest → newest) — the instructions you were already given on this task, and your own replies. Honour them as still standing unless the instruction for this turn contradicts them; where two conflict, the later one wins:\n${chat}` : '',
        contextText ? `\nPrior development context for this task (from ${contextPath}, written on earlier turns — possibly by other developers on other machines). Read it and continue from where it left off; do NOT redo work already done:\n${contextText}` : '',
        `\nThe user's instruction for this turn:\n${instruction}`,
        '',
        "Before you code, read this repository's own conventions (CLAUDE.md, README, CONTRIBUTING, and its lint/editor config) and match the existing structure, style, and patterns. Keep the change focused and strictly in scope for the task.",
        "If the task is too ambiguous or you are missing information needed to implement it safely, do NOT guess — briefly explain what you need and make no changes; a developer will clarify and resend.",
        "Where the repository has a test setup, add or update a test that covers what you changed.",
        pushable
            ? "Implement it in this repository. Run the repo's tests / build / lint if they are quick, to confirm your change works. Do NOT commit or push — the runner handles git."
            : 'This is a local working folder (it may be empty). Build what is asked directly here — create/scaffold whatever files are needed. Run relevant setup/tests if quick. Do NOT worry about git; the developer will test locally.',
        '',
        `SHARED TASK MEMORY — before you finish, create or update "${contextPath}" in this repo. Keep it concise and CUMULATIVE so any developer (different machine / Claude account) who continues this task later has the full picture. Append a new dated section covering: what you did this turn, key decisions/assumptions, current state, and what remains (TODO). It is committed with your changes.`,
    ].join('\n');
}

// Headless Claude Code refuses to run in an untrusted folder (even with
// --dangerously-skip-permissions). Pre-mark the target folder trusted in
// ~/.claude.json — exactly what the "workspace not trusted" message suggests —
// so the agent can work in a fresh folder the user pointed it at. Keys can be
// stored back- or forward-slashed, so set both. Best-effort; never fatal.
function ensureTrusted(dir) {
    try {
        const cfgFile = path.join(os.homedir(), '.claude.json');
        if (!fs.existsSync(cfgFile)) return;
        const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        if (!j.projects || typeof j.projects !== 'object') j.projects = {};
        const abs = path.resolve(dir);
        let changed = false;
        for (const key of [abs, abs.replace(/\\/g, '/')]) {
            if (!j.projects[key] || typeof j.projects[key] !== 'object') j.projects[key] = {};
            if (j.projects[key].hasTrustDialogAccepted !== true) { j.projects[key].hasTrustDialogAccepted = true; changed = true; }
        }
        if (changed) {
            const tmp = `${cfgFile}.dev-agent.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
            fs.renameSync(tmp, cfgFile); // atomic — never leave a truncated ~/.claude.json
            console.log(`🔓  Trusted workspace: ${abs}`);
        }
    } catch (e) { console.log(`  (couldn't pre-trust ${dir}: ${e.message})`); }
}

// Develop ONE turn. If the target is pushable (has a git remote), work on the
// task branch and open/update a PR. Otherwise just build in the folder and let
// the developer test locally. Returns { prUrl, note }.
async function developTurn(cfg, { dir, base, pushable, taskKey, taskName, description, instruction, onProgress, cancel, conv, comments, chat, meta }) {
    ensureTrusted(dir);
    const cv = conv || conventional({ TaskName: taskName }, taskKey);
    const ctxPath = contextRel(taskKey);
    const onEvent = (ev) => { const line = activityLine(ev); if (!line) return; if (onProgress) onProgress(line); else console.log(`   ${line}`); };

    if (pushable) {
        const branch = cv.branch;
        console.log(`\n🌿  ${dir}\n    ${taskKey} → branch "${branch}" (base "${base}")`);
        run('git', ['fetch', 'origin'], dir, { allowFail: true });
        // Never sweep the developer's uncommitted work into the AI's branch/PR.
        if (run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
            throw new Error('the repo has uncommitted changes — commit or stash them first, then resend.');
        }
        const remoteBranch = run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], dir, { capture: true, allowFail: true });
        if (remoteBranch) {
            run('git', ['checkout', '-B', branch, `origin/${branch}`], dir); // continue prior work
        } else {
            run('git', ['checkout', base], dir);
            run('git', ['pull', '--ff-only', 'origin', base], dir, { allowFail: true });
            run('git', ['checkout', '-B', branch], dir);                     // fresh
        }

        const prompt = buildPrompt({ taskKey, taskName, description, instruction, pushable, contextPath: ctxPath, contextText: readContext(dir, taskKey), comments, chat, meta });
        console.log('\n🤖  Claude Code …\n');
        const result = await runClaude(cfg, dir, prompt, onEvent, cancel);

        let didCommit = false;
        if (run('git', ['status', '--porcelain'], dir, { capture: true })) {
            stageChanges(dir); // scoped staging + secret scan (A2)
            run('git', [...BOT_GIT, 'commit', '-m', `${cv.headerFor(instruction)}\n\nvia AlianHub AI dev-agent (Claude Code)`], dir);
            didCommit = true;
        }
        const ahead = run('git', ['rev-list', '--count', `origin/${base}..HEAD`], dir, { capture: true, allowFail: true });
        // A committed change must never be silently dropped (C2): only report "no changes"
        // when we truly produced nothing — no commit this turn AND branch not ahead of base.
        if (!didCommit && (!ahead || ahead === '0')) return { prUrl: '', note: result ? String(result).slice(0, 1500) : 'No code changes were needed.' };

        // Self-review (B3): a second pass over the ACTUAL diff to catch bugs, scope creep,
        // and quality issues before a human sees it. One bounded pass; commits any fixes.
        if (!(cancel && cancel.requested)) {
            onProgress('🔎 self-reviewing the change…');
            const reviewDiff = run('git', ['diff', `origin/${base}...HEAD`], dir, { capture: true, allowFail: true }) || run('git', ['show', 'HEAD'], dir, { capture: true, allowFail: true });
            await runClaude(cfg, dir, `Review your OWN change for task ${taskKey} before it becomes a pull request — check correctness, security, that it is in-scope and complete, and that it matches the repo's conventions. If you find problems, FIX them now; if it is already good, change nothing. Do NOT commit or push.\n\nDiff so far:\n${String(reviewDiff).slice(0, 40000)}`, onEvent, cancel);
            if (run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
                stageChanges(dir);
                run('git', [...BOT_GIT, 'commit', '-m', `${cv.headerFor('address self-review')}\n\nvia AlianHub AI dev-agent (Claude Code)`], dir, { allowFail: true });
            }
        }

        // Verify before it becomes a PR (A1): syntax-check the changed JS; on failure hand
        // the errors back to Claude to fix (≤2 rounds), then continue regardless (flagged),
        // so even a stubborn failure yields a reviewable branch rather than silently blocking.
        const listChanged = () => (run('git', ['diff', '--name-only', `origin/${base}...HEAD`], dir, { capture: true, allowFail: true })
            || run('git', ['diff', '--name-only', `${base}...HEAD`], dir, { capture: true, allowFail: true })
            || run('git', ['show', '--name-only', '--format=', 'HEAD'], dir, { capture: true, allowFail: true }))
            .split('\n').map((s) => s.trim()).filter(Boolean);
        let vr = verifyWork(dir, listChanged(), onProgress);
        for (let i = 0; i < 2 && !vr.ok && !(cancel && cancel.requested); i += 1) {
            onProgress(`🔧 verification failed — asking the AI to fix (round ${i + 1})…`);
            await runClaude(cfg, dir, `Your change did not pass verification. Fix the problem(s) below, keeping the change focused. Do NOT commit or push — the runner handles git.\n\n${vr.report}`, onEvent, cancel);
            if (run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
                stageChanges(dir);
                run('git', [...BOT_GIT, 'commit', '-m', `${cv.headerFor('fix verification issues')}\n\nvia AlianHub AI dev-agent (Claude Code)`], dir, { allowFail: true });
            }
            vr = verifyWork(dir, listChanged(), onProgress);
        }
        onProgress(vr.ok ? '✅ verification passed' : '⚠️ verification still failing — pushing for review anyway');

        // PR gate (Point 2): push the branch (so it's ready to review, and a manual PR
        // works too) but DON'T open the PR yet — hand back `pushed` so the caller can ask
        // for approval. openPr (a 'pending_pr' job) opens the PR once the user approves.
        run('git', ['push', '-u', 'origin', branch], dir);
        return { prUrl: '', pushed: true, branch, note: '', verifyOk: vr.ok, verifyReport: vr.report };
    }

    // Local folder — no remote. Build freely; the developer tests locally.
    const prompt = buildPrompt({ taskKey, taskName, description, instruction, pushable, contextPath: ctxPath, contextText: readContext(dir, taskKey), comments, chat, meta });
    console.log(`\n🤖  Claude Code (local folder — building in place) …\n`);
    const result = await runClaude(cfg, dir, prompt, onEvent, cancel);

    // Best-effort snapshot if it's already a git repo (so the change is tracked).
    let committed = false;
    if (fs.existsSync(path.join(dir, '.git')) && run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
        stageChanges(dir); // scoped staging + secret scan (A2)
        run('git', [...BOT_GIT, 'commit', '-m', cv.headerFor(instruction)], dir, { allowFail: true });
        committed = true;
    }
    const summary = result ? `\n\n${String(result).slice(0, 1200)}` : '';
    return { prUrl: '', note: `Work is ready in ${dir} — open & test it locally${committed ? ' (committed to your local repo)' : ''}. Point me at a git URL or add a remote when you want a PR.${summary}` };
}

// Open (or return an existing) PR for a task's already-developed branch. Used by the
// PR-approval step (Point 2) — no Claude run, just a defensive push + gh pr create.
function openPr(cfg, dir, base, taskKey, taskName, conv) {
    const cv = conv || conventional({ TaskName: taskName }, taskKey);
    const branch = cv.branch;
    run('git', ['fetch', 'origin'], dir, { allowFail: true });
    if (!run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], dir, { capture: true, allowFail: true })) {
        // Branch not on the remote yet — push the local one if it exists.
        if (run('git', ['rev-parse', '--verify', '--quiet', branch], dir, { capture: true, allowFail: true })) {
            run('git', ['push', '-u', 'origin', branch], dir, { allowFail: true });
        }
    }
    let prUrl = run('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '-q', '.[0].url'], dir, { capture: true, allowFail: true }); // only reuse an OPEN PR, not a merged/closed one (C11)
    if (!prUrl) {
        // Richer PR body (B2): summary + the files it touched, so reviewers have context.
        const stat = run('git', ['diff', '--stat', `origin/${base}...origin/${branch}`], dir, { capture: true, allowFail: true });
        const body = [
            `Implements AlianHub task **${taskKey} — ${taskName}** via the AlianHub AI dev-agent (Claude Code).`,
            stat ? `\n**Files changed**\n\`\`\`\n${stat.slice(0, 2000)}\n\`\`\`` : '',
            '\n_Automated change — please review before merging._',
        ].filter(Boolean).join('\n');
        prUrl = run('gh', ['pr', 'create', '--base', base, '--head', branch,
            '--title', cv.headerFor(taskName),
            '--body', body],
        dir, { capture: true });
    }
    return prUrl;
}

// ── poll mode: watch Development chats and develop each new instruction ────
async function reply(cfg, msg, { status, text, prUrl }) {
    const body = {
        taskId: msg.taskId, projectId: msg.projectId, sprintId: msg.sprintId,
        parentId: msg._id, status, text, prUrl: prUrl || '',
    };
    // Retry: the work is done, so a transient blip (e.g. the dev server
    // restarting during a long build) must not lose the result.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
        try { const r = await api(cfg, 'POST', '/api/v2/dev-agent/reply', body); return (r && r.data) || null; }
        catch (e) {
            if (attempt === 5) { console.error(`  reply failed after ${attempt} attempts: ${e.message}`); return null; }
            console.log(`  reply attempt ${attempt} failed (${e.message}); retrying in ${2 * attempt}s…`);
            // eslint-disable-next-line no-await-in-loop
            await sleep(2000 * attempt);
        }
    }
    return null;
}

async function handleMessage(cfg, msg) {
    // Atomic claim so two runners can't both take the same task (also recovers a
    // task whose previous runner died). Skip if another runner already has it.
    try {
        const c = await api(cfg, 'POST', '/api/v2/dev-agent/claim', { messageId: msg._id });
        if (!c || !c.claimed) return;
    } catch (e) {
        // 404 = older backend without /claim → proceed best-effort. Any other error
        // (500 / network / already-claimed) → skip, so we never double-process a task
        // the backend may have handed to another runner.
        if (!/→\s*404/.test(e.message || '')) return;
    }
    console.log(`\n▶  task ${msg.taskId}: "${String(msg.text).slice(0, 70)}"`);
    // Keep-alive so a genuinely long task isn't re-claimed as stale by another runner.
    // Emergency-stop token (Point 3): the heartbeat doubles as a cancel poll. If the
    // backend reports the job was stopped, kill the running Claude child at once.
    const cancel = { requested: false, child: null };
    const hb = setInterval(async () => {
        try {
            const r = await api(cfg, 'POST', '/api/v2/dev-agent/heartbeat', { messageId: msg._id });
            if (r && r.cancel && !cancel.requested) {
                cancel.requested = true;
                console.log('  ⏹ stop requested — aborting…');
                if (cancel.child) killTree(cancel.child);
            }
        } catch (e) { /* ignore */ }
    }, 5000);
    const working = await reply(cfg, msg, { status: 'working', text: '⚙️ Working on it…' });
    const workingId = working && working._id;
    // Live progress — accumulate the FULL activity transcript on the "working"
    // message so the Development tab shows the same step-by-step history as the
    // terminal (not just the last few lines). Throttled to limit writes, with a
    // guaranteed final flush so the tail of the log always lands (a fast task used
    // to finish inside the throttle window and only ever show its first line).
    const activityLog = [];
    const RENDER_LINES = 120; // recent steps rendered in the bubble
    const KEEP_LINES = 220;   // steps retained in memory (bounds the message doc)
    let lastPost = 0;
    let progressWarned = false;
    const warnOnce = (m) => { if (!progressWarned) { progressWarned = true; console.log(`   (⚠ live progress not reaching the tab: ${m})`); } };
    const renderProgress = (done) => {
        const n = activityLog.length;
        const shown = activityLog.slice(-RENDER_LINES);
        const hidden = n - shown.length;
        const header = done ? `🧾 Activity — ${n} step${n === 1 ? '' : 's'}` : `⚙️ Working… · ${n} step${n === 1 ? '' : 's'}`;
        const more = hidden > 0 ? `  … (${hidden} earlier step${hidden === 1 ? '' : 's'})\n` : '';
        return `${header}\n${more}${shown.map((l) => `• ${l}`).join('\n')}`;
    };
    const postProgress = (done) => {
        if (!workingId) return Promise.resolve();
        return api(cfg, 'POST', '/api/v2/dev-agent/progress', { messageId: workingId, text: renderProgress(done) })
            .catch((e) => warnOnce(`${e.message} — restart the AlianHub backend so /api/v2/dev-agent/progress exists`));
    };
    const onProgress = (line) => {
        console.log(`   ${line}`);
        if (!workingId) { warnOnce('no working-message id from the reply'); return; }
        activityLog.push(line);
        if (activityLog.length > KEEP_LINES) activityLog.splice(0, activityLog.length - KEEP_LINES);
        const now = Date.now();
        if (now - lastPost < 2000) return; // throttle the live edits
        lastPost = now;
        postProgress(false);
    };
    // Land the complete transcript at the end (covers lines the throttle skipped).
    const flushProgress = () => postProgress(true);
    let cleanup = null; // pushable workdir to reset if this turn fails, so a dirty tree can't wedge the next turn (C1)
    try {
        const task = await fetchTask(cfg, msg.taskId);
        const taskKey = task.TaskKey || msg.taskId;
        const conv = conventional(task, taskKey); // CI-legal branch/commit/PR naming
        const projectCode = taskKey.includes('-') ? taskKey.split('-')[0] : '';
        // A bot-assigned job carries no repo — inherit the task's last-used repo (set in the Development tab).
        if (!String(msg.repo || '').trim()) {
            try {
                const hist = await api(cfg, 'GET', `/api/v2/dev-agent/messages?taskId=${encodeURIComponent(msg.taskId)}`);
                const withRepo = [...((hist && hist.data) || [])].reverse().find((m) => m.repo);
                if (withRepo) { msg.repo = withRepo.repo; msg.base = withRepo.base || msg.base; }
            } catch (e) { /* fall back to config.repos */ }
        }
        const { dir, base, pushable } = resolveWorkdir(cfg, String(task.ProjectID || ''), projectCode, repoArgsFromLocation(msg.repo, msg.base));
        if (pushable) cleanup = dir;
        onProgress(`📁 ${pushable ? 'repository' : 'local folder'}: ${dir}`); // immediate first update so the tab changes right away
        if (msg.status === 'pending_pr' || msg.status === 'working_pr') {
            // PR-approval step (Point 2): the code is already developed + pushed — just
            // open the pull request for its branch. No Claude run. ('working_pr' = a stale
            // PR-open job recovered mid-flight — still open the PR, don't re-develop. C5)
            onProgress('🔀 Opening the pull request…');
            const prUrl = pushable ? openPr(cfg, dir, base, taskKey, task.TaskName || '(untitled task)', conv) : '';
            const text = prUrl
                ? `✅ PR opened: ${prUrl}`
                : (pushable ? '⚠️ Could not open the PR — check that the branch was pushed.' : 'This is a local folder — there is no remote to open a PR against.');
            await reply(cfg, msg, { status: 'done', text, prUrl });
            if (prUrl) prWatch.set(conv.branch, { taskId: msg.taskId, projectId: msg.projectId, sprintId: msg.sprintId, repo: msg.repo, base, dir, prUrl, lastSeen: new Date().toISOString() }); // watch for reviewer feedback (B4)
            console.log(`  ✓ PR: ${prUrl}`);
        } else {
            // Context enrichment (A3): task comments + a metadata line, so the AI works
            // from the real requirements (which usually live in the discussion), not just
            // the one-line description. Description HTML is stripped to readable text.
            const commentRows = await fetchComments(cfg, String(task.ProjectID || ''), msg.taskId);
            const comments = commentRows
                .map((c) => { const b = htmlToText(c.message || c.comment || c.text || '').slice(0, 500); return b ? `- ${c.userName || c.createdByName || 'comment'}: ${b}` : ''; })
                .filter(Boolean).slice(-15).join('\n');
            // The turn's own instruction is passed separately, so drop it here —
            // otherwise the agent reads it twice, once as history.
            const chat = (await fetchDevChat(cfg, msg.taskId))
                .filter((m) => String(m._id) !== String(msg._id) && !isProgressLog(m.text))
                .map((m) => {
                    const body = String(m.text || '').trim().slice(0, 600);
                    return body ? `- ${m.role === 'agent' ? 'AI agent' : 'developer'}: ${body}` : '';
                })
                .filter(Boolean).slice(-20).join('\n');
            const metaBits = [];
            if (task.Task_Priority || task.priority) metaBits.push(`Priority: ${task.Task_Priority || task.priority}`);
            if (task.sprintName || task.SprintName) metaBits.push(`Sprint: ${task.sprintName || task.SprintName}`);
            const { prUrl, note, pushed, branch, verifyOk, verifyReport } = await developTurn(cfg, {
                dir, base, pushable, taskKey, taskName: task.TaskName || '(untitled task)',
                description: htmlToText(task.description || task.rawDescription || ''), instruction: msg.text,
                comments, chat, meta: metaBits.join(' · '), conv, onProgress, cancel,
            });
            if (pushable && pushed && !prUrl) {
                // PR gate (Point 2): developed + pushed — wait for approval to open the PR.
                const vtext = verifyReport ? `\n\n🔎 ${verifyOk === false ? '⚠️ verification issues remain — review carefully:' : 'verified:'}\n${verifyReport.slice(0, 800)}` : '';
                await reply(cfg, msg, { status: 'awaiting_pr', text: `✅ Developed & pushed \`${branch}\`. Review it, then click **Create PR** to open the pull request — or open it yourself on GitHub.${vtext}` });
                console.log(`  ⏸ awaiting PR approval (${branch})`);
            } else {
                const text = prUrl ? `✅ Done. PR: ${prUrl}` : `✅ ${note || 'Done.'}`;
                await reply(cfg, msg, { status: 'done', text, prUrl });
                console.log(`  ✓ ${prUrl || note}`);
            }
        }
    } catch (e) {
        // A cancelled/failed turn can leave the AI's partial edits in the tree; reset so the
        // next turn's clean-tree guard isn't wedged (the user's work was clean at start). (C1)
        if (cleanup) { run('git', ['reset', '--hard'], cleanup, { allowFail: true }); run('git', ['clean', '-fd'], cleanup, { allowFail: true }); }
        if (cancel.requested || /__CANCELLED__/.test(e.message || '')) {
            await reply(cfg, msg, { status: 'cancelled', text: '⏹ Stopped — cancelled by request.' });
            console.log('  ⏹ cancelled');
        } else {
            await reply(cfg, msg, { status: 'error', text: `⚠️ ${e.message}` });
            console.error(`  ✗ ${e.message}`);
        }
    } finally {
        await flushProgress(); // ensure the full step-by-step log is visible in the tab
        clearInterval(hb);
    }
}

// B4: watch PRs this runner opened and, when a reviewer leaves NEW feedback, queue a
// follow-up develop job (awaiting_approval) so the bot addresses it after a human OK.
// In-memory for this session — a restart simply stops watching older PRs.
async function checkPrFeedback(cfg) {
    for (const [branch, w] of prWatch) {
        try {
            const out = run('gh', ['pr', 'view', branch, '--json', 'state,comments,reviews'], w.dir, { capture: true, allowFail: true });
            if (!out) continue;
            const pr = JSON.parse(out);
            if (pr.state && pr.state !== 'OPEN') { prWatch.delete(branch); continue; } // merged/closed → stop watching
            const items = [];
            for (const c of (pr.comments || [])) if (c.body && c.createdAt && c.createdAt > w.lastSeen) items.push(`- ${String(c.body).slice(0, 600)}`);
            for (const rv of (pr.reviews || [])) if (rv.body && rv.submittedAt && rv.submittedAt > w.lastSeen) items.push(`- (${rv.state || 'review'}) ${String(rv.body).slice(0, 600)}`);
            if (!items.length) continue;
            w.lastSeen = new Date().toISOString();
            const text = `A reviewer left feedback on the pull request (${w.prUrl}). Address it on the SAME branch, keeping the change focused:\n\n${items.join('\n').slice(0, 4000)}`;
            await api(cfg, 'POST', '/api/v2/dev-agent/enqueue', { taskId: w.taskId, projectId: w.projectId, sprintId: w.sprintId, text, repo: w.repo, base: w.base }).catch(() => {});
            console.log(`  💬 review feedback on ${branch} → queued a follow-up for approval`);
        } catch (e) { /* best-effort */ }
    }
}

async function pollLoop(cfg, intervalMs) {
    console.log(`\n👀  Polling ${cfg.url} every ${Math.round(intervalMs / 1000)}s for Development-chat instructions… (Ctrl+C to stop)`);
    const MAX = Math.max(1, Number(cfg.maxConcurrent) || 2); // develop a few tasks at once
    const active = new Set();
    let lastFeedback = 0;
    for (;;) {
        try {
            if (active.size < MAX) {
                const res = await api(cfg, 'GET', '/api/v2/dev-agent/pending');
                const pending = (res && res.data) || [];
                for (const msg of pending) {
                    if (active.size >= MAX) break;
                    const id = String(msg._id);
                    if (active.has(id)) continue; // already running on this machine
                    active.add(id);
                    // Fire-and-forget under the pool cap; the atomic /claim inside prevents
                    // double-processing across runners, and each job has its own heartbeat +
                    // cancel token, so they run independently (F1 concurrency).
                    handleMessage(cfg, msg)
                        .catch((e) => console.error(`task error: ${e.message}`))
                        .finally(() => active.delete(id));
                }
            }
        } catch (e) {
            console.error(`poll error: ${e.message}`);
        }
        // B4: periodically pull PR review feedback for PRs opened this session (~60s).
        if (prWatch.size && Date.now() - lastFeedback > 60000) { lastFeedback = Date.now(); await checkPrFeedback(cfg); }
        // eslint-disable-next-line no-await-in-loop
        await sleep(intervalMs);
    }
}

// Zero-config onboarding: exchange the one-time code (from AlianHub → Development
// tab → "Connect this computer") for a fresh PAT and write config.json. No manual
// url / token / companyId entry.
async function pairAndSaveConfig(urlArg, code) {
    const url = String(urlArg || '').replace(/\/+$/, '');
    if (!url) throw new Error('Pairing needs the AlianHub URL — use the full command shown in the Development tab (it includes --url).');
    console.log(`\n🔗  Pairing with ${url} …`);
    let res;
    try {
        res = await httpFetch(`${url}/api/v2/dev-pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
    } catch (e) {
        const cause = e && e.cause ? (e.cause.code || e.cause.message) : (e && e.message);
        throw new Error(`could not reach ${url} (${cause}) — check the URL / that AlianHub is running.`);
    }
    const body = await res.text().then((t) => { try { return JSON.parse(t); } catch (e) { return {}; } });
    if (!res.ok || !body.status || !body.data || !body.data.token) {
        throw new Error((body && body.statusText) || `pairing failed (HTTP ${res.status}).`);
    }
    const cfgPath = path.join(__dirname, 'config.json');
    const existing = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    fs.writeFileSync(cfgPath, JSON.stringify({
        ...existing, url, pat: body.data.token, companyId: body.data.companyId, userId: body.data.userId || '',
    }, null, 2), { mode: 0o600 }); // contains the PAT — restrict perms
    console.log(`✅  Paired — saved ${cfgPath}. Watching for Development-chat tasks…`);
}

function preflight(cfg) {
    const r = resolveExe(cfg.claudeBin);
    if (r.found) { console.log(`🧠  Claude Code: ${r.exe}${r.viaCmd ? ' (via cmd.exe)' : ''}`); return; }
    console.log(`\n⚠️  Could not find the Claude Code CLI ("${cfg.claudeBin}") on PATH.`);
    console.log('   • Check that `claude` runs in THIS terminal:  where claude');
    console.log('   • Or set the full path in config.json →  "claudeBin": "C:\\\\path\\\\to\\\\claude.cmd"\n');
}

async function main() {
    const cfg = loadConfig();
    const args = parseArgs(process.argv);

    // --pair: onboard this machine, then start polling with the saved config.
    if (args.pair) {
        await pairAndSaveConfig(args.url || cfg.url, args.pair);
        const fresh = loadConfig();
        preflight(fresh);
        await pollLoop(fresh, args.interval || 5000);
        return;
    }

    if (!cfg.url || !cfg.pat || !cfg.companyId) {
        throw new Error('Not configured. Run the pair command from AlianHub → Development tab → "Connect this computer" (or set ALIANHUB_URL / ALIANHUB_PAT / ALIANHUB_COMPANY_ID).');
    }
    preflight(cfg);

    if (args.poll) { await pollLoop(cfg, args.interval || 5000); return; }

    // One-shot (testing): develop a task once from the CLI.
    if (!args.task) {
        throw new Error('Usage: node dev-agent.js --poll   OR   --task <id> [--repo <path> | --git <url>] [--base <branch>]');
    }
    const task = await fetchTask(cfg, args.task);
    const taskKey = task.TaskKey || args.task;
    const projectCode = taskKey.includes('-') ? taskKey.split('-')[0] : '';
    const { dir, base, pushable } = resolveWorkdir(cfg, String(task.ProjectID || ''), projectCode, args);
    const { prUrl, note } = await developTurn(cfg, {
        dir, base, pushable, taskKey, taskName: task.TaskName || '(untitled task)',
        description: task.description || task.rawDescription || '',
        instruction: task.description || task.rawDescription || 'Implement this task.',
    });
    console.log(`\n${prUrl ? `🔗  PR: ${prUrl}` : `ℹ️  ${note}`}\n`);
}

main().catch((e) => { console.error(`\n❌  dev-agent failed: ${e.message}\n`); process.exit(1); });
