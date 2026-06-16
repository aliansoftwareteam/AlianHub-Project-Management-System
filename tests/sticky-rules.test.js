const {
    STICKY_COLORS,
    DEFAULT_COLOR,
    MAX_TITLE_LENGTH,
    MAX_CONTENT_LENGTH,
    MAX_NOTES_PER_USER,
    isObjectId,
    normalizeColor,
    validateStickyPayload,
    validateReorder,
} = require('../Modules/Stickies/helpers/stickyRules');

describe('sticky rules — color', () => {
    test('keeps a valid palette color', () => {
        STICKY_COLORS.forEach((c) => expect(normalizeColor(c)).toBe(c));
    });
    test('falls back to the default for an unknown color', () => {
        expect(normalizeColor('chartreuse')).toBe(DEFAULT_COLOR);
        expect(normalizeColor(undefined)).toBe(DEFAULT_COLOR);
        expect(normalizeColor('')).toBe(DEFAULT_COLOR);
    });
});

describe('sticky rules — isObjectId', () => {
    test('accepts a 24-hex id and rejects junk', () => {
        expect(isObjectId('6a1d613984fa1ecb8175b7bf')).toBe(true);
        expect(isObjectId('not-an-id')).toBe(false);
        expect(isObjectId('')).toBe(false);
        expect(isObjectId(null)).toBe(false);
    });
});

describe('sticky rules — validateStickyPayload (create)', () => {
    test('defaults title and content to empty and color to default', () => {
        const r = validateStickyPayload({});
        expect(r.valid).toBe(true);
        expect(r.data.title).toBe('');
        expect(r.data.content).toBe('');
        expect(r.data.color).toBe(DEFAULT_COLOR);
    });
    test('accepts a title and rejects one over the max length', () => {
        expect(validateStickyPayload({ title: 'Groceries' }).data.title).toBe('Groceries');
        expect(validateStickyPayload({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }).valid).toBe(false);
    });
    test('accepts content within the limit and a valid color', () => {
        const r = validateStickyPayload({ content: 'call vendor at 3pm', color: 'blue' });
        expect(r.valid).toBe(true);
        expect(r.data.content).toBe('call vendor at 3pm');
        expect(r.data.color).toBe('blue');
    });
    test('rejects content over the max length', () => {
        const r = validateStickyPayload({ content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) });
        expect(r.valid).toBe(false);
    });
    test('coerces an unknown color to the default rather than failing', () => {
        const r = validateStickyPayload({ content: 'note', color: 'neon' });
        expect(r.valid).toBe(true);
        expect(r.data.color).toBe(DEFAULT_COLOR);
    });
});

describe('sticky rules — validateStickyPayload (partial update)', () => {
    test('updates only the provided fields', () => {
        const r = validateStickyPayload({ color: 'green' }, { partial: true });
        expect(r.valid).toBe(true);
        expect(r.data).toEqual({ color: 'green' });
    });
    test('accepts isPinned and numeric sortIndex', () => {
        const r = validateStickyPayload({ isPinned: true, sortIndex: 3 }, { partial: true });
        expect(r.valid).toBe(true);
        expect(r.data.isPinned).toBe(true);
        expect(r.data.sortIndex).toBe(3);
    });
    test('rejects a non-numeric sortIndex', () => {
        const r = validateStickyPayload({ sortIndex: 'abc' }, { partial: true });
        expect(r.valid).toBe(false);
    });
    test('rejects an empty partial update', () => {
        const r = validateStickyPayload({}, { partial: true });
        expect(r.valid).toBe(false);
    });
});

describe('sticky rules — validateReorder', () => {
    test('accepts an array of valid ids', () => {
        const ids = ['6a1d613984fa1ecb8175b7bf', '6a1d613a84fa1ecb8175b7c2'];
        const r = validateReorder(ids);
        expect(r.valid).toBe(true);
        expect(r.ids).toEqual(ids);
    });
    test('rejects an empty array', () => {
        expect(validateReorder([]).valid).toBe(false);
    });
    test('rejects an array containing a bad id', () => {
        expect(validateReorder(['6a1d613984fa1ecb8175b7bf', 'nope']).valid).toBe(false);
    });
    test('rejects more than the per-user cap', () => {
        const many = new Array(MAX_NOTES_PER_USER + 1).fill('6a1d613984fa1ecb8175b7bf');
        expect(validateReorder(many).valid).toBe(false);
    });
});
