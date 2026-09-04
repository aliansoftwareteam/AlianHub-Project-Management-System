/* main's FirstRunChecklist.vue was removed when the redesign's Home checklist replaced it
   (the two rendered at once). What that component's tests protected and this file keeps:

   1. The store-shape regression. projectData's project getter starts as [] and becomes
      { data: [...] } once loaded; reading it as a plain array threw
      "allProjects.value.some is not a function" on first paint. The replacement reader is
      extracted from the shipped Home source below so this test cannot drift from it.
   2. The demo project must not depend on the owner's setup answer.

   The old visibility rules are deliberately not carried over: Home decides when to show its
   checklist, so asserting the deleted component's rules would test nothing that ships. */
const fs = require('fs');
const path = require('path');

/* The checklist's store readers live in the onboarding composable Home mounts. */
const HOME = path.join(__dirname, '..', 'frontend', 'src', 'composable', 'useOnboardingChecklist.js');

/* Rebuild the readers from the shipped source so they cannot drift from it. */
function buildReaders(source) {
    const grab = (name) => {
        const m = source.match(new RegExp(`const ${name} = computed\\(([^;]*)\\);`));
        if (!m) throw new Error(`${name} not found in useOnboardingChecklist.js`);
        return m[1];
    };
    // eslint-disable-next-line no-new-func
    const make = (name) => new Function('getters', `return (${grab(name)})();`);
    return { projects: make('projects'), companyUsers: make('companyUsers') };
}

const readers = buildReaders(fs.readFileSync(HOME, 'utf8'));

describe('Home checklist store readers', () => {
    test('the loaded shape { data: [...] } yields the array', () => {
        const out = readers.projects({ 'projectData/projects': { data: [{ _id: 'a' }] } });
        expect(Array.isArray(out)).toBe(true);
        expect(out).toHaveLength(1);
    });

    test('the pre-load shapes never throw and never look like real projects', () => {
        for (const value of [undefined, null, [], {}, { data: null }]) {
            const out = readers.projects({ 'projectData/projects': value });
            expect(Array.isArray(out)).toBe(true);
            expect(out).toHaveLength(0);
            // .length and .some are what the checklist calls; both threw before.
            expect(() => out.some(Boolean)).not.toThrow();
        }
    });

    test('companyUsers passes an array through and tolerates a non-array', () => {
        expect(readers.companyUsers({ 'settings/companyUsers': [{ _id: 'u1' }, { _id: 'u2' }] })).toHaveLength(2);
        expect(Array.isArray(readers.companyUsers({ 'settings/companyUsers': undefined }))).toBe(true);
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

    // The in-app setup wizard (views/Setup) replaces the deleted installation/ package;
    // until it lands there is no UI to compare against.
    const wizardPath = require('path').join(__dirname, '..', 'frontend', 'src', 'views', 'Setup', 'SetupWizard.vue');
    const wizardTest = require('fs').existsSync(wizardPath) ? test : test.skip;
    wizardTest('the wizard offers exactly the options the backend understands', () => {
        const fs = require('fs');
        const src = fs.readFileSync(wizardPath, 'utf8');
        const block = src.slice(src.indexOf('teamFocus'));
        const offered = [...block.slice(0, 1500).matchAll(/value="([a-z]*)"/g)].map((m) => m[1]);
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
