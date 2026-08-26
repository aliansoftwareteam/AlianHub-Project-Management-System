/* Drives the real computed logic out of FirstRunChecklist.vue by extracting the two store readers
   and the item list from the shipped source. The point is the store shape: projectData/allProjects
   starts as [] and becomes { data: [...] } once loaded, and reading it as a plain array threw
   "allProjects.value.some is not a function" on first paint. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src', 'components', 'molecules', 'FirstRunChecklist', 'FirstRunChecklist.vue');

// Rebuild the two readers from the component's own source so the test cannot drift from it.
function buildReaders(source) {
    const block = source.slice(source.indexOf('<script setup>'), source.indexOf('</script>'));

    const grab = (name) => {
        const start = block.indexOf(`const ${name} = computed(`);
        if (start === -1) throw new Error(`${name} not found in component`);
        let depth = 0;
        let i = block.indexOf('(', start);
        for (let k = i; k < block.length; k++) {
            if (block[k] === '(') depth++;
            else if (block[k] === ')') { depth--; if (!depth) { i = k; break; } }
        }
        return block.slice(start, i + 1).replace(/^const \w+ = computed\(/, '').replace(/\)$/, '');
    };

    const make = (name) => {
        // eslint-disable-next-line no-new-func
        return new Function('getters', `return (${grab(name)})();`);
    };

    return { allProjects: make('allProjects'), companyUsers: make('companyUsers') };
}

const source = fs.readFileSync(SRC, 'utf8');
const readers = buildReaders(source);

describe('first-run checklist store readers', () => {
    describe('allProjects — the shape that caused the crash', () => {
        test('loaded shape { data: [...] } yields the array', () => {
            const g = { 'projectData/allProjects': { data: [{ _id: 'a' }, { _id: 'b' }] } };
            const out = readers.allProjects(g);
            expect(Array.isArray(out)).toBe(true);
            expect(out).toHaveLength(2);
        });

        test('the result always supports .some, which is what threw', () => {
            const shapes = [
                { data: [{ lastTaskId: 4 }] },
                [],
                [{ lastTaskId: 0 }],
                undefined,
                null,
                {},
                { data: null },
                { data: 'not an array' },
                0,
                '',
            ];
            for (const raw of shapes) {
                const out = readers.allProjects({ 'projectData/allProjects': raw });
                expect(Array.isArray(out)).toBe(true);
                expect(() => out.some((p) => Number(p && p.lastTaskId) > 0)).not.toThrow();
            }
        });

        test('initial empty array is still an array', () => {
            expect(readers.allProjects({ 'projectData/allProjects': [] })).toEqual([]);
        });

        test('a company with projects is not reported as having none', () => {
            const g = { 'projectData/allProjects': { data: [{ _id: 'a' }] } };
            expect(readers.allProjects(g).length > 0).toBe(true);
        });

        test('lastTaskId drives the "has a task" item', () => {
            const none = { 'projectData/allProjects': { data: [{ lastTaskId: 0 }, {}] } };
            const some = { 'projectData/allProjects': { data: [{ lastTaskId: 0 }, { lastTaskId: 7 }] } };
            expect(readers.allProjects(none).some((p) => Number(p && p.lastTaskId) > 0)).toBe(false);
            expect(readers.allProjects(some).some((p) => Number(p && p.lastTaskId) > 0)).toBe(true);
        });
    });

    describe('companyUsers', () => {
        test('an array passes through and a non-array does not throw', () => {
            expect(readers.companyUsers({ 'settings/companyUsers': [{}, {}] })).toHaveLength(2);
            for (const raw of [undefined, null, {}, 'x', 0, { data: [] }]) {
                const out = readers.companyUsers({ 'settings/companyUsers': raw });
                expect(Array.isArray(out)).toBe(true);
                expect(out).toHaveLength(0);
            }
        });

        test('more than one member ticks the invite item', () => {
            expect(readers.companyUsers({ 'settings/companyUsers': [{}] }).length > 1).toBe(false);
            expect(readers.companyUsers({ 'settings/companyUsers': [{}, {}] }).length > 1).toBe(true);
        });
    });
});

/* The visibility rule. This is the one that matters for production: the two localStorage items are
   never ticked on an existing install, so if they counted towards visibility every owner and admin
   of every established company would suddenly be shown a getting-started panel. */
