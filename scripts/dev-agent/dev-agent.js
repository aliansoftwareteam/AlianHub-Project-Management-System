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

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── AlianHub REST (PAT auth) ──────────────────────────────────────────────
async function api(cfg, method, endpoint, body) {
    const res = await fetch(`${cfg.url}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${cfg.pat}`,
            companyid: cfg.companyId,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
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
    throw new Error('No repository or folder given. In the Development tab, enter a git URL or a local folder path.');
}

async function fetchTask(cfg, taskId) {
    const res = await api(cfg, 'GET', `/api/v1/task/${taskId}`);
    return (res && res.data) || res || {};
}

function buildPrompt(taskKey, taskName, description, instruction, pushable) {
    return [
        `You are developing AlianHub task ${taskKey}: ${taskName}.`,
        description ? `\nTask description / acceptance criteria:\n${description}` : '',
        `\nThe user's instruction for this turn:\n${instruction}`,
        '',
        pushable
            ? 'Implement it in this repository following the existing code conventions. Keep the change focused. Run relevant tests or a build if quick. Do NOT commit or push — the runner handles git.'
            : 'This is a local working folder (it may be empty). Build what is asked directly here — create/scaffold whatever files are needed. Run relevant setup/tests if quick. Do NOT worry about git; the developer will test locally.',
    ].join('\n');
}

// Develop ONE turn. If the target is pushable (has a git remote), work on the
// task branch and open/update a PR. Otherwise just build in the folder and let
// the developer test locally. Returns { prUrl, note }.
async function developTurn(cfg, { dir, base, pushable, taskKey, taskName, description, instruction }) {
    const prompt = buildPrompt(taskKey, taskName, description, instruction, pushable);

    if (pushable) {
        const branch = `ai/${slug(taskKey)}`;
        console.log(`\n🌿  ${dir}\n    ${taskKey} → branch "${branch}" (base "${base}")`);
        run('git', ['fetch', 'origin'], dir, { allowFail: true });
        const remoteBranch = run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], dir, { capture: true, allowFail: true });
        if (remoteBranch) {
            run('git', ['checkout', '-B', branch, `origin/${branch}`], dir); // continue prior work
        } else {
            run('git', ['checkout', base], dir);
            run('git', ['pull', '--ff-only', 'origin', base], dir, { allowFail: true });
            run('git', ['checkout', '-B', branch], dir);                     // fresh
        }

        console.log('\n🤖  Claude Code …\n');
        run(cfg.claudeBin, ['-p', '--dangerously-skip-permissions'], dir, { input: prompt });

        if (run('git', ['status', '--porcelain'], dir, { capture: true })) {
            run('git', ['add', '-A'], dir);
            run('git', ['commit', '-m', `${taskKey}: ${String(instruction).slice(0, 60)}\n\nvia AlianHub AI dev-agent (Claude Code)`], dir);
        }
        const ahead = run('git', ['rev-list', '--count', `origin/${base}..HEAD`], dir, { capture: true, allowFail: true });
        if (!ahead || ahead === '0') return { prUrl: '', note: 'No code changes were needed.' };

        run('git', ['push', '-u', 'origin', branch], dir);
        let prUrl = run('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], dir, { capture: true, allowFail: true });
        if (!prUrl) {
            prUrl = run('gh', ['pr', 'create', '--base', base, '--head', branch,
                '--title', `${taskKey}: ${taskName}`,
                '--body', `Implements **${taskKey} — ${taskName}** via the AlianHub AI dev-agent (Claude Code).\n\n_Please review before merging._`],
            dir, { capture: true });
        }
        return { prUrl, note: '' };
    }

    // Local folder — no remote. Build freely; the developer tests locally.
    console.log(`\n🤖  Claude Code (local folder — building in place) …\n`);
    run(cfg.claudeBin, ['-p', '--dangerously-skip-permissions'], dir, { input: prompt });

    // Best-effort snapshot if it's already a git repo (so the change is tracked).
    let committed = false;
    if (fs.existsSync(path.join(dir, '.git')) && run('git', ['status', '--porcelain'], dir, { capture: true, allowFail: true })) {
        run('git', ['add', '-A'], dir, { allowFail: true });
        run('git', ['commit', '-m', `${taskKey}: ${String(instruction).slice(0, 60)}`], dir, { allowFail: true });
        committed = true;
    }
    return { prUrl: '', note: `Work is ready in ${dir} — open & test it locally${committed ? ' (committed to your local repo)' : ''}. Point me at a git URL or add a remote when you want a PR.` };
}

// ── poll mode: watch Development chats and develop each new instruction ────
async function reply(cfg, msg, { status, text, prUrl }) {
    try {
        await api(cfg, 'POST', '/api/v2/dev-agent/reply', {
            taskId: msg.taskId, projectId: msg.projectId, sprintId: msg.sprintId,
            parentId: msg._id, status, text, prUrl: prUrl || '',
        });
    } catch (e) { console.error(`  reply failed: ${e.message}`); }
}

async function handleMessage(cfg, msg) {
    console.log(`\n▶  task ${msg.taskId}: "${String(msg.text).slice(0, 70)}"`);
    await reply(cfg, msg, { status: 'working', text: '⚙️ Working on it…' });
    try {
        const task = await fetchTask(cfg, msg.taskId);
        const taskKey = task.TaskKey || msg.taskId;
        const projectCode = taskKey.includes('-') ? taskKey.split('-')[0] : '';
        const { dir, base, pushable } = resolveWorkdir(cfg, String(task.ProjectID || ''), projectCode, repoArgsFromLocation(msg.repo, msg.base));
        const { prUrl, note } = await developTurn(cfg, {
            dir, base, pushable, taskKey, taskName: task.TaskName || '(untitled task)',
            description: task.description || task.rawDescription || '', instruction: msg.text,
        });
        const text = prUrl ? `✅ Done. PR: ${prUrl}` : `✅ ${note || 'Done.'}`;
        await reply(cfg, msg, { status: 'done', text, prUrl });
        console.log(`  ✓ ${prUrl || note}`);
    } catch (e) {
        await reply(cfg, msg, { status: 'error', text: `⚠️ ${e.message}` });
        console.error(`  ✗ ${e.message}`);
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
    if (!cfg.url || !cfg.pat || !cfg.companyId) {
        throw new Error('Missing config — set ALIANHUB_URL, ALIANHUB_PAT and ALIANHUB_COMPANY_ID (env or config.json).');
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
