const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { shellAssetsOf, WORKER_PATH } = require('./src/serviceWorker/rules');

const PLUGIN = 'ShellWorkerPlugin';
const SOURCE_DIR = path.join(__dirname, 'src', 'serviceWorker');
const SOURCES = ['rules.js', 'worker.js'].map((file) => path.join(SOURCE_DIR, file));

const renderWorker = (shell, sources) => [`const SHELL = ${JSON.stringify(shell)};`, ...sources].join('\n\n');

/* Writes sw.js once every other file has its final name: the list of files to hold, then rules.js and
 * worker.js as they are. The worker is one file with no imports, so a browser sees a new build as a
 * changed sw.js and nothing else has to be fetched to run it. */
/* The files of the entry and of each named chunk, with the chunks split out of them. A name that is
 * not in the build is an error: the sign-in page would then open blank with no network, silently. */
const firstPaintFiles = (compilation, chunkNames, WebpackError) => {
    const groups = [...compilation.entrypoints.values()];
    for (const name of chunkNames) {
        const group = compilation.namedChunkGroups.get(name);
        if (group) groups.push(group);
        else compilation.errors.push(new WebpackError(`${PLUGIN}: no chunk named "${name}" in this build; firstPaintChunks in vue.config.js names it.`));
    }
    return new Set(groups.flatMap((group) => group.getFiles()));
};

class ShellWorkerPlugin {
    constructor({ firstPaintChunks = [] } = {}) {
        this.firstPaintChunks = firstPaintChunks;
    }

    apply(compiler) {
        const { Compilation, WebpackError, sources } = compiler.webpack;
        compiler.hooks.thisCompilation.tap(PLUGIN, (compilation) => {
            SOURCES.forEach((file) => compilation.fileDependencies.add(file));
            // Content hashes are final only after OPTIMIZE_HASH.
            compilation.hooks.processAssets.tap({ name: PLUGIN, stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER }, () => {
                const emitted = compilation.getAssets();
                const shell = shellAssetsOf(emitted.map(({ name, info }) => ({ name, immutable: Boolean(info && info.immutable) })), firstPaintFiles(compilation, this.firstPaintChunks, WebpackError));
                const code = SOURCES.map((file) => fs.readFileSync(file, 'utf8'));
                // The worker's own code is part of the version: a changed worker fills a cache of its own and never one in use.
                const digest = crypto.createHash('sha256');
                code.forEach((text) => digest.update(text));
                for (const file of [...shell.hashed, ...shell.plain]) {
                    digest.update(file);
                    digest.update(compilation.getAsset(file.slice(1)).source.buffer());
                }
                shell.lazy.forEach((file) => digest.update(file));
                const worker = renderWorker({ version: digest.digest('hex').slice(0, 16), ...shell }, code);
                // Marked minimized so the minifier, which also takes late assets, leaves the served worker readable.
                compilation.emitAsset(WORKER_PATH.slice(1), new sources.RawSource(worker), { minimized: true });
            });
        });
    }
}

module.exports = { ShellWorkerPlugin, renderWorker };
