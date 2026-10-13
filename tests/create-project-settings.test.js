/* A workspace can be missing a settings document — task_type is absent on workspaces
   created before it was seeded. Project creation used to die on it with
   "Cannot read properties of undefined (reading 'settings')", which the caller then
   reported as a template problem. Both the Personal List and every "New project" click
   failed for that reason.

   The merge now reads settings through a guard, so a missing document leaves the
   template's own values in place instead of failing the whole creation. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'createProject', 'controller.js'), 'utf8');

/* The guard, lifted from the shipped source so the test cannot drift from it. */
function buildSettingsOf(source) {
    const line = source.split('\n').find((l) => l.includes('const settingsOf ='));
    if (!line) throw new Error('settingsOf not found in controller');
    // eslint-disable-next-line no-new-func
    return new Function(`${line.trim().replace(/^const /, 'const ')} return settingsOf;`)();
}

const settingsOf = buildSettingsOf(SRC);

describe('createProject settings guard', () => {
    test('a present settings document yields its settings array', () => {
        expect(settingsOf([{ settings: [{ name: 'Task' }] }])).toEqual([{ name: 'Task' }]);
    });

    test('the shapes a missing document actually takes never throw', () => {
        for (const rows of [undefined, null, [], [undefined], [null], [{}], [{ settings: null }], [{ settings: 'nope' }]]) {
            expect(() => settingsOf(rows)).not.toThrow();
            expect(settingsOf(rows)).toEqual([]);
            // .find is what the merge calls on it, and is what threw before.
            expect(() => settingsOf(rows).find((v) => v)).not.toThrow();
        }
    });

    test('no settings document is dereferenced without the guard', () => {
        // The original crash was `taskTypeData[0].settings.find(...)`.
        expect(SRC).not.toMatch(/(projectStatus|taskStatus|taskType)Data\[0\]\.settings/);
    });

    test('the category catch reports the real cause, not a template error', () => {
        expect(SRC).toContain('error applying the category template:');
        expect(SRC).not.toContain("reject({status: false, statusText: 'error in getting template with category'});\n                                logger.error(`status update error");
    });
});

/* The counter that assigns keys to template-introduced entries. Seeded from a missing
   settings document it was undefined, so `undefined += 1` gave NaN, stored as a null key.
   The project created and then refused every task, because the schema needs a Number. */
function buildTotalOf(source) {
    const line = source.split('\n').find((l) => l.includes('const totalOf ='));
    if (!line) throw new Error('totalOf not found in controller');
    // eslint-disable-next-line no-new-func
    return new Function(`${line.trim()} return totalOf;`)();
}

const totalOf = buildTotalOf(SRC);

describe('createProject key counter', () => {
    test('a present settings document yields its total', () => {
        expect(totalOf([{ totalStatus: 7 }])).toBe(7);
        expect(totalOf([{ totalStatus: '7' }])).toBe(7);
    });

    test('a missing document seeds 0 so keys stay numeric', () => {
        for (const rows of [undefined, null, [], [undefined], [{}], [{ totalStatus: null }], [{ totalStatus: 'x' }]]) {
            const seed = totalOf(rows);
            expect(Number.isFinite(seed)).toBe(true);
            expect(seed).toBe(0);
            // this is the increment the merge performs; it used to produce NaN
            let key = seed;
            key += 1;
            expect(Number.isFinite(key)).toBe(true);
            expect(key).toBe(1);
        }
    });

    test('no counter is seeded straight from a raw settings row', () => {
        expect(SRC).not.toMatch(/increment\w+ = \w+Data\[0\]\??\.totalStatus/);
    });
});

/* "Include the sample tasks" must actually mean it. Two seeding paths were merged: one gated
   on the checkbox, one that always seeded a built-in template's own examples. Keeping the
   second silently dropped the opt-out, so unchecking the box did nothing. */
describe('createProject sample-task opt-out', () => {
    test('an explicit false returns before any rows are chosen', () => {
        const fn = SRC.slice(SRC.indexOf('function seedTemplateSamples'), SRC.indexOf('const { resolveProjectSkills }'));
        const guard = fn.indexOf('includeSampleTasks === false');
        const rows = fn.indexOf('let rows =');
        expect(guard).toBeGreaterThan(-1);
        // the opt-out must be checked before the built-in fallback picks rows
        expect(guard).toBeLessThan(rows);
    });

    test('the flag survives the delete that strips it before save', () => {
        // it is deleted from the payload, so seeding must be handed its own copy
        expect(SRC).toMatch(/const includeSampleTasks = createProjectObject\.includeSampleTasks;/);
        expect(SRC).toMatch(/seedTemplateSamples\(respone, \{ \.\.\.createProjectObject, includeSampleTasks \}, sprintRes\)/);
    });
});
