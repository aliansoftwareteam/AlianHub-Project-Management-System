const { SCHEMA, compareVersions, migrationIds, loadFlags, buildIndex, parseArgs } = require('../scripts/release-index');

const digest = (c) => `sha256:${c.repeat(64)}`;
const NOW = '2026-11-02T10:00:00.000Z';
const FLAGS = {
    minTrackerVersion: '5.0.0',
    breakingMigrations: ['003-split-names'],
    selfHostUpgrades: [{ id: 'compose-project-names', note: 'Add COMPOSE_FILE to .env.' }]
};

const release = (version, options = {}) => buildIndex({
    version,
    digest: digest('a'),
    publishedAt: NOW,
    now: NOW,
    flags: FLAGS,
    migrations: ['001-baseline', '002-seeds'],
    ...options
});

describe('release index', () => {
    test('orders versions the semver way, prereleases before their release', () => {
        const sorted = ['14.40.0', '14.9.1', '14.40.0-beta.10', '14.40.0-beta.9', '15.0.0'].sort(compareVersions);
        expect(sorted).toEqual(['14.9.1', '14.40.0-beta.9', '14.40.0-beta.10', '14.40.0', '15.0.0']);
    });

    test('starts an index for the first release, with the image, flags and migrations', () => {
        const { problems, index } = release('14.40.0', { mirror: 'registry.digitalocean.com/alianhub/alianhub', signed: true });
        expect(problems).toEqual([]);
        expect(index).toEqual({
            schema: SCHEMA,
            updatedAt: NOW,
            latest: '14.40.0',
            releases: [{
                version: '14.40.0',
                tag: 'v14.40.0',
                publishedAt: NOW,
                prerelease: false,
                image: { repository: 'ghcr.io/aliansoftwareteam/alianhub', digest: digest('a'), mirror: 'registry.digitalocean.com/alianhub/alianhub', signed: true },
                minTrackerVersion: '5.0.0',
                migration: { latest: '002-seeds', added: null, reversible: true },
                selfHost: { upgradeNeeded: true, ids: ['compose-project-names'], notes: ['Add COMPOSE_FILE to .env.'] }
            }]
        });
    });

    test('attributes an upgrade step and the new migrations only to the release that ships them', () => {
        const first = release('14.40.0').index;
        const second = release('14.41.0', { previous: first, digest: digest('b'), migrations: ['001-baseline', '002-seeds', '003-split-names'] }).index;
        const [newest, older] = second.releases;
        expect(second.latest).toBe('14.41.0');
        expect(newest.selfHost).toEqual({ upgradeNeeded: false, ids: [], notes: [] });
        expect(newest.migration).toEqual({ latest: '003-split-names', added: ['003-split-names'], reversible: false });
        expect(older).toEqual(first.releases[0]);

        const third = release('14.42.0', { previous: second, migrations: ['001-baseline', '002-seeds', '003-split-names', '004-index'] }).index;
        expect(third.releases[0].migration).toEqual({ latest: '004-index', added: ['004-index'], reversible: true });
    });

    test('keeps the latest stable release as latest and replaces a re-run of the same version', () => {
        const stable = release('14.40.0').index;
        const beta = release('14.41.0-beta.1', { previous: stable, prerelease: true }).index;
        expect(beta.latest).toBe('14.40.0');
        const rerun = release('14.41.0-beta.1', { previous: beta, prerelease: true, digest: digest('c') }).index;
        expect(rerun.releases.map((r) => r.version)).toEqual(['14.41.0-beta.1', '14.40.0']);
        expect(rerun.releases[0].image.digest).toBe(digest('c'));
    });

    test('measures a backport against the releases before it, not the newest one', () => {
        const newer = release('14.41.0', { migrations: ['001-baseline', '002-seeds', '003-split-names'] }).index;
        const backport = release('14.40.1', { previous: newer }).index;
        expect(backport.latest).toBe('14.41.0');
        expect(backport.releases.find((r) => r.version === '14.40.1').selfHost.upgradeNeeded).toBe(true);
    });

    test('replaces an index it cannot read instead of merging it', () => {
        const { index } = release('14.40.0', { previous: { schema: 99, releases: [{ version: '1.0.0' }] } });
        expect(index.releases.map((r) => r.version)).toEqual(['14.40.0']);
    });

    test('refuses a bad version or digest', () => {
        expect(release('latest', { digest: 'sha256:abc' }).problems).toEqual([
            '--version must be a semantic version',
            '--digest must be sha256: followed by 64 hex characters'
        ]);
    });

    test('reads the real flags and migrations of this repository', () => {
        const flags = loadFlags();
        expect(Array.isArray(flags.breakingMigrations)).toBe(true);
        expect(flags.selfHostUpgrades.every((step) => step.id && step.note)).toBe(true);
        const ids = migrationIds();
        expect(ids[0]).toBe('001-baseline');
        expect(flags.breakingMigrations.every((id) => ids.includes(id))).toBe(true);
    });

    test('parses the command line', () => {
        expect(parseArgs(['--version', '1.2.3', '--signed', '--published-at', NOW])).toEqual({ version: '1.2.3', signed: true, publishedAt: NOW });
        expect(() => parseArgs(['--digest'])).toThrow('--digest needs a value');
    });
});
