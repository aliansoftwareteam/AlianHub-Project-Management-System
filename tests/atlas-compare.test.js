const { pairShots, diffPixels, orderByChange } = require('../scripts/atlas/compare');
const { galleryHtml, compareHtml } = require('../scripts/atlas/gallery');

const image = (width, height, rgba) => {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
    return { width, height, data };
};

describe('atlas compare: pairing', () => {
    test('shots pair by file name; the rest are added or removed', () => {
        const pairs = pairShots(
            ['home__light__1440x900.png', 'inbox__light__1440x900.png', 'index.html'],
            ['home__light__1440x900.png', 'planner__light__1440x900.png', 'atlas.json'],
        );
        expect(pairs).toEqual([
            { file: 'home__light__1440x900.png', screen: 'home', theme: 'light', size: '1440x900', status: 'both' },
            { file: 'inbox__light__1440x900.png', screen: 'inbox', theme: 'light', size: '1440x900', status: 'removed' },
            { file: 'planner__light__1440x900.png', screen: 'planner', theme: 'light', size: '1440x900', status: 'added' },
        ]);
    });
});

describe('atlas compare: pixel diff', () => {
    test('identical images have nothing changed', () => {
        const result = diffPixels(image(4, 2, [10, 20, 30, 255]), image(4, 2, [10, 20, 30, 255]));
        expect(result).toMatchObject({ width: 4, height: 2, changed: 0, total: 8, ratio: 0 });
    });

    test('counts the pixels that differ and marks them in the diff image', () => {
        const before = image(2, 2, [255, 255, 255, 255]);
        const after = image(2, 2, [255, 255, 255, 255]);
        after.data.set([0, 0, 0, 255], 4);
        const result = diffPixels(before, after);
        expect(result.changed).toBe(1);
        expect(result.ratio).toBe(0.25);
        expect([...result.data.subarray(4, 8)]).toEqual([255, 0, 102, 255]);
        expect(result.data[0]).toBeGreaterThan(200);
    });

    test('a difference below the threshold is not a change', () => {
        const result = diffPixels(image(1, 1, [100, 100, 100, 255]), image(1, 1, [103, 100, 100, 255]), { threshold: 8 });
        expect(result.changed).toBe(0);
    });

    test('a size change counts the area only one image covers', () => {
        const result = diffPixels(image(2, 2, [9, 9, 9, 255]), image(2, 3, [9, 9, 9, 255]));
        expect(result).toMatchObject({ width: 2, height: 3, changed: 2, total: 6 });
    });
});

describe('atlas compare: ordering', () => {
    test('most changed first, then added, then removed, unchanged last, name breaks ties', () => {
        const ordered = orderByChange([
            { file: 'b.png', status: 'both', ratio: 0 },
            { file: 'c.png', status: 'both', ratio: 0.4 },
            { file: 'a.png', status: 'both', ratio: 0 },
            { file: 'e.png', status: 'removed', ratio: 1 },
            { file: 'd.png', status: 'both', ratio: 0.9 },
            { file: 'f.png', status: 'added', ratio: 1 },
        ]);
        expect(ordered.map((row) => row.file)).toEqual(['d.png', 'c.png', 'f.png', 'e.png', 'a.png', 'b.png']);
    });

    test('does not reorder the caller\'s list', () => {
        const rows = [{ file: 'a.png', status: 'both', ratio: 0 }, { file: 'b.png', status: 'both', ratio: 1 }];
        orderByChange(rows);
        expect(rows[0].file).toBe('a.png');
    });
});

describe('atlas pages', () => {
    const shots = [{ file: 'home__light__1440x900.png', screen: 'home', theme: 'light', size: '1440x900' }];

    test('the gallery opens from disk: no network, relative images, escaped text', () => {
        const html = galleryHtml({ title: 'Atlas <1>', shots, failures: [{ screen: 'doc', reason: 'no <doc> here' }] });
        expect(html).toContain('home__light__1440x900.png');
        expect(html).toContain('Atlas &lt;1&gt;');
        expect(html).not.toContain('no <doc> here');
        expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    });

    test('the compare page keeps the order it is given', () => {
        const html = compareHtml({
            title: 'Compare',
            rows: [
                { file: 'zeta__light__1440x900.png', screen: 'zeta', theme: 'light', size: '1440x900', status: 'both', ratio: 0.5, changed: 5, total: 10 },
                { file: 'alpha__light__1440x900.png', screen: 'alpha', theme: 'light', size: '1440x900', status: 'both', ratio: 0, changed: 0, total: 10 },
            ],
        });
        expect(html.indexOf('zeta__light')).toBeLessThan(html.indexOf('alpha__light'));
        expect(html).toContain('before/zeta__light__1440x900.png');
        expect(html).toContain('diff/zeta__light__1440x900.png');
        expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    });
});
