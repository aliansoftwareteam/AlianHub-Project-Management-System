const fs = require('fs');
const { spawnSync } = require('child_process');
const { ROOT, PROPOSED_DIR, baselineDir, mayRun } = require('./settings');
const { summarise } = require('./report');

const REFUSAL = [
    'The screenshot check runs in CI: a screenshot made on this machine never matches the Linux baseline.',
    'To accept an intended change, take the shots a CI run proposed: npm run visual:accept -- <run id>',
    'To try the check itself here, against a baseline kept outside the repository: VISUAL_LOCAL=1 npm run visual',
].join('\n');

function plan(argv, env = process.env) {
    if (!mayRun(env)) return { refuse: REFUSAL };
    return {
        args: ['test', '--config', 'e2e/visual.config.js', ...argv.filter((arg) => arg !== '--update')],
        env: argv.includes('--update') ? { VISUAL_UPDATE: '1' } : {},
    };
}

const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

function main() {
    const planned = plan(process.argv.slice(2));
    if (planned.refuse) {
        process.stderr.write(`\n${planned.refuse}\n\n`);
        return 1;
    }
    fs.rmSync(PROPOSED_DIR, { recursive: true, force: true });
    const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), ...planned.args], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...planned.env },
    });
    const { text } = summarise({
        proposed: filesIn(PROPOSED_DIR),
        baseline: filesIn(baselineDir()),
        runId: process.env.GITHUB_RUN_ID || null,
        local: Boolean(process.env.VISUAL_LOCAL),
        failed: run.status !== 0,
    });
    process.stdout.write(`\n${text}\n\n`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text}\n\`\`\`\n`);
    return run.status === null ? 1 : run.status;
}

if (require.main === module) process.exit(main());

module.exports = { plan };