describe('first-run checklist visibility', () => {
    // Mirrors the component's rule: Owner/Admin only, and only while a CORE item is outstanding.
    const isVisible = (opts) => {
        const { dismissed = false, core = [], extras = [] } = opts;
        // Read explicitly rather than via a default parameter: passing undefined would silently
        // become the default and stop the test exercising the undefined case at all.
        const roleType = Object.prototype.hasOwnProperty.call(opts, 'roleType') ? opts.roleType : 1;
        if (dismissed) return false;
        if (roleType !== 1 && roleType !== 2) return false;
        const items = core.map((done) => ({ core: true, done }))
            .concat(extras.map((done) => ({ core: false, done })));
        return items.some((i) => i.core && !i.done);
    };

    test('an established company sees nothing, even with both extras untouched', () => {
        expect(isVisible({ core: [true, true, true], extras: [false, false] })).toBe(false);
    });

    test('a brand-new company sees it', () => {
        expect(isVisible({ core: [false, false, false], extras: [false, false] })).toBe(true);
    });

    test('it stays while any core item is outstanding', () => {
        expect(isVisible({ core: [true, true, false], extras: [true, true] })).toBe(true);
        expect(isVisible({ core: [true, false, true], extras: [true, true] })).toBe(true);
        expect(isVisible({ core: [false, true, true], extras: [true, true] })).toBe(true);
    });

    test('extras alone never keep it alive', () => {
        expect(isVisible({ core: [true, true, true], extras: [false, false] })).toBe(false);
        expect(isVisible({ core: [true, true, true], extras: [true, false] })).toBe(false);
    });

    test('dismissing wins over everything', () => {
        expect(isVisible({ dismissed: true, core: [false, false, false] })).toBe(false);
    });

    test('only Owner and Admin ever see it', () => {
        for (const roleType of [0, 3, 4, 5, null, undefined]) {
            expect(isVisible({ roleType, core: [false, false, false] })).toBe(false);
        }
        expect(isVisible({ roleType: 1, core: [false, false, false] })).toBe(true);
        expect(isVisible({ roleType: 2, core: [false, false, false] })).toBe(true);
    });

    test('the component marks exactly three items core', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components',
            'molecules', 'FirstRunChecklist', 'FirstRunChecklist.vue'), 'utf8');
        expect((src.match(/core: true/g) || []).length).toBe(3);
        expect((src.match(/core: false/g) || []).length).toBe(2);
        // and visibility must key off core, not the total count
        expect(src).toContain('i.core && !i.done');
        expect(src).not.toContain('doneCount.value < items.value.length');
    });
});

/* The demo project must not depend on what the owner answered during setup. Any option, no option,
   or an answer we do not recognise must still produce a full sample project — an empty board is the
   thing this whole change exists to prevent. */
describe('demo project sample content', () => {
    const st = require('../utils/sampleTasks.js');

    const INPUTS = ['', 'other', 'software', 'marketing', 'design', 'support', 'hiring',
        'nonsense', null, undefined, 0, '   ', 'SOFTWARE', ' software ', 'Design'];

    test.each(INPUTS.map((i) => [JSON.stringify(i), i]))('focus %s still yields tasks', (_label, input) => {
        const rows = st.demoTasksForFocus(input);
        expect(Array.isArray(rows)).toBe(true);
        expect(rows.length).toBeGreaterThan(0);
    });

    test('an unrecognised answer falls back to the product walkthrough', () => {
        // Compared by title, not by reference: the rows come back wrapped with the demo project's
        // positional plan (status, owner, dates, subtasks), so it is a new array every time.
        const titles = (rows) => rows.map((r) => r[0]);
        for (const input of ['', null, undefined, 'nonsense', 0]) {
            expect(titles(st.demoTasksForFocus(input))).toEqual(titles(st.WELCOME_TASKS));
        }
    });

    test('every known option is offered and resolves', () => {
        expect(st.TEAM_FOCUS_OPTIONS.length).toBeGreaterThan(1);
        for (const opt of st.TEAM_FOCUS_OPTIONS) {
            expect(st.demoTasksForFocus(opt).length).toBeGreaterThanOrEqual(8);
        }
    });

    test('the wizard offers exactly the options the backend understands', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'installation', 'src', 'views',
            'InstallStep', 'CreateUserAndCompany.vue'), 'utf8');
        const block = src.slice(src.indexOf('formData.teamFocus.value'));
        const offered = [...block.slice(0, 900).matchAll(/<option value="([a-z]*)"/g)].map((m) => m[1]);
        // The blank option is the "not sure" choice and is deliberately not a backend key.
        for (const value of offered.filter(Boolean)) {
            expect(st.TEAM_FOCUS_OPTIONS).toContain(value);
        }
        expect(offered).toContain('');
    });

    test('createDemoProject is gated on the company and user only, never on the answer', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '..', 'Modules', 'CheckInstallStep',
            'demoProject.js'), 'utf8');
        expect(src).toContain('if (!companyId || !userId) return false;');
        expect(src).not.toMatch(/if\s*\(\s*!teamFocus/);
        // and the payload must carry an icon — createProject throws without one
        expect(src).toContain('projectIcon');
    });
});
