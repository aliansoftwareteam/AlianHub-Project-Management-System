#!/usr/bin/env node
/*
 * AlianHub AI dev-agent — runner.
 *
 * The bridge between a task's "Development" chat in AlianHub and Claude Code on
 * your machine. The user chats instructions in the task's Development tab; this
 * runner (poll mode) picks them up, develops with Claude Code, and replies in
 * the same chat with the PR — then iterates on follow-up messages.
 *
 *   poll pending chat → resolve repo → branch → `claude -p` → commit → push →
 *   open (or update) the PR → reply in the chat
 *
 * The "agent" is just this script + Claude Code (the actual developer). It talks
 * to AlianHub over its REST API with a Personal API Token — nothing special on
 * the server. Runs on YOUR machine (where Claude Code, git and gh live).
 *
 * Modes:
 *   node dev-agent.js --poll [--interval <ms>]        watch the Development chats (recommended)
 *   node dev-agent.js --task <id> [--repo|--git] [--base]   one-shot, for testing
 *
 * Repo comes from the chat message (a git URL → cloned into the workspace, or a
 * local path → used as-is). One-shot takes it from --repo/--git or config.json.
 *
 * Config (env, or config.json next to this file):
 *   ALIANHUB_URL, ALIANHUB_PAT, ALIANHUB_COMPANY_ID, ALIANHUB_USER_ID (optional),
 *   ALIANHUB_WORKSPACE (where URL clones go; default ./workspace),
 *   and an optional "repos" map: { "<projectId|projectCode>": { gitUrl?, localPath?, base? } }
 *
 * Prereqs on this machine: Node 18+, the `claude` CLI (logged in), `git`, `gh` (authed).
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

// ── shell helper (arg arrays → no cross-platform quoting issues) ──────────
function run(cmd, cmdArgs, cwd, { capture = false, allowFail = false } = {}) {
    const r = spawnSync(cmd, cmdArgs, {
        cwd,
        stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8',
        shell: false,
    });
    if (r.error) { if (allowFail) return ''; throw new Error(`${cmd}: ${r.error.message}`); }
    if (r.status !== 0 && !allowFail) {
        throw new Error(`\`${cmd} ${cmdArgs.join(' ')}\` failed (exit ${r.status})${r.stderr ? `\n${r.stderr}` : ''}`);
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

// A repo location string ("https://…" or a local path) → resolveRepo() args.
function repoArgsFromLocation(location, base) {
    const loc = String(location || '').trim();
    return { repo: isGitUrl(loc) ? '' : loc, git: isGitUrl(loc) ? loc : '', base };
}

// Resolve the working repo: an existing local clone (localPath), else a git URL
// cloned into the workspace (reused + pulled next time). Sources, in priority:
// CLI/message args → config.repos[projectId|projectCode].
function resolveRepo(cfg, projectId, projectCode, args) {
    const perProject = cfg.repos[projectId] || cfg.repos[projectCode] || {};
    const localPath = args.repo || perProject.localPath || '';
    const gitUrl = args.git || perProject.gitUrl || '';
    const base = args.base || perProject.base || 'main';

    if (localPath) {
        const p = path.resolve(localPath);
        if (fs.existsSync(path.join(p, '.git'))) { console.log(`📁  Local clone: ${p}`); return { repo: p, base }; }
        if (!gitUrl) throw new Error(`localPath "${p}" is not a git repo, and no git URL was given.`);
    }
    if (gitUrl) {
        const name = slug((gitUrl.split('/').pop() || 'repo').replace(/\.git$/i, ''));
        const dest = path.join(cfg.workspace, name);
        if (fs.existsSync(path.join(dest, '.git'))) {
            console.log(`📁  Workspace clone: ${dest}`);
        } else {
            fs.mkdirSync(cfg.workspace, { recursive: true });
            console.log(`📥  Cloning ${gitUrl} → ${dest} …`);
            run('git', ['clone', gitUrl, dest], cfg.workspace);
        }
        return { repo: dest, base };
    }
    throw new Error('No repository given. Set one in the task\'s Development tab (git URL or local path).');
}

async function fetchTask(cfg, taskId) {
    const res = await api(cfg, 'GET', `/api/v1/task/${taskId}`);
    return (res && res.data) || res || {};
}

function buildPrompt(taskKey, taskName, description, instruction) {
    return [
        `You are developing AlianHub task ${taskKey}: ${taskName}.`,
        description ? `\nTask description / acceptance criteria:\n${description}` : '',
        `\nThe user's instruction for this turn:\n${instruction}`,
        '',
        'Implement it in this repository following the existing code conventions.',
        'Keep the change focused on this instruction. Run relevant tests or a build if quick.',
        'Do NOT commit or push — the runner handles git.',
    ].join('\n');
}

// Develop ONE turn on the task's branch: continue the branch if it already
// exists (so follow-up messages iterate on the same PR), else branch fresh off
// the base. Returns { prUrl, note }.
async function developTurn(cfg, { repo, base, taskKey, taskName, description, instruction }) {
    const branch = `ai/${slug(taskKey)}`;
    console.log(`\n🌿  ${repo}\n    ${taskKey} → branch "${branch}" (base "${base}")`);
    run('git', ['fetch', 'origin'], repo, { allowFail: true });
    const remote = run('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], repo, { capture: true, allowFail: true });
    if (remote) {
        run('git', ['checkout', '-B', branch, `origin/${branch}`], repo); // continue prior work
    } else {
        run('git', ['checkout', base], repo);
        run('git', ['pull', '--ff-only', 'origin', base], repo, { allowFail: true });
        run('git', ['checkout', '-B', branch], repo);                     // fresh
    }

    const before = run('git', ['rev-parse', 'HEAD'], repo, { capture: true, allowFail: true });
    console.log('\n🤖  Claude Code …\n');
    run('claude', ['-p', buildPrompt(taskKey, taskName, description, instruction), '--permission-mode', 'acceptEdits'], repo);

    if (run('git', ['status', '--porcelain'], repo, { capture: true })) {
        run('git', ['add', '-A'], repo);
        run('git', ['commit', '-m', `${taskKey}: ${String(instruction).slice(0, 60)}\n\nvia AlianHub AI dev-agent (Claude Code)`], repo);
    }
    const after = run('git', ['rev-parse', 'HEAD'], repo, { capture: true, allowFail: true });
    const newCommit = before && after && before !== after;

    const ahead = run('git', ['rev-list', '--count', `origin/${base}..HEAD`], repo, { capture: true, allowFail: true });
    if (!ahead || ahead === '0') return { prUrl: '', note: 'No code changes were needed.' };

    run('git', ['push', '-u', 'origin', branch], repo);
    let prUrl = run('gh', ['pr', 'view', branch, '--json', 'url', '-q', '.url'], repo, { capture: true, allowFail: true });
    if (!prUrl) {
        prUrl = run('gh', ['pr', 'create', '--base', base, '--head', branch,
            '--title', `${taskKey}: ${taskName}`,
            '--body', `Implements **${taskKey} — ${taskName}** via the AlianHub AI dev-agent (Claude Code).\n\n_Please review before merging._`],
        repo, { capture: true });
    }
    return { prUrl, note: newCommit ? '' : 'No new changes this turn.' };
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
        const { repo, base } = resolveRepo(cfg, String(task.ProjectID || ''), projectCode, repoArgsFromLocation(msg.repo, msg.base));
        const { prUrl, note } = await developTurn(cfg, {
            repo, base, taskKey, taskName: task.TaskName || '(untitled task)',
            description: task.description || task.rawDescription || '', instruction: msg.text,
        });
        const text = prUrl ? `✅ Done. PR: ${prUrl}${note ? ` (${note})` : ''}` : `✅ ${note || 'Done.'}`;
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

async function main() {
    const cfg = loadConfig();
    const args = parseArgs(process.argv);
    if (!cfg.url || !cfg.pat || !cfg.companyId) {
        throw new Error('Missing config — set ALIANHUB_URL, ALIANHUB_PAT and ALIANHUB_COMPANY_ID (env or config.json).');
    }

    if (args.poll) { await pollLoop(cfg, args.interval || 5000); return; }

    // One-shot (testing): develop a task once from the CLI.
    if (!args.task) {
        throw new Error('Usage: node dev-agent.js --poll   OR   --task <id> [--repo <path> | --git <url>] [--base <branch>]');
    }
    const task = await fetchTask(cfg, args.task);
    const taskKey = task.TaskKey || args.task;
    const projectCode = taskKey.includes('-') ? taskKey.split('-')[0] : '';
    const { repo, base } = resolveRepo(cfg, String(task.ProjectID || ''), projectCode, args);
    const { prUrl, note } = await developTurn(cfg, {
        repo, base, taskKey, taskName: task.TaskName || '(untitled task)',
        description: task.description || task.rawDescription || '',
        instruction: task.description || task.rawDescription || 'Implement this task.',
    });
    console.log(`\n${prUrl ? `🔗  PR: ${prUrl}` : `ℹ️  ${note}`}\n`);
}

main().catch((e) => { console.error(`\n❌  dev-agent failed: ${e.message}\n`); process.exit(1); });
