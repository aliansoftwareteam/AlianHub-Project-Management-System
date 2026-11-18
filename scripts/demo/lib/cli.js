const parseArgs = (argv) => {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const [name, inline] = arg.slice(2).split(/=(.*)/s);
        const next = argv[i + 1];
        if (inline !== undefined) out[name] = inline;
        else if (next !== undefined && !next.startsWith('--')) {
            out[name] = next;
            i += 1;
        } else out[name] = true;
    }
    return out;
};

const describe = (error) => (error && (error.message || error.statusText)) || String(error);

// App modules keep Mongo pools and timers open, so the process has to be ended explicitly.
const run = (main) => {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            process.stderr.write(`\n${describe(error)}\n\n`);
            process.exit(1);
        });
};

module.exports = { parseArgs, run };
