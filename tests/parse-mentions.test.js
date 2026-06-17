const { parseMentionIds } = require('../Modules/Comments/helpers/parseMentions');

describe('parseMentionIds', () => {
    const A = 'a1'.repeat(12); // 24-hex id
    const B = 'b2'.repeat(12);

    test('extracts unique 24-hex ids from [Name](id) mention tokens', () => {
        expect(parseMentionIds(`hi [Jane Doe](${A}) and [John](${B})`)).toEqual([A, B]);
    });

    test('de-duplicates repeated mentions of the same user', () => {
        expect(parseMentionIds(`[Jane](${A}) ... and again [Jane](${A})`)).toEqual([A]);
    });

    test('ignores ordinary markdown links and non-id targets', () => {
        expect(parseMentionIds('see [docs](https://example.com) and [x](nope)')).toEqual([]);
    });

    test('empty / non-string input yields an empty array', () => {
        expect(parseMentionIds('')).toEqual([]);
        expect(parseMentionIds(null)).toEqual([]);
        expect(parseMentionIds(undefined)).toEqual([]);
        expect(parseMentionIds('plain text with no mentions')).toEqual([]);
    });
});
