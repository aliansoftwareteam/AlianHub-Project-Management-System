/* Every tour anchor must exist somewhere in the app source, or the stop silently
   docks in a corner and nobody notices the tour pointing at nothing. */
const fs = require('fs');
const path = require('path');
const { TOUR, STOPS } = require('../frontend/src/components/organisms/Tour/tourSteps');
const { TOURS } = require('../Modules/Users/helpers/onboardingRules');

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
    STOPS.forEach((stop) => {
        test(`${stop.key}: ${stop.els.join(' , ')}`, () => {
            expect(stop.els.length).toBeGreaterThan(0);
            stop.els.forEach((selector) => {
                if (!present(selector)) throw new Error(`no element matches ${selector} in frontend/src`);
            });
        });
    });
});

describe('tour copy keys', () => {
    const en = fs.readFileSync(path.join(SRC, 'locales', 'en.js'), 'utf8');
    STOPS.forEach((stop) => {
        test(`Auth.tour_${TOUR}_${stop.key}_* exist`, () => {
            for (const part of ['title', 'body', 'key']) expect(en).toContain(`tour_${TOUR}_${stop.key}_${part}:`);
        });
    });
});

describe('the tour name', () => {
    test('is one the server stores as offered', () => {
        expect(TOURS).toContain(TOUR);
    });
});
