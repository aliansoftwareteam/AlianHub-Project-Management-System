const loadFresh = () => {
    let scope;
    jest.isolateModules(() => { scope = require('../common-storage/storedFileScope'); });
    return scope;
};

const original = process.env.STORAGE_DOWNLOAD_SCOPE;
afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_DOWNLOAD_SCOPE;
    else process.env.STORAGE_DOWNLOAD_SCOPE = original;
});

describe('scopeMode', () => {
    test('with nothing set the scope only reports', () => {
        delete process.env.STORAGE_DOWNLOAD_SCOPE;
        const { scopeMode, REPORT } = loadFresh();
        expect(scopeMode()).toBe(REPORT);
    });

    test('"enforce" turns enforcing on, whatever its case or spacing', () => {
        const { scopeMode, ENFORCE } = loadFresh();
        ['enforce', 'ENFORCE', '  Enforce \n'].forEach((value) => {
            process.env.STORAGE_DOWNLOAD_SCOPE = value;
            expect(scopeMode()).toBe(ENFORCE);
        });
    });

    test('a typo or any other word keeps the safe reporting mode instead of guessing', () => {
        const { scopeMode, REPORT } = loadFresh();
        ['enforced', 'on', 'true', '1', '', 'report'].forEach((value) => {
            process.env.STORAGE_DOWNLOAD_SCOPE = value;
            expect(scopeMode()).toBe(REPORT);
        });
    });

    test('the setting is read at each call, so changing it takes effect without a restart', () => {
        const { scopeMode, ENFORCE, REPORT } = loadFresh();
        process.env.STORAGE_DOWNLOAD_SCOPE = 'enforce';
        expect(scopeMode()).toBe(ENFORCE);
        process.env.STORAGE_DOWNLOAD_SCOPE = 'report';
        expect(scopeMode()).toBe(REPORT);
    });
});

describe('reported counts', () => {
    test('nothing is reported at first', () => {
        expect(loadFresh().reportedCounts()).toEqual({});
    });

    test('each category counts up on its own and the count is returned', () => {
        const { countReported, reportedCounts } = loadFresh();
        expect(countReported('avatar')).toBe(1);
        expect(countReported('avatar')).toBe(2);
        expect(countReported('task-file')).toBe(1);
        expect(reportedCounts()).toEqual({ avatar: 2, 'task-file': 1 });
    });

    test('the returned counts are a copy: changing them does not change the tally', () => {
        const { countReported, reportedCounts } = loadFresh();
        countReported('avatar');
        reportedCounts().avatar = 99;
        expect(reportedCounts().avatar).toBe(1);
    });
});
