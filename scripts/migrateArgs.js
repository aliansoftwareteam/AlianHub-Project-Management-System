const COMMANDS = new Set(['status', 'up', 'verify', 'down']);

/* `npm run migrate` is `node scripts/migrate.js up`, so npm appends extra words after that `up`. */
function parseMigrateArgs(argv) {
    const flags = new Set(argv.filter((a) => a.startsWith('--')));
    let positional = argv.filter((a) => !a.startsWith('--'));
    if (positional[0] === 'up' && COMMANDS.has(positional[1])) positional = positional.slice(1);
    return { flags, positional, command: positional[0] || 'status' };
}

module.exports = { parseMigrateArgs };
