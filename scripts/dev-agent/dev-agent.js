#!/usr/bin/env node
/*
 * AlianHub AI dev-agent — runner (lean MVP).
 *
 * Drives Claude Code to implement ONE AlianHub task end-to-end and open a PR:
 *   fetch task → branch → `claude -p` in the repo → commit → push → PR →
 *   comment the PR link back on the task.
 *
 * The "agent" is just this script + Claude Code (the actual developer). It uses
 * AlianHub's existing REST APIs (get-task + comments) authenticated with a
 * Personal API Token (PAT) — no special backend required.
 *
 * Runs on YOUR machine (where Claude Code + git + gh live), not the server.
 *
 * Usage:
 *   node dev-agent.js --task <taskId> --repo <path-to-local-clone> [--base <branch>]
 *
 * Config (env vars, or a config.json next to this file):
 *   ALIANHUB_URL         e.g. http://localhost:4000  (or your staging/prod URL)
 *   ALIANHUB_PAT         a Personal API Token (ahp_…) with write scope
 *   ALIANHUB_COMPANY_ID  the company id (24-hex)
 *   ALIANHUB_USER_ID     (optional) user id to attribute the PR comment to
 *
 * Prereqs on this machine: Node 18+, the `claude` CLI (logged in), `git`, `gh` (authed).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── config ────────────────────────────────────────────────────────────────
function loadConfig() {
    const cfgPath = path.join(__dirname, 'config.json');
    const file = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    return {
        url: String(process.env.ALIANHUB_URL || file.url || '').replace(/\/+$/, ''),
        pat: process.env.ALIANHUB_PAT || file.pat || '',
        companyId: process.env.ALIANHUB_COMPANY_ID || file.companyId || '',
        userId: process.env.ALIANHUB_USER_ID || file.userId || '',
    };
}

function parseArgs(argv) {
    const a = {};
    for (let i = 2; i < argv.length; i += 1) {
        const k = argv[i];
        if (k === '--task') a.task = argv[++i];
        else if (k === '--repo') a.repo = argv[++i];
        else if (k === '--base') a.base = argv[++i];
    }
    return a;
}

// ── shell helper (arg arrays → no cross-platform quoting issues) ────────────
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

// ── AlianHub REST (PAT auth) ────────────────────────────────────────────────
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

async function main() {
    const cfg = loadConfig();
    const args = parseArgs(process.argv);
    if (!cfg.url || !cfg.pat || !cfg.companyId) {
        throw new Error('Missing config — set ALIANHUB_URL, ALIANHUB_PAT and ALIANHUB_COMPANY_ID (env or config.json).');
    }
    if (!args.task || !args.repo) {
        throw new Error('Usage: node dev-agent.js --task <taskId> --repo <path> [--base <branch>]');
    }
    const repo = path.resolve(args.repo);
    if (!fs.existsSync(path.join(repo, '.git'))) throw new Error(`Not a git repository: ${repo}`);

    // 1. Fetch the task (the spec Claude Code will implement).
    console.log(`\n📥  Fetching task ${args.task} …`);
    const taskRes = await api(cfg, 'GET', `/api/v1/task/${args.task}`);
    const task = (taskRes && taskRes.data) || taskRes || {};
    const taskKey = task.TaskKey || args.task;
    const taskName = task.TaskName || '(untitled task)';
    const description = task.description || task.rawDescription || '';
    const projectId = String(task.ProjectID || '');
    const sprintId = task.sprintId ? String(task.sprintId) : '';
    console.log(`    ${taskKey} — ${taskName}`);

    // 2. Fresh branch off the base.
    const base = args.base || 'main';
    const branch = `ai/${slug(taskKey)}`;
    console.log(`\n🌿  ${repo}\n    base "${base}" → branch "${branch}"`);
    run('git', ['fetch', 'origin'], repo);
    run('git', ['checkout', base], repo);
    run('git', ['pull', '--ff-only', 'origin', base], repo, { allowFail: true });
    run('git', ['checkout', '-B', branch], repo);

    // 3. Hand the task to Claude Code (the actual developer). It edits files;
    //    the runner owns git so the commit/PR are consistent.
    const prompt = [
        'Implement the following task in this repository.',
        '',
        `Task ${taskKey}: ${taskName}`,
        description ? `\nDescription / acceptance criteria:\n${description}` : '',
        '',
        'Follow the existing code conventions, keep the change focused on this task,',
        'and run any relevant tests or build. Do NOT commit or push — the runner does that.',
    ].join('\n');
    console.log('\n🤖  Running Claude Code (headless) …\n');
    run('claude', ['-p', prompt, '--permission-mode', 'acceptEdits'], repo);

    // 4. Commit whatever changed (in case Claude didn't commit itself).
    const dirty = run('git', ['status', '--porcelain'], repo, { capture: true });
    if (dirty) {
        run('git', ['add', '-A'], repo);
        run('git', ['commit', '-m', `feat(${taskKey}): ${taskName}\n\nImplemented by the AlianHub AI dev-agent (Claude Code).`], repo);
    }
    const ahead = run('git', ['rev-list', '--count', `origin/${base}..HEAD`], repo, { capture: true, allowFail: true });
    if (!ahead || ahead === '0') {
        console.log('\n⚠️  Claude Code produced no committed changes — nothing to open a PR for. Stopping.');
        process.exit(1);
    }

    // 5. Push + open the PR.
    run('git', ['push', '-u', 'origin', branch], repo);
    const prBody = [
        `Implements **${taskKey} — ${taskName}** via the AlianHub AI dev-agent (Claude Code).`,
        description ? `\n${description}` : '',
        '\n_Please review before merging._',
    ].join('\n');
    const prUrl = run('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', `${taskKey}: ${taskName}`, '--body', prBody], repo, { capture: true });
    console.log(`\n🔗  PR: ${prUrl}`);

    // 6. Report the PR link back on the task (best-effort).
    if (projectId && sprintId) {
        try {
            await api(cfg, 'POST', '/api/v1/comments', {
                data: {
                    objId: { projectId, taskId: String(args.task), sprintId, folderId: task.folderObjId ? String(task.folderObjId) : '' },
                    projectId, taskId: String(args.task), sprintId,
                    userId: cfg.userId, project: false, type: 'text',
                    message: `🤖 AI dev-agent opened a PR for this task: ${prUrl}`,
                    mediaURL: '', mediaName: '', mediaOriginalName: '', mediaSize: 0,
                    hasReply: false, mentionIds: [],
                    reply_id: '', reply_userId: '', reply_message: '', reply_type: '', reply_mediaURL: '', reply_mediaName: '', reply_mediaSize: 0,
                },
            });
            console.log(`💬  Posted PR link to ${taskKey}.`);
        } catch (e) {
            console.log(`💬  (couldn't post the PR comment: ${e.message})`);
        }
    }

    console.log(`\n✅  Done — ${taskKey} implemented, PR opened.\n`);
}

main().catch((e) => { console.error(`\n❌  dev-agent failed: ${e.message}\n`); process.exit(1); });
