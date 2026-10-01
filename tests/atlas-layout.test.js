const {
    shortSelector, widestOffenders, overflowOf, smallTargets, cutControls, clippedText, coveringLayers, layoutFindings, summaryOf,
} = require('../scripts/atlas/layout');

const el = (tag, classes = [], extra = {}) => ({ tag, id: '', classes, role: '', parent: null, ...extra });
const VIEWPORT = { width: 390, height: 844 };

describe('atlas layout: a short selector for a finding', () => {
    test('an id wins', () => {
        expect(shortSelector(el('table', ['grid'], { id: 'timesheet' }))).toBe('table#timesheet');
    });

    test('a generated id is skipped for the classes', () => {
        expect(shortSelector(el('input', ['ah-input'], { id: 'input-17283' }))).toBe('input.ah-input');
        expect(shortSelector(el('div', ['pop'], { id: 'el-6f1c2a9e-0b1d' }))).toBe('div.pop');
    });

    test('two classes at most, state classes left out', () => {
        expect(shortSelector(el('button', ['is-active', 'ms__tab', 'ms__tab--wide', 'third']))).toBe('button.ms__tab.ms__tab--wide');
        expect(shortSelector(el('a', ['router-link-active', 'router-link-exact-active']))).toBe('a');
    });

    test('a bare tag borrows its parent, and says its role', () => {
        expect(shortSelector(el('span', [], { role: 'button', parent: el('div', ['ts__head']) }))).toBe('div.ts__head > span[role=button]');
        expect(shortSelector(el('td', [], { parent: el('tr') }))).toBe('tr > td');
    });

    test('nothing to describe', () => {
        expect(shortSelector(null)).toBe('');
    });
});

describe('atlas layout: horizontal overflow', () => {
    const offender = (index, parent, tag, classes, right) => ({ index, parent, el: el(tag, classes), left: 0, right, width: right });

    test('the outermost elements past the edge are named, widest first, three at most', () => {
        const list = [
            offender(0, -1, 'div', ['toolbar'], 520),
            offender(1, 0, 'button', ['toolbar__more'], 520),
            offender(2, -1, 'table', ['grid'], 900),
            offender(3, 2, 'thead', [], 900),
            offender(4, 2, 'tbody', [], 900),
            offender(5, -1, 'div', ['chips'], 410),
            offender(6, -1, 'img', ['hero'], 400),
        ];
        expect(widestOffenders(list)).toEqual([
            { selector: 'table.grid', right: 900 },
            { selector: 'div.toolbar', right: 520, inner: 'button.toolbar__more' },
            { selector: 'div.chips', right: 410 },
        ]);
    });

    test('a wrapper that only passes the width on is followed to what it wraps', () => {
        const list = [
            offender(0, -1, 'div', ['page'], 700),
            offender(1, 0, 'div', ['page__body'], 700),
            offender(2, 1, 'pre', ['code'], 700),
        ];
        expect(widestOffenders(list)).toEqual([{ selector: 'div.page', right: 700, inner: 'pre.code' }]);
    });

    test('a document as wide as the phone is fine', () => {
        expect(overflowOf({ viewport: VIEWPORT, scopes: [] })).toEqual({ document: null, sideways: [], cut: [] });
        expect(overflowOf({ viewport: VIEWPORT, scopes: [{ kind: 'document', el: el('html'), clientWidth: 390, scrollWidth: 391, offenders: [] }] }).document).toBeNull();
    });

    test('a wider document says by how much and what sticks out', () => {
        const scopes = [{ kind: 'document', el: el('html'), clientWidth: 390, scrollWidth: 640, offenders: [offender(0, -1, 'table', ['grid'], 640)] }];
        expect(overflowOf({ viewport: VIEWPORT, scopes }).document).toEqual({ by: 250, widest: [{ selector: 'table.grid', right: 640 }] });
    });

    test('a scroller that pans the whole page sideways is told apart from a table scrolling in its card', () => {
        const scopes = [
            { kind: 'scroll', el: el('main', ['ah-page']), clientWidth: 390, scrollWidth: 720, tall: true, offenders: [offender(0, -1, 'div', ['ts__row'], 720)] },
            { kind: 'scroll', el: el('div', ['card__scroll']), clientWidth: 358, scrollWidth: 800, tall: false, offenders: [offender(0, -1, 'table', [], 816)] },
        ];
        expect(overflowOf({ viewport: VIEWPORT, scopes }).sideways).toEqual([
            { selector: 'main.ah-page', by: 330, page: true, widest: [{ selector: 'div.ts__row', right: 720 }] },
            { selector: 'div.card__scroll', by: 442, page: false, widest: [{ selector: 'table', right: 816 }] },
        ]);
    });

    test('content cut off by a container that cannot scroll counts only when an element is past the edge', () => {
        const scopes = [
            { kind: 'cut', el: el('div', ['card']), clientWidth: 358, scrollWidth: 600, offenders: [offender(0, -1, 'div', ['card__actions'], 616)] },
            { kind: 'cut', el: el('div', ['title']), clientWidth: 358, scrollWidth: 500, offenders: [] },
        ];
        expect(overflowOf({ viewport: VIEWPORT, scopes }).cut).toEqual([
            { selector: 'div.card', by: 242, widest: [{ selector: 'div.card__actions', right: 616 }] },
        ]);
    });
});

