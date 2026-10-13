import { beforeEach, describe, expect, it, vi } from 'vitest';

const iconify = vi.hoisted(() => ({ addCollection: vi.fn() }));
vi.mock('@iconify/vue', () => iconify);
vi.mock('@iconify-json/mdi/icons.json', () => ({ default: { prefix: 'mdi', icons: { home: {}, 'bug-outline': {}, 'account-group': {} }, aliases: { house: {} } } }));
vi.mock('@iconify-json/lucide/icons.json', () => ({ default: { prefix: 'lucide', icons: { home: {}, 'bug-play': {} } } }));
vi.mock('@iconify-json/tabler/icons.json', () => ({ default: { prefix: 'tabler', icons: { 'home-2': {} } } }));

let lib;

beforeEach(async () => {
    iconify.addCollection.mockReset();
    vi.resetModules();
    lib = await import('@/utils/iconLibrary');
});

describe('iconForName', () => {
    it('picks the icon of the first keyword the name contains', () => {
        expect(lib.iconForName('Bug')).toBe('mdi:bug');
        expect(lib.iconForName('Customer Feedback Story')).toBe('mdi:bookmark');
        expect(lib.iconForName('Weekly meeting')).toBe('mdi:account-group');
    });

    it('ignores case', () => {
        expect(lib.iconForName('EPIC')).toBe('mdi:flag');
    });

    it('finds a keyword inside a longer word', () => {
        expect(lib.iconForName('Bugfix')).toBe('mdi:bug');
        expect(lib.iconForName('Documentation')).toBe('mdi:file-document');
    });

    it('treats sub task and subtask as the same kind of task', () => {
        expect(lib.iconForName('Sub Task')).toBe('mdi:subdirectory-arrow-right');
        expect(lib.iconForName('subtask')).toBe('mdi:subdirectory-arrow-right');
    });

    it('lets sub task win over plain task', () => {
        expect(lib.iconForName('Sub task of a task')).toBe('mdi:subdirectory-arrow-right');
    });

    it('uses the default icon for a name with no keyword, or none', () => {
        expect(lib.iconForName('Holiday')).toBe(lib.DEFAULT_ICON);
        expect(lib.iconForName('')).toBe(lib.DEFAULT_ICON);
        expect(lib.iconForName(null)).toBe(lib.DEFAULT_ICON);
        expect(lib.iconForName(undefined)).toBe(lib.DEFAULT_ICON);
        expect(lib.iconForName('مهمة')).toBe(lib.DEFAULT_ICON);
    });

    it('reads a number as text', () => {
        expect(lib.iconForName(404)).toBe(lib.DEFAULT_ICON);
    });
});

describe('colorForName', () => {
    it('tints bugs red, sub tasks grey and design orange', () => {
        expect(lib.colorForName('Bug')).toBe('#DC2626');
        expect(lib.colorForName('Sub Task')).toBe('#9CA3AF');
        expect(lib.colorForName('Design review')).toBe('#F76808');
    });

    it('uses the theme colour for every other name', () => {
        expect(lib.colorForName('Story')).toBe(lib.DEFAULT_ICON_COLOR);
        expect(lib.colorForName('')).toBe(lib.DEFAULT_ICON_COLOR);
        expect(lib.colorForName(undefined)).toBe(lib.DEFAULT_ICON_COLOR);
    });

    it('gives every tinted keyword an icon as well', () => {
        Object.keys(lib.KEYWORD_COLOR_MAP).forEach((keyword) => {
            expect(lib.KEYWORD_ICON_MAP[keyword]).toBeDefined();
        });
    });
});

describe('the curated sets', () => {
    it('are mdi, lucide and tabler in picker order', () => {
        expect(lib.CURATED_SETS).toEqual(['mdi', 'lucide', 'tabler']);
    });

    it('make the default icon one of the keyword icons', () => {
        expect(Object.values(lib.KEYWORD_ICON_MAP)).toContain(lib.DEFAULT_ICON);
    });
});

describe('before the sets are loaded', () => {
    it('reports nothing loaded and finds no icons', () => {
        expect(lib.isLoaded()).toBe(false);
        expect(lib.searchIcons('home')).toEqual([]);
    });
});

describe('loadIconSets', () => {
    it('registers every curated set with the icon renderer', async () => {
        await lib.loadIconSets();
        expect(iconify.addCollection).toHaveBeenCalledTimes(3);
        expect(iconify.addCollection.mock.calls.map((call) => call[0].prefix)).toEqual(['mdi', 'lucide', 'tabler']);
        expect(lib.isLoaded()).toBe(true);
    });

    it('does the work once however many times it is asked', async () => {
        const first = lib.loadIconSets();
        const second = lib.loadIconSets();
        expect(second).toBe(first);
        await first;
        await lib.loadIconSets();
        expect(iconify.addCollection).toHaveBeenCalledTimes(3);
    });
});

describe('searchIcons', () => {
    beforeEach(async () => {
        await lib.loadIconSets();
    });

    it('finds icons by part of a name across the sets', () => {
        expect(lib.searchIcons('home')).toEqual(['mdi:home', 'lucide:home', 'tabler:home-2']);
    });

    it('matches words written with dashes by their spaces', () => {
        expect(lib.searchIcons('account group')).toEqual(['mdi:account-group']);
        expect(lib.searchIcons('bug')).toEqual(['mdi:bug-outline', 'lucide:bug-play']);
    });

    it('includes aliases', () => {
        expect(lib.searchIcons('house')).toEqual(['mdi:house']);
    });

    it('matches a typed set prefix', () => {
        expect(lib.searchIcons('lucide:')).toEqual(['lucide:home', 'lucide:bug-play']);
    });

    it('ignores case and outer spaces', () => {
        expect(lib.searchIcons('  HOME ')).toEqual(['mdi:home', 'lucide:home', 'tabler:home-2']);
    });

    it('lists everything for an empty query, up to the limit', () => {
        expect(lib.searchIcons('')).toHaveLength(7);
        expect(lib.searchIcons(undefined, { limit: 2 })).toEqual(['mdi:home', 'mdi:bug-outline']);
    });

    it('can be narrowed to one set', () => {
        expect(lib.searchIcons('home', { set: 'tabler' })).toEqual(['tabler:home-2']);
        expect(lib.searchIcons('home', { set: 'nope' })).toEqual([]);
    });

    it('finds nothing for a word no icon has', () => {
        expect(lib.searchIcons('zebra')).toEqual([]);
    });
});
