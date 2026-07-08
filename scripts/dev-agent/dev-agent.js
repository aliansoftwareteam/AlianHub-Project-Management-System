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
function run(cmd, cmdArgs, cwd, { capture = false, allowFail = false, input } = {}) {
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
            child.kill('SIGKILL');
        }
    } catch (e) { try { child.kill(); } catch (_) { /* ignore */ } }
}

// Run Claude Code headless with streaming JSON events so we can surface a live
// activity feed. Resolves on success, rejects on non-zero exit. `onEvent` gets
// each parsed stream-json event (system / assistant / tool_use / result).
function runClaude(cfg, dir, prompt, onEvent, cancel) {
    const TIMEOUT_MS = 30 * 60 * 1000; // watchdog: a hung Claude must not wedge the poller forever
    return new Promise((resolve, reject) => {
        const { exe, viaCmd } = resolveExe(cfg.claudeBin);
        const file = viaCmd ? (process.env.ComSpec || 'cmd.exe') : exe;
        const claudeArgs = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
        const child = spawn(file, viaCmd ? ['/d', '/c', exe, ...claudeArgs] : claudeArgs, { cwd: dir, shell: false, windowsHide: true });
        if (cancel) cancel.child = child; // expose the child so an emergency Stop can kill it mid-run (Point 3)
        let stderr = ''; let buf = ''; let settled = false;
        const finish = (err) => {
            if (settled) return; settled = true; clearTimeout(timer);
            if (cancel) cancel.child = null;
            if (cancel && cancel.requested) return reject(new Error('__CANCELLED__')); // Stop won the race
            if (err) reject(err); else resolve();
        };
        const timer = setTimeout(() => { try { killTree(child); } catch (e) { /* ignore */ } finish(new Error(`claude timed out after ${TIMEOUT_MS / 60000} min`)); }, TIMEOUT_MS);
        child.stdout.on('data', (chunk) => {
            buf += chunk.toString();
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
                if (line) { try { onEvent(JSON.parse(line)); } catch (e) { /* non-JSON line */ } }
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
        const name = slug((gitUrl.split('/').pop() || 'repo').replace(/\.git$/i, ''));
        const dir = path.join(cfg.workspace, name);
        if (fs.existsSync(path.join(dir, '.git'))) {
            console.log(`📁  Workspace clone: ${dir}`);
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

function buildPrompt(taskKey, taskName, description, instruction, pushable, contextPath, contextText) {
    return [
        `You are developing AlianHub task ${taskKey}: ${taskName}.`,
        description ? `\nTask description / acceptance criteria:\n${description}` : '',
        contextText ? `\nPrior development context for this task (from ${contextPath}, written on earlier turns — possibly by other developers on other machines). Read it and continue from where it left off; do NOT redo work already done:\n${contextText}` : '',
        `\nThe user's instruction for this turn:\n${instruction}`,
        '',
        pushable
            ? 'Implement it in this repository following the existing code conventions. Keep the change focused. Run relevant tests or a build if quick. Do NOT commit or push — the runner handles git.'
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
async function developTurn(cfg, { dir, base, pushable, taskKey, taskName, description, instruction, onProgress, cancel }) {
    ensureTrusted(dir);
    const ctxPath = contextRel(taskKey);
    const onEvent = (ev) => { const line = activityLine(ev); if (!line) return; if (onProgress) onProgress(line); else console.log(`   ${line}`); };

    if (pushable) {
        const branch = `ai/${slug(taskKey)}`;
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

        const prompt = buildPrompt(taskKey, taskName, description, instruction, pushable, ctxPath, readContext(dir, taskKey));
        console.log('\n🤖  Claude Code …\n');
        await runClaude(cfg, dir, prompt, onEvent, cancel);

        if (run('git', ['status', '--porcelain'], dir, { capture: true })) {
            run('git', ['add', '-A'], dir);
            run('git', ['commit', '-m', `${taskKey}: ${String(instruction).slice(0, 60)}\n\nvia AlianHub AI dev-agent (Claude Code)`], dir);
        }
        const ahead = run('git', ['rev-list', '--count', `origin/${base}..HEAD`], dir, { capture: true, allowFail: true });
        if (!ahead || ahead === '0') return { prUrl: '', note: 'No code changes were needed.' };

        // PR gate (Point 2): push the branch (so it's ready to review, and a manual PR
        // works too) but DON'T open the PR yet — hand back `pushed` so the caller can ask
        // for approval. openPr (a 'pending_pr' job) opens the PR once the user approves.
        run('git', ['push', '-u', 'origin', branch], dir);
        return { prUrl: '', pushed: true, branch, note: '' };
    }

    // Local folder — no remote. Build freely; the developer tests locally.
    const prompt = buildPrompt(taskKey, taskName, description, instruction, pushable, ctxPath, readContext(dir, taskKey));
    console.log(`\n🤖  Claude Code (local folder — building in place) …\n`);
    await runClaude(cfg, dir, prompt, onEvent, cancel);

    // Best-effort snapshot if it's already a git repo (so the change is tracked).
    let committed = false;
    if (fs.existsSync(path.join(dir, '.git')) && run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
        run('git', ['add', '-A'], dir, { allowFail: true });
        run('git', ['commit', '-m', `${taskKey}: ${String(instruction).slice(0, 60)}`], dir, { allowFail: true });
        committed = true;
    }
    return { prUrl: '', note: `Work is ready in ${dir} — open & test it locally${committed ? ' (committed to your local repo)' : ''}. Point me at a git URL or add a remote when you want a PR.` };
}

// Open (or return an existing) PR for a task's already-developed branch. Used by the
// PR-approval step (Point 2) — no Claude run, just a defensive push + gh pr create.
function openPr(cfg, dir, base, taskKey, taskName) {
    const branch = `ai/${slug(taskKey)}`;
    run('git', ['fetch', 'origin'], dir, { allowFail: true });
    if (!run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], dir, { capture: true, allowFail: true })) {
        // Branch not on the remote yet — push the local one if it exists.
        if (run('git', ['rev-parse', '--verify', '--quiet', branch], dir, { capture: true, allowFail: true })) {
            run('git', ['push', '-u', 'origin', branch], dir, { allowFail: true });
        }
    }
    let prUrl = run('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], dir, { capture: true, allowFail: true });
    if (!prUrl) {
        prUrl = run('gh', ['pr', 'create', '--base', base, '--head', branch,
            '--title', `${taskKey}: ${taskName}`,
            '--body', `Implements **${taskKey} — ${taskName}** via the AlianHub AI dev-agent (Claude Code).\n\n_Please review before merging._`],
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
    try {
        const task = await fetchTask(cfg, msg.taskId);
        const taskKey = task.TaskKey || msg.taskId;
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
        onProgress(`📁 ${pushable ? 'repository' : 'local folder'}: ${dir}`); // immediate first update so the tab changes right away
        if (msg.status === 'pending_pr') {
            // PR-approval step (Point 2): the code is already developed + pushed — just
            // open the pull request for its branch. No Claude run.
            onProgress('🔀 Opening the pull request…');
            const prUrl = pushable ? openPr(cfg, dir, base, taskKey, task.TaskName || '(untitled task)') : '';
            const text = prUrl
                ? `✅ PR opened: ${prUrl}`
                : (pushable ? '⚠️ Could not open the PR — check that the branch was pushed.' : 'This is a local folder — there is no remote to open a PR against.');
            await reply(cfg, msg, { status: 'done', text, prUrl });
            console.log(`  ✓ PR: ${prUrl}`);
        } else {
            const { prUrl, note, pushed, branch } = await developTurn(cfg, {
                dir, base, pushable, taskKey, taskName: task.TaskName || '(untitled task)',
                description: task.description || task.rawDescription || '', instruction: msg.text, onProgress, cancel,
            });
            if (pushable && pushed && !prUrl) {
                // PR gate (Point 2): developed + pushed — wait for approval to open the PR.
                await reply(cfg, msg, { status: 'awaiting_pr', text: `✅ Developed & pushed \`${branch}\`. Review it, then click **Create PR** to open the pull request — or open it yourself on GitHub.` });
                console.log(`  ⏸ awaiting PR approval (${branch})`);
            } else {
                const text = prUrl ? `✅ Done. PR: ${prUrl}` : `✅ ${note || 'Done.'}`;
                await reply(cfg, msg, { status: 'done', text, prUrl });
                console.log(`  ✓ ${prUrl || note}`);
            }
        }
    } catch (e) {
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

async function pollLoop(cfg, intervalMs) {
    console.log(`\n👀  Polling ${cfg.url} every ${Math.round(intervalMs / 1000)}s for Development-chat instructions… (Ctrl+C to stop)`);
    for (;;) {
        try {
            const res = await api(cfg, 'GET', '/api/v2/dev-agent/pending');
            const pending = (res && res.data) || [];
            for (const msg of pending) {
                // eslint-disable-next-line no-await-in-loop
                await handleMessage(cfg, msg);
            }
        } catch (e) {
            console.error(`poll error: ${e.message}`);
        }
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