describe('atlas layout: targets too small to hit', () => {
    const control = (index, left, top, width, height, extra = {}) => ({ index, el: el('button', [`b${index}`]), left, top, width, height, inline: false, ancestors: [], clip: null, ...extra });

    test('a small control with room around it passes', () => {
        expect(smallTargets([control(0, 10, 10, 16, 16), control(1, 60, 10, 16, 16)])).toEqual([]);
    });

    test('a small control whose centre is within 12 px of another control fails, both ways', () => {
        const found = smallTargets([control(0, 10, 10, 16, 16), control(1, 28, 10, 16, 16)]);
        expect(found).toEqual([
            { selector: 'button.b0', width: 16, height: 16, near: 'button.b1' },
            { selector: 'button.b1', width: 16, height: 16, near: 'button.b0' },
        ]);
    });

    test('a 24 px control is big enough however close its neighbour', () => {
        expect(smallTargets([control(0, 10, 10, 24, 24), control(1, 34, 10, 24, 24)])).toEqual([]);
    });

    test('a control narrow one way only still counts', () => {
        expect(smallTargets([control(0, 10, 10, 80, 18), control(1, 10, 30, 80, 18)]).map((found) => found.selector)).toEqual(['button.b0', 'button.b1']);
    });

    test('a link in running text, and a control inside another control, are left alone', () => {
        expect(smallTargets([control(0, 10, 10, 30, 14, { inline: true }), control(1, 42, 10, 30, 14, { inline: true })])).toEqual([]);
        expect(smallTargets([control(0, 10, 10, 200, 40), control(1, 180, 22, 16, 16, { ancestors: [0] })])).toEqual([]);
    });
});

describe('atlas layout: controls cut off sideways', () => {
    const control = (index, left, width, clip) => ({ index, el: el('button', [`b${index}`]), left, top: 0, width, height: 30, inline: false, ancestors: [], clip });

    test('a control whose centre is past what its container shows cannot be tapped', () => {
        expect(cutControls([control(0, 300, 60, { left: 0, right: 390 }), control(1, 380, 60, { left: 0, right: 390 })])).toEqual([
            { selector: 'button.b1', left: 380, right: 440, edge: 390 },
        ]);
    });

    test('a control inside something that scrolls sideways is reachable', () => {
        expect(cutControls([control(0, 600, 60, null)])).toEqual([]);
    });
});

