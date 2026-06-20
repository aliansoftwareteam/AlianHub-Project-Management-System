const T = require('../Modules/CustomReports/helpers/reportTemplates');
const { validateConfig } = require('../Modules/CustomReports/helpers/reportRules');

describe('reportTemplates', () => {
    test('ships a non-empty catalog', () => {
        expect(T.listTemplates().length).toBeGreaterThanOrEqual(5);
    });
    test('every template config is valid per reportRules', () => {
        for (const t of T.listTemplates()) {
            expect(t.key).toBeTruthy();
            expect(t.name).toBeTruthy();
            expect(validateConfig(t.config).valid).toBe(true);
        }
    });
    test('keys are unique', () => {
        const keys = T.listTemplates().map((t) => t.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
    test('getTemplate returns one by key, null for unknown', () => {
        expect(T.getTemplate('tasks_by_status')).toMatchObject({ key: 'tasks_by_status' });
        expect(T.getTemplate('does-not-exist')).toBeNull();
    });
});
