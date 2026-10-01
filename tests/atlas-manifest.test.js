const fs = require('fs');
const path = require('path');
const { SCREENS, LEFT_OUT, STEP_ACTIONS } = require('../scripts/atlas-manifest');
const { isScreenName } = require('../scripts/atlas/naming');
const { paramsOf, resolveRoute } = require('../scripts/atlas/routes');

const ROUTER_DIR = path.join(__dirname, '..', 'frontend', 'src', 'router');
const DASHBOARD_ROUTER = path.join(__dirname, '..', 'frontend', 'src', 'plugins', 'dashboard', 'router.js');
const SETTINGS_PREFIX = '/:cid/settings/';

const normalise = (route) => route.split('?')[0].replace(/:[A-Za-z]+\+?/g, ':param').replace(/\/$/, '') || '/';

function routerPaths() {
    const files = [DASHBOARD_ROUTER, path.join(ROUTER_DIR, 'index.js')];
    for (const entry of fs.readdirSync(ROUTER_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) files.push(path.join(ROUTER_DIR, entry.name, 'index.js'));
    }
    const paths = new Set();
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        for (const [, , declared] of source.matchAll(/\bpath:\s*(['"`])(.+?)\1/g)) {
            paths.add(normalise(declared.startsWith('/') ? declared : `${SETTINGS_PREFIX}${declared}`));
        }
    }
    return paths;
}

const REQUIRED = [
    'home', 'inbox', 'planner', 'chat', 'ai-ask', 'ai-agents', 'docs', 'doc', 'dashboards', 'dashboard', 'projects',
    'project-list', 'project-board', 'project-table', 'project-gantt', 'project-calendar', 'project-workload',
    'task-detail', 'my-work', 'timesheets', 'approvals', 'automations', 'settings-general', 'settings-members',
    'settings-roles', 'settings-notifications', 'settings-my-profile', 'settings-appearance', 'command-palette', 'sign-in',
];

describe('atlas manifest', () => {
    test('every screen has a name and a route', () => {
        expect(SCREENS.length).toBeGreaterThan(0);
        for (const screen of SCREENS) {
            expect(isScreenName(screen.name)).toBe(true);
            expect(typeof screen.route).toBe('string');
            expect(screen.route.startsWith('/')).toBe(true);
        }
    });

    test('names are unique', () => {
        const names = SCREENS.map((screen) => screen.name);
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    });

    test('covers the screens the visual refresh is judged on', () => {
        const names = SCREENS.map((screen) => screen.name);
        expect(REQUIRED.filter((name) => !names.includes(name))).toEqual([]);
    });

    test('no route carries a literal company or record id', () => {
        for (const screen of SCREENS) {
            expect(screen.route).not.toMatch(/[a-f0-9]{24}/i);
            if (screen.auth !== false) expect(screen.route.startsWith('/:cid')).toBe(true);
        }
    });

    test('every route is one the router declares', () => {
        const declared = routerPaths();
        const unknown = SCREENS.filter((screen) => !declared.has(normalise(screen.route))).map((screen) => `${screen.name} ${screen.route}`);
        expect(unknown).toEqual([]);
    });

    test('setup steps only look: no typing, no submitting', () => {
        expect(STEP_ACTIONS).toEqual(['press', 'click', 'hover', 'scrollTo', 'waitFor']);
        for (const screen of SCREENS) {
            for (const step of screen.steps || []) {
                expect(STEP_ACTIONS).toContain(step.action);
                if (step.action === 'press') expect(step.key).not.toMatch(/^(Enter|Return|Space)$/i);
                else expect(typeof step.selector).toBe('string');
            }
        }
    });

    test('every left-out route says why and is not also captured', () => {
        const declared = routerPaths();
        const captured = new Set(SCREENS.map((screen) => normalise(screen.route)));
        for (const entry of LEFT_OUT) {
            expect(entry.reason.length).toBeGreaterThan(10);
            expect(declared.has(normalise(entry.route))).toBe(true);
            expect(captured.has(normalise(entry.route))).toBe(false);
        }
    });
});

describe('atlas routes', () => {
    test('lists the parameters a route needs', () => {
        expect(paramsOf('/:cid/project/:projectId/s/:sprintId/:taskId?tab=ProjectListView')).toEqual(['cid', 'projectId', 'sprintId', 'taskId']);
        expect(paramsOf('/login')).toEqual([]);
    });

    test('fills the parameters in and keeps the query', () => {
        expect(resolveRoute('/:cid/project/:projectId/p?tab=ProjectKanban', { cid: 'c1', projectId: 'p1' })).toEqual({ path: '/c1/project/p1/p?tab=ProjectKanban', missing: [] });
    });

    test('names what could not be resolved instead of building a broken link', () => {
        expect(resolveRoute('/:cid/pages/:pageId', { cid: 'c1' })).toEqual({ path: null, missing: ['pageId'] });
    });
});