describe('atlas layout: text clipped to nothing', () => {
    const text = (extra = {}) => ({ el: el('span', ['label']), text: 'Billable', visible: { width: 0, height: 16 }, chain: [], ...extra });

    test('text squeezed to zero width or height is a finding', () => {
        expect(clippedText([text(), text({ visible: { width: 40, height: 0 } })])).toEqual([
            { selector: 'span.label', text: 'Billable' },
            { selector: 'span.label', text: 'Billable' },
        ]);
    });

    test('text that shows is not', () => {
        expect(clippedText([text({ visible: { width: 12, height: 16 } })])).toEqual([]);
    });

    test('a screen-reader helper is hidden on purpose', () => {
        expect(clippedText([text({ chain: [{ classes: ['ah-sr-only'] }] })])).toEqual([]);
        expect(clippedText([text({ chain: [{ classes: [], clip: 'rect(0px, 0px, 0px, 0px)' }] })])).toEqual([]);
        expect(clippedText([text({ chain: [{ classes: [], clipPath: 'inset(50%)' }] })])).toEqual([]);
        expect(clippedText([text({ chain: [{ classes: [], position: 'absolute', width: 1, height: 1 }] })])).toEqual([]);
    });
});

describe('atlas layout: layers that cover the screen', () => {
    const layer = (classes, position, top, bottom, extra = {}) => ({ el: el('div', classes), position, top, bottom, left: 0, right: 390, pointerEvents: 'auto', ...extra });

    test('a fixed or sticky layer over more than 40% of the height is a finding', () => {
        expect(coveringLayers([layer(['tabbar'], 'fixed', 788, 844), layer(['sheet'], 'fixed', 444, 844), layer(['head'], 'sticky', 0, 380)], VIEWPORT)).toEqual([
            { selector: 'div.sheet', position: 'fixed', share: 0.47, width: 390 },
            { selector: 'div.head', position: 'sticky', share: 0.45, width: 390 },
        ]);
    });

    test('only the part on screen counts, and a layer that lets taps through covers nothing', () => {
        expect(coveringLayers([layer(['below'], 'sticky', 700, 1600)], VIEWPORT)).toEqual([]);
        expect(coveringLayers([layer(['toasts'], 'fixed', 0, 844, { pointerEvents: 'none' })], VIEWPORT)).toEqual([]);
    });
});

describe('atlas layout: the findings of one screen', () => {
    const raw = {
        viewport: VIEWPORT,
        scopes: [{ kind: 'document', el: el('html'), clientWidth: 390, scrollWidth: 500, offenders: [{ index: 0, parent: -1, el: el('table'), left: 0, right: 500, width: 500 }] }],
        controls: Array.from({ length: 30 }, (_, index) => ({ index, el: el('button', [`b${index}`]), left: 4 + index * 18, top: 10, width: 16, height: 16, inline: false, ancestors: [], clip: null })),
        texts: [],
        layers: [],
    };

    test('every rule is counted in full and listed up to a cap', () => {
        const layout = layoutFindings(raw);
        expect(layout.counts).toEqual({ overflow: 1, sideways: 0, cut: 0, cutControls: 0, smallTargets: 30, clippedText: 0, covering: 0 });
        expect(layout.overflow.by).toBe(110);
        expect(layout.smallTargets).toHaveLength(12);
    });

    test('a clean screen has nothing but zero counts', () => {
        const layout = layoutFindings({ viewport: VIEWPORT, scopes: [], controls: [], texts: [], layers: [] });
        expect(layout.counts).toEqual({ overflow: 0, sideways: 0, cut: 0, cutControls: 0, smallTargets: 0, clippedText: 0, covering: 0 });
        expect(layout.overflow).toBeNull();
    });

    test('the one-line summary names only what was found', () => {
        expect(summaryOf(layoutFindings(raw))).toBe('document 110px too wide, 30 small targets');
        expect(summaryOf(layoutFindings({ viewport: VIEWPORT, scopes: [], controls: [], texts: [], layers: [] }))).toBe('');
        expect(summaryOf(null)).toBe('');
    });
});
