const { cleanViewSettings, DEFAULT_VIEW_SETTINGS, VIEW_DENSITIES } = require('../Modules/Project/helpers/viewSettings');

describe('a saved view keeps its row density', () => {
    test('there are two densities and a view starts comfortable', () => {
        expect(VIEW_DENSITIES).toEqual(['comfortable', 'compact']);
        expect(DEFAULT_VIEW_SETTINGS.density).toBe('comfortable');
        expect(cleanViewSettings(undefined).density).toBe('comfortable');
        expect(cleanViewSettings({ groupBy: 2 }).density).toBe('comfortable');
    });

    test('compact is stored beside the group and sort', () => {
        const clean = cleanViewSettings({ groupBy: 2, sort: { field: 'DueDate', dir: 1 }, density: 'compact' });
        expect(clean).toMatchObject({ groupBy: 2, sort: { field: 'DueDate', dir: 1 }, density: 'compact' });
    });

    test('anything else reads as comfortable', () => {
        for (const density of ['tiny', '', null, 1, ['compact'], { $ne: 'compact' }, 'Compact']) {
            expect(cleanViewSettings({ density }).density).toBe('comfortable');
        }
    });
});
