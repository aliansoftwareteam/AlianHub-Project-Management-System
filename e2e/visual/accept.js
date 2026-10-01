const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { coreShots } = require('../../scripts/atlas/core');
const { ROOT, BASELINE_DIR, LOCAL_BASELINE_DIR, PROPOSED_DIR, ARTIFACT } = require('./settings');

const USAGE = [
    'Usage: npm run visual:accept -- <run id>',
    'The run id is the number in the address of the Visual workflow run whose screenshots you accept (also printed in its summary).',
    'It needs the GitHub CLI, signed in: gh auth status',
].join('\n');

const relative = (dir) => path.relative(ROOT, dir).split(path.sep).join('/');

function acceptPlan(argv, env = process.env) {
    const [runId] = argv.filter((arg) => !arg.startsWith('--'));
    if (runId === undefined) {
        if (!env.VISUAL_LOCAL) throw new Error(USAGE);
        return { runId: null, into: relative(LOCAL_BASELINE_DIR) };
    }
    if (!/^\d+$/.test(runId)) throw new Error(`"${runId}" is not a run id.\n${USAGE}`);
    return { runId, into: relative(BASELINE_DIR) };
}

function download(runId) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alianhub-visual-'));
    execFileSync('gh', ['run', 'download', runId, '--name', ARTIFACT, '--dir', scratch], { cwd: ROOT, stdio: 'inherit' });
    return scratch;
}

function main() {
    const { runId, into } = acceptPlan(process.argv.slice(2));
    const source = runId ? download(runId) : PROPOSED_DIR;
    const known = new Set(coreShots().map((shot) => shot.file));
    const files = fs.existsSync(source) ? fs.readdirSync(source).filter((file) => known.has(file)) : [];
    if (!files.length) throw new Error('Nothing to accept: that run proposed no screenshot.');

    const target = path.join(ROOT, into);
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
    if (runId) fs.rmSync(source, { recursive: true, force: true });

    process.stdout.write(`${files.map((file) => `  ${file}`).join('\n')}\n\n${files.length} screenshots written to ${into}. Look at them, then commit that folder.\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`\n${error.message}\n\n`);
        process.exit(1);
    }
}

module.exports = { acceptPlan };
