#!/usr/bin/env node
/* npm run migrate -- status | up | down <id> [--confirm]
 * The same runner the server uses at boot, for operators who set
 * MIGRATIONS_AUTO=false or want to see what a new version will do first.
 * `down` reverts one migration that defines down(); a migration that rewrites
 * data (007 decrypts every integration secret) refuses without --confirm. */
const path = require('path');

require('../Config/applyEnv').loadDotEnv(path.join(__dirname, '..', '.env'));
if (!process.env.STORAGE_TYPE) process.env.STORAGE_TYPE = 'server';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const command = positional[0] || 'status';

async function main() {
    if (!process.env.MONGODB_URL) throw new Error('MONGODB_URL is not set.');
    const { liveDeps, runMigrations, rollbackMigration, migrationStatus } = require('../migrations');
    const deps = liveDeps();
    deps.logger = console;

    if (command === 'down') {
        const id = positional[1];
        if (!id) throw new Error('Usage: migrate down <migration id> [--confirm]');
        const result = await rollbackMigration(deps, id, { confirmed: flags.has('--confirm') });
        if (result.skipped) { console.log(`Skipped: ${result.skipped} (another process is migrating).`); return; }
        Object.entries(result.companies || {}).forEach(([companyId, outcome]) => console.log(`  ${outcome.ok ? '✓' : '✗'} ${companyId} ${JSON.stringify(outcome)}`));
        console.log(`Rolled back ${id}.`);
        return;
    }

    if (command === 'status') {
        const status = await migrationStatus(deps);
        console.log(`Applied (${status.applied.length}):`);
        status.applied.forEach((m) => console.log(`  ✓ ${m.id}  ${m.appliedAt ? new Date(m.appliedAt).toISOString() : ''}  v${m.appVersion || '?'}  ${m.durationMs ?? '?'}ms`));
        console.log(`Pending (${status.pending.length}):`);
        status.pending.forEach((m) => console.log(`  • ${m.id}  [${m.scope}]`));
        status.failed.forEach((m) => console.log(`  ✗ ${m.id} failed last time: ${m.error}`));
        return;
    }
    if (command === 'up') {
        const result = await runMigrations(deps);
        if (result.skipped) { console.log(`Skipped: ${result.skipped} (another process is migrating).`); return; }
        result.applied.forEach((id) => console.log(`  ✓ ${id}`));
        if (result.failed) throw new Error(`${result.failed.id} failed: ${result.failed.error}`);
        console.log(result.applied.length ? `Applied ${result.applied.length}; ${result.pending.length} pending.` : 'Nothing to do.');
        return;
    }
    throw new Error(`Unknown command "${command}". Use: status | up | down <id> [--confirm]`);
}

main().then(() => process.exit(0)).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
