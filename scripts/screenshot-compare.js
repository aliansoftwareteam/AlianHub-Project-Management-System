const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { parseArgs: rawArgs } = require('./demo/lib/cli');
const { timestamp } = require('./atlas/naming');
const { pairShots, diffPixels, orderByChange } = require('./atlas/compare');
const { compareHtml } = require('./atlas/gallery');

const ROOT = path.resolve(__dirname, '..');
const USAGE = 'Usage: npm run atlas:compare -- <before folder> <after folder> [--out <folder>] [--threshold <0-255>]';

async function readImage(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
}

const writeImage = (file, { width, height, data }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(file);

function folders(argv) {
    const positional = [];
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i].startsWith('--')) {
            if (!argv[i].includes('=')) i += 1;
        } else positional.push(argv[i]);
    }
    if (positional.length !== 2) throw new Error(USAGE);
    for (const dir of positional) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder.\n${USAGE}`);
    }
    return positional.map((dir) => path.resolve(dir));
}

async function main() {
    const argv = process.argv.slice(2);
    const [beforeDir, afterDir] = folders(argv);
    const options = rawArgs(argv);
    const threshold = options.threshold === undefined ? undefined : Number(options.threshold);
    if (threshold !== undefined && !(threshold >= 0 && threshold <= 255)) throw new Error(USAGE);
    const outDir = path.resolve(typeof options.out === 'string' ? options.out : path.join(ROOT, 'artifacts', 'atlas', `compare-${timestamp()}`));

    for (const sub of ['before', 'after', 'diff']) fs.mkdirSync(path.join(outDir, sub), { recursive: true });

    const rows = [];
    for (const pair of pairShots(fs.readdirSync(beforeDir), fs.readdirSync(afterDir))) {
        if (pair.status !== 'added') fs.copyFileSync(path.join(beforeDir, pair.file), path.join(outDir, 'before', pair.file));
        if (pair.status !== 'removed') fs.copyFileSync(path.join(afterDir, pair.file), path.join(outDir, 'after', pair.file));
        if (pair.status !== 'both') {
            rows.push({ ...pair, changed: null, total: null, ratio: 1 });
            continue;
        }
        const diff = diffPixels(await readImage(path.join(beforeDir, pair.file)), await readImage(path.join(afterDir, pair.file)), { threshold });
        await writeImage(path.join(outDir, 'diff', pair.file), diff);
        rows.push({ ...pair, changed: diff.changed, total: diff.total, ratio: diff.ratio });
    }

    const ordered = orderByChange(rows);
    const meta = { before: beforeDir, after: afterDir, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(outDir, 'compare.json'), `${JSON.stringify({ ...meta, rows: ordered }, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'index.html'), compareHtml({ rows: ordered, meta: [`before: ${beforeDir}`, `after: ${afterDir}`] }));

    const changed = ordered.filter((row) => row.status === 'both' && row.changed > 0);
    const missing = ordered.filter((row) => row.status !== 'both');
    process.stdout.write(`${changed.length} changed, ${missing.length} added or removed, ${ordered.length - changed.length - missing.length} unchanged.\n`);
    for (const row of changed.slice(0, 15)) process.stdout.write(`  ${`${(row.ratio * 100).toFixed(2)}%`.padStart(7)}  ${row.file}\n`);
    process.stdout.write(`${path.join(outDir, 'index.html')}\n`);
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((error) => {
        process.stderr.write(`\n${(error && error.message) || error}\n\n`);
        process.exit(1);
    });
}
