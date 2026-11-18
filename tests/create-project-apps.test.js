const blankTemplate = require('../Modules/createProject/blankTemplate');
const { pickKnownApps } = require('../Modules/createProject/apps');

const CATALOG = ['Priority', 'MultipleAssignees', 'TimeEstimates', 'Milestones', 'tags', 'CustomFields', 'TimeTracking', 'AI'].map((key) => ({ key }));

describe('blank template apps', () => {
    const on = blankTemplate.apps.filter((a) => a.appStatus).map((a) => a.key);

    test('turns on Tags and Custom fields alongside the original three', () => {
        expect(on).toEqual(expect.arrayContaining(['Priority', 'MultipleAssignees', 'TimeTracking', 'tags', 'CustomFields']));
    });

    test('names match the seeded catalogue so the category merge resolves them', () => {
        const seeded = { tags: 'Tags', CustomFields: 'Custom Fields' };
        blankTemplate.apps.filter((a) => seeded[a.key]).forEach((a) => expect(a.name).toBe(seeded[a.key]));
    });
});

describe('pickKnownApps', () => {
    test('keeps only keys present in the workspace catalogue, in order, deduplicated', () => {
        expect(pickKnownApps(['tags', 'Bogus', 'AI', 'tags'], CATALOG)).toEqual(['tags', 'AI']);
    });

    test('an empty client selection means no apps', () => {
        expect(pickKnownApps([], CATALOG)).toEqual([]);
    });

    test('tolerates a missing catalogue', () => {
        expect(pickKnownApps(['tags'], undefined)).toEqual([]);
    });
});
