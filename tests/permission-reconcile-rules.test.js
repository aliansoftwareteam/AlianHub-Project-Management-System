/* The repair that brings an existing company's permission list up to date with the catalogue.
   It clears and rewrites the rules collection, so it runs only from the migration runner, before
   the server listens. These tests keep it there: no request path may call it, and no env flag
   may switch it on at runtime. */
const fs = require('fs');
const path = require('path');

const MODULE = path.join(__dirname, '..', 'Modules', 'settings', 'securityPermissions', 'reconcileRules.js');
const { SENTINEL_KEYS, findMissingSentinels, repairCompanyRules } = require(MODULE);
const RULES = [{ key: 'task_edit' }, { key: 'project_edit' }];

describe('where the repair runs', () => {
    test('only the migration calls it, never a request handler', () => {
        const controller = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'settings', 'securityPermissions', 'controller.js'), 'utf8');
        expect(controller).not.toMatch(/reconcileCompanyRules|repairCompanyRules/);
        const migration = require('../migrations/003-permission-catalogue');
        expect(migration.scope).toBe('company');
        expect(fs.readFileSync(path.join(__dirname, '..', 'migrations', '003-permission-catalogue.js'), 'utf8')).toContain('repairCompanyRules');
    });

    test('the old runtime switch is gone', () => {
        expect(fs.readFileSync(MODULE, 'utf8')).not.toContain('PERMISSION_RECONCILE');
        expect(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8')).not.toContain('PERMISSION_RECONCILE');
        expect(typeof repairCompanyRules).toBe('function');
    });
});

describe('what it looks for', () => {
    test('a company holding the sentinel needs no repair', () => {
        const complete = SENTINEL_KEYS.map((key) => ({ key }));
        expect(findMissingSentinels(complete)).toEqual([]);
    });

    test('a company lacking it is detected', () => {
        expect(findMissingSentinels(RULES)).toEqual(SENTINEL_KEYS);
    });

    test('a project-scoped row never counts as the company-level one', () => {
        const scoped = SENTINEL_KEYS.map((key) => ({ key, projectId: 'abc' }));
        expect(findMissingSentinels(scoped)).toEqual(SENTINEL_KEYS);
    });

    test('junk in the collection does not throw', () => {
        for (const raw of [null, undefined, {}, 'x', 0, [null, {}, { key: null }]]) {
            expect(() => findMissingSentinels(raw)).not.toThrow();
        }
    });
});
