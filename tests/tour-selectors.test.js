/* Every tour anchor must exist somewhere in the app source, or the step silently
   falls back to a centred card and nobody notices the tour pointing at nothing. */
const fs = require('fs');
const path = require('path');
const { STEPS, SCREENS, screenFor, doneKey } = require('../frontend/src/components/organisms/Tour/tourSteps');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const TOUR_DIR = path.join(SRC, 'components', 'organisms', 'Tour');

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && !full.startsWith(TOUR_DIR)) walk(full, out);
        } else if (/\.(vue|js|css)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const source = walk(SRC).map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function needles(selector) {
    if (selector.startsWith('#')) {
        const id = selector.slice(1);
        return [`id="${id}"`, `id='${id}'`, `id: "${id}"`, `id: '${id}'`, `#${id}`];
    }
    const attr = selector.match(/^\[([a-z-]+)="([^"]+)"\]$/);
    if (attr) return [`${attr[1]}="${attr[2]}"`];
    if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return [`class="${cls}`, `class="${cls} `, ` ${cls} `, ` ${cls}"`, `'${cls}'`, `"${cls}"`, `.${cls}`];
    }
    return [selector];
}

const present = (selector) => needles(selector).some((needle) => source.includes(needle));

describe('tour anchors exist in source', () => {
    SCREENS.forEach((screen) => {
        STEPS[screen].forEach((step) => {
            test(`${screen}/${step.key}: ${step.els.join(' , ')}`, () => {
                expect(step.els.length).toBeGreaterThan(0);
                step.els.forEach((selector) => {
                    if (!present(selector)) throw new Error(`no element matches ${selector} in frontend/src`);
                });
            });
        });
    });
});

describe('tour copy keys', () => {
    const en = fs.readFileSync(path.join(SRC, 'locales', 'en.js'), 'utf8');
    SCREENS.forEach((screen) => {
        STEPS[screen].forEach((step, i) => {
            test(`AuthV2.tour_${screen}_${step.key}_* exist`, () => {
                expect(en).toContain(`tour_${screen}_${step.key}_title:`);
                expect(en).toContain(`tour_${screen}_${step.key}_body:`);
                if (i < STEPS[screen].length - 1) expect(en).toContain(`tour_${screen}_${step.key}_next:`);
            });
        });
    });
});

describe('screenFor', () => {
    test('route meta wins, then the route name and tab', () => {
        expect(screenFor({ meta: { tour: 'list' }, name: 'Home' })).toBe('list');
        expect(screenFor({ name: 'Home' })).toBe('shell');
        expect(screenFor({ name: 'ProjectSprint', query: { tab: 'ProjectKanban' } })).toBe('board');
        expect(screenFor({ name: 'Project', query: { tab: 'ProjectListView' } })).toBe('list');
        expect(screenFor({ name: 'ProjectFolder', query: {} })).toBe('project');
        expect(screenFor({ name: 'Projects' })).toBe('');
        expect(screenFor({ name: 'Members' })).toBe('');
    });

    test('done flags keep the shell key the user documents already carry', () => {
        expect(doneKey('shell')).toBe('isShellTour');
        expect(doneKey('board')).toBe('isTour_board');
    });
});
