const fs = require('fs');
const { SCREENS } = require('../scripts/atlas-manifest');
const { DESKTOP, PHONE, coreScreens, coreShots, inCore } = require('../scripts/atlas/core');
const { parseArgs, parseFileName } = require('../scripts/atlas/naming');
const { selectScreens } = require('../scripts/screenshot-atlas');
const { MASKED, HIDDEN, captureCss } = require('../e2e/visual/masks');
const { THRESHOLD, MAX_DIFF_PIXEL_RATIO, BASELINE_DIR, LOCAL_BASELINE_DIR, baselineDir, mayRun } = require('../e2e/visual/settings');

const CORE = ['home', 'everything', 'command-palette', 'docs', 'doc', 'dashboard', 'project-list', 'project-board', 'project-table', 'task-detail', 'settings-my-profile'];
const ON_PHONE = ['home', 'project-list', 'project-board', 'task-detail'];
const BASELINE_BUDGET_BYTES = 10 * 1024 * 1024;

const names = (screens) => screens.map((screen) => screen.name).sort();

describe('core screens', () => {
    test('the manifest marks the screens the check covers', () => {
        expect(names(coreScreens())).toEqual([...CORE].sort());
    });

    test('four of them are also checked at phone size', () => {
        expect(names(SCREENS.filter((screen) => screen.phone))).toEqual([...ON_PHONE].sort());
        expect(SCREENS.filter((screen) => screen.phone && !screen.core)).toEqual([]);
    });

    test('every core screen is taken in light and dark at desktop size, the phone ones at both sizes', () => {
        const shots = coreShots();
        expect(shots).toHaveLength((CORE.length + ON_PHONE.length) * 2);
        for (const name of CORE) {
            const taken = shots.filter((shot) => shot.screen === name).map((shot) => `${shot.theme} ${shot.size}`).sort();
            const sizes = ON_PHONE.includes(name) ? [DESKTOP, PHONE] : [DESKTOP];
            expect(taken).toEqual(sizes.flatMap((size) => [`dark ${size}`, `light ${size}`]).sort());
        }
    });

    test('a shot is filed under the name the atlas gives it', () => {
        const [first] = coreShots([{ name: 'home', route: '/:cid', core: true }]);
        expect(first).toEqual({ screen: 'home', theme: 'light', size: '1440x900', file: 'home__light__1440x900.png' });
        for (const shot of coreShots()) expect(parseFileName(shot.file)).toEqual({ screen: shot.screen, theme: shot.theme, size: shot.size });
    });

    test('a screen without the mark is not part of the set at any size', () => {
        expect(inCore({ name: 'inbox' }, DESKTOP)).toBe(false);
        expect(inCore({ name: 'docs', core: true }, DESKTOP)).toBe(true);
        expect(inCore({ name: 'docs', core: true }, PHONE)).toBe(false);
        expect(inCore({ name: 'home', core: true, phone: true }, PHONE)).toBe(true);
    });
});

describe('atlas --core', () => {
    test('the flag is off unless given', () => {
        expect(parseArgs([]).core).toBe(false);
        expect(parseArgs(['--core']).core).toBe(true);
    });

    test('limits the tour to the core screens', () => {
        expect(names(selectScreens(null, { core: true }))).toEqual([...CORE].sort());
        expect(selectScreens(null).length).toBe(SCREENS.length);
    });

    test('--only narrows it further and refuses a screen outside the set', () => {
        expect(names(selectScreens(['home', 'doc'], { core: true }))).toEqual(['doc', 'home']);
        expect(() => selectScreens(['inbox'], { core: true })).toThrow('inbox');
    });
});

describe('what the check paints over or removes', () => {
    const entries = [...MASKED, ...HIDDEN];

    test('every entry has a name, a selector and a reason', () => {
        for (const entry of entries) {
            expect(entry.name).toMatch(/^[a-z]+(-[a-z]+)*$/);
            expect(typeof entry.selector).toBe('string');
            expect(entry.selector.trim()).not.toBe('');
            expect(entry.why.length).toBeGreaterThan(40);
        }
    });

    test('names are unique and the lists stay short', () => {
        const all = entries.map((entry) => entry.name);
        expect(all.filter((name, index) => all.indexOf(name) !== index)).toEqual([]);
        expect(MASKED.length).toBeLessThanOrEqual(6);
        expect(HIDDEN.length).toBeLessThanOrEqual(6);
    });

    test('the capture stylesheet stops motion, hides scrollbars, carets and focus rings, and removes the hidden entries', () => {
        const css = captureCss();
        expect(css).toContain('animation: none !important');
        expect(css).toContain('transition: none !important');
        expect(css).toContain('::-webkit-scrollbar');
        expect(css).toContain('caret-color: transparent !important');
        expect(css).toContain('outline: none !important');
        for (const entry of HIDDEN) expect(css).toContain(`${entry.selector} { display: none !important; }`);
        for (const entry of MASKED) expect(css).not.toContain(entry.selector);
    });
});

describe('tolerance and where the baseline lives', () => {
    test('the tolerance is small', () => {
        expect(THRESHOLD).toBeGreaterThan(0);
        expect(THRESHOLD).toBeLessThanOrEqual(0.2);
        expect(MAX_DIFF_PIXEL_RATIO).toBeGreaterThan(0);
        expect(MAX_DIFF_PIXEL_RATIO).toBeLessThanOrEqual(0.001);
    });

    test('CI compares with the folder in the repository; a run on a developer machine never touches it', () => {
        expect(BASELINE_DIR.endsWith('e2e/visual-baseline')).toBe(true);
        expect(baselineDir({ CI: 'true' })).toBe(BASELINE_DIR);
        expect(baselineDir({ VISUAL_LOCAL: '1' })).toBe(LOCAL_BASELINE_DIR);
        expect(LOCAL_BASELINE_DIR).toContain('e2e/.state/');
    });

    test('the check runs in CI, or where it is asked for by name', () => {
        expect(mayRun({})).toBe(false);
        expect(mayRun({ CI: 'true' })).toBe(true);
        expect(mayRun({ VISUAL_LOCAL: '1' })).toBe(true);
    });

    test('the committed baseline holds only shots of the core set and stays small', () => {
        const files = fs.existsSync(BASELINE_DIR) ? fs.readdirSync(BASELINE_DIR) : [];
        const known = new Set(coreShots().map((shot) => shot.file));
        expect(files.filter((file) => !known.has(file))).toEqual([]);
        const bytes = files.reduce((sum, file) => sum + fs.statSync(`${BASELINE_DIR}/${file}`).size, 0);
        expect(bytes).toBeLessThan(BASELINE_BUDGET_BYTES);
    });
});
