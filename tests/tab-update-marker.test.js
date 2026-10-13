const { TAB_ID, keepTabMarkerOnly } = require('../Modules/taskIndex/helpers/updateMarker');

const TAB = `tab-${'a1'.repeat(16)}`;

describe('keepTabMarkerOnly', () => {
    test('a marker from the web app\'s own tab is kept, with its time stamp', () => {
        const out = keepTabMarkerOnly({ position: 3, updateToken: { user: TAB, timeStamp: 1700000000000 } });
        expect(out).toEqual({ position: 3, updateToken: { user: TAB, timeStamp: 1700000000000 } });
    });

    test('a marker without a time stamp is kept with the tab id alone', () => {
        expect(keepTabMarkerOnly({ updateToken: { user: TAB } })).toEqual({ updateToken: { user: TAB } });
    });

    test('extra keys inside the marker are dropped', () => {
        expect(keepTabMarkerOnly({ updateToken: { user: TAB, timeStamp: 5, admin: true } }).updateToken).toEqual({ user: TAB, timeStamp: 5 });
    });

    test('a time stamp that is not a finite number is dropped, not stored', () => {
        expect(keepTabMarkerOnly({ updateToken: { user: TAB, timeStamp: 'now' } }).updateToken).toEqual({ user: TAB });
        expect(keepTabMarkerOnly({ updateToken: { user: TAB, timeStamp: Infinity } }).updateToken).toEqual({ user: TAB });
    });

    test('a marker from an older client or an API caller is removed and the rest of the update stays', () => {
        expect(keepTabMarkerOnly({ name: 'x', updateToken: 'abc' })).toEqual({ name: 'x' });
        expect(keepTabMarkerOnly({ name: 'x', updateToken: { user: 'someone' } })).toEqual({ name: 'x' });
        expect(keepTabMarkerOnly({ name: 'x', updateToken: { user: 42 } })).toEqual({ name: 'x' });
        expect(keepTabMarkerOnly({ name: 'x', updateToken: null })).toEqual({ name: 'x' });
    });

    test('a tab id with the wrong length or capital letters does not pass', () => {
        expect(TAB_ID.test(`tab-${'a'.repeat(31)}`)).toBe(false);
        expect(TAB_ID.test(`tab-${'A'.repeat(32)}`)).toBe(false);
        expect(TAB_ID.test(`tab-${'a'.repeat(32)}x`)).toBe(false);
    });

    test('an update with no marker is returned as the same object', () => {
        const update = { name: 'x' };
        expect(keepTabMarkerOnly(update)).toBe(update);
    });

    test('null, text and undefined are returned as they came', () => {
        expect(keepTabMarkerOnly(null)).toBeNull();
        expect(keepTabMarkerOnly('x')).toBe('x');
        expect(keepTabMarkerOnly(undefined)).toBeUndefined();
    });
});
