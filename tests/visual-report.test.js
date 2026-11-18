const fs = require('fs');
const path = require('path');
const { summarise } = require('../e2e/visual/report');
const { ARTIFACT, PROPOSED_DIR } = require('../e2e/visual/settings');
const { plan } = require('../e2e/visual/run');
const { acceptPlan } = require('../e2e/visual/accept');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'visual.yml'), 'utf8');
const relative = (dir) => path.relative(ROOT, dir).split(path.sep).join('/');

describe('what a run reports', () => {
    test('nothing proposed means nothing changed', () => {
        const result = summarise({ proposed: [], baseline: ['home__light__1440x900.png'], runId: '77' });
        expect(result).toMatchObject({ changed: [], missing: [] });
        expect(result.text).toContain('match');
        expect(result.text).not.toContain('visual:accept');
    });

    test('a run that broke before comparing does not read as a match', () => {
        const { text } = summarise({ proposed: [], baseline: [], runId: '77', failed: true });
        expect(text).not.toContain('matches');
        expect(text).toContain('failed');
    });

    test('a proposed shot with a baseline is a change; one without is a missing baseline', () => {
        const result = summarise({
            proposed: ['home__light__1440x900.png', 'doc__dark__1440x900.png', 'notes.txt'],
            baseline: ['home__light__1440x900.png'],
            runId: '77',
        });
        expect(result.changed).toEqual(['home__light__1440x900.png']);
        expect(result.missing).toEqual(['doc__dark__1440x900.png']);
    });

    test('names each screen and the one command that accepts the run', () => {
        const { text } = summarise({ proposed: ['home__light__1440x900.png', 'doc__dark__1440x900.png'], baseline: ['home__light__1440x900.png'], runId: '77' });
        expect(text).toContain('home, light, 1440x900');
        expect(text).toContain('doc, dark, 1440x900');
        expect(text).toContain('npm run visual:accept -- 77');
    });

    test('without a run id it still says how to accept', () => {
        const { text } = summarise({ proposed: ['doc__dark__1440x900.png'], baseline: [], runId: null });
        expect(text).toContain('npm run visual:accept -- <run id>');
    });
});

describe('npm run visual', () => {
    test('refuses on a developer machine and says what to do instead', () => {
        const refused = plan([], {});
        expect(refused.refuse).toContain('CI');
        expect(refused.refuse).toContain('visual:accept');
    });

    test('in CI it hands every other argument to Playwright', () => {
        const { args, env } = plan(['--grep', 'home'], { CI: 'true' });
        expect(args.slice(0, 3)).toEqual(['test', '--config', 'e2e/visual.config.js']);
        expect(args.slice(3)).toEqual(['--grep', 'home']);
        expect(env.VISUAL_UPDATE).toBeUndefined();
    });

    test('--update proposes every shot and is not passed on', () => {
        const { args, env } = plan(['--update'], { CI: 'true' });
        expect(args).not.toContain('--update');
        expect(env.VISUAL_UPDATE).toBe('1');
    });
});

describe('npm run visual:accept', () => {
    test('with a run id it takes the artifact of that run into the committed baseline', () => {
        expect(acceptPlan(['123456'], {})).toEqual({ runId: '123456', into: 'e2e/visual-baseline' });
    });

    test('without one it needs the local switch, and then keeps the shots out of the repository', () => {
        expect(() => acceptPlan([], {})).toThrow('run id');
        expect(acceptPlan([], { VISUAL_LOCAL: '1' })).toEqual({ runId: null, into: 'e2e/.state/visual/baseline-local' });
    });

    test('a run id is a number', () => {
        expect(() => acceptPlan(['../x'], {})).toThrow('run id');
    });
});

describe('the workflow', () => {
    const { devDependencies } = require('../package.json');

    test('runs in the Playwright image of the version the repository pins', () => {
        const version = devDependencies['@playwright/test'];
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(WORKFLOW).toContain(`image: mcr.microsoft.com/playwright:v${version}-noble`);
    });

    test('uploads the proposed shots under the name visual:accept downloads', () => {
        expect(WORKFLOW).toContain(`name: ${ARTIFACT}`);
        expect(WORKFLOW).toContain(`path: ${relative(PROPOSED_DIR)}`);
    });

    test('is its own workflow, not a step of the functional suites', () => {
        const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
        expect(ci).not.toContain('npm run visual');
        expect(WORKFLOW).toContain('npm run visual');
    });
});
