const { parseMigrateArgs } = require('../scripts/migrateArgs');

/* package.json runs `node scripts/migrate.js up`, so `npm run migrate -- verify` reaches the
 * script as `up verify`. The named command must win, or a read-only check applies migrations. */
describe('migrate command line', () => {
    it.each([
        [['up', 'verify'], 'verify'],
        [['up', 'status'], 'status'],
        [['up', 'up', '--dry-run'], 'up'],
        [['up'], 'up'],
        [[], 'status'],
        [['verify'], 'verify'],
    ])('%j runs %s', (argv, command) => {
        expect(parseMigrateArgs(argv).command).toBe(command);
    });

    it('keeps the migration id for down after the injected up', () => {
        const parsed = parseMigrateArgs(['up', 'down', '031-secrets-by-handle', '--confirm']);
        expect(parsed.command).toBe('down');
        expect(parsed.positional[1]).toBe('031-secrets-by-handle');
        expect(parsed.flags.has('--confirm')).toBe(true);
    });

    it('keeps --dry-run with the injected up', () => {
        expect(parseMigrateArgs(['up', '--dry-run']).flags.has('--dry-run')).toBe(true);
    });
});
