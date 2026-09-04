/* The repair that brings an existing company's permission list up to date with the catalogue.

   It is the only change in this branch that writes to a company that already exists, and it writes
   by clearing the permission collection and rewriting it. On a fresh install that is nothing; on a
   live company it is a window where every permission check is refused, and a rewrite that dies
   halfway leaves nobody with any permissions. So it is opt-in, and these tests exist to keep it
   that way — a default flipped to on is exactly the kind of change that reads as harmless in a
   diff. */
const path = require('path');

const MODULE = path.join(__dirname, '..', 'Modules', 'settings', 'securityPermissions', 'reconcileRules.js');

const load = () => {
    delete require.cache[require.resolve(MODULE)];
    return require(MODULE);
};

const RULES = [{ key: 'task_edit' }, { key: 'project_edit' }];

describe('the repair is off unless someone turns it on', () => {
    const original = process.env.PERMISSION_RECONCILE;
    afterEach(() => {
        if (original === undefined) delete process.env.PERMISSION_RECONCILE;
        else process.env.PERMISSION_RECONCILE = original;
    });

    test('unset means off', async () => {
        delete process.env.PERMISSION_RECONCILE;
        const { reconcileEnabled, reconcileCompanyRules } = load();
        expect(reconcileEnabled()).toBe(false);
        // and it hands back exactly what it was given, untouched
        await expect(reconcileCompanyRules('somecompany', RULES)).resolves.toBe(RULES);
    });

    test('only the exact string "true" turns it on', () => {
        const { reconcileEnabled } = load();
        for (const value of ['false', 'FALSE', 'True', '1', 'yes', 'on', '', ' true ', '0']) {
            process.env.PERMISSION_RECONCILE = value;
            expect(reconcileEnabled()).toBe(false);
        }
        process.env.PERMISSION_RECONCILE = 'true';
        expect(reconcileEnabled()).toBe(true);
    });

    test('off short-circuits before anything is read, marked, or written', async () => {
        delete process.env.PERMISSION_RECONCILE;
        const { reconcileCompanyRules } = load();
        // Rules missing the sentinel are exactly what WOULD trigger a repair.
        const missing = [{ key: 'task_edit' }];
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line no-await-in-loop
            expect(await reconcileCompanyRules('livecompany', missing)).toBe(missing);
        }
    });

    test('the shipped default in .env.example is off', () => {
        const fs = require('fs');
        const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
        expect(env).toMatch(/^PERMISSION_RECONCILE="false"$/m);
        expect(env).not.toMatch(/^PERMISSION_RECONCILE="true"$/m);
    });
});

describe('what it looks for, when it is on', () => {
    test('a company holding the sentinel needs no repair', () => {
        const { findMissingSentinels, SENTINEL_KEYS } = load();
        const complete = SENTINEL_KEYS.map((key) => ({ key }));
        expect(findMissingSentinels(complete)).toEqual([]);
    });

    test('a company lacking it is detected', () => {
        const { findMissingSentinels, SENTINEL_KEYS } = load();
        expect(findMissingSentinels(RULES)).toEqual(SENTINEL_KEYS);
    });

    test('a project-scoped row never counts as the company-level one', () => {
        const { findMissingSentinels, SENTINEL_KEYS } = load();
        const scoped = SENTINEL_KEYS.map((key) => ({ key, projectId: 'abc' }));
        expect(findMissingSentinels(scoped)).toEqual(SENTINEL_KEYS);
    });

    test('junk in the collection does not throw', () => {
        const { findMissingSentinels } = load();
        for (const raw of [null, undefined, {}, 'x', 0, [null, {}, { key: null }]]) {
            expect(() => findMissingSentinels(raw)).not.toThrow();
        }
    });
});
