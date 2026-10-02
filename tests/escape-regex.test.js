const { escapeRegex } = require('../utils/escapeRegex');

describe('escapeRegex', () => {
    test('a search for a bracket or a dot finds that character, not a pattern', () => {
        const re = new RegExp(escapeRegex('v1.2 (beta) [x]'));
        expect(re.test('release v1.2 (beta) [x] notes')).toBe(true);
        expect(re.test('release v1x2 (beta) [x] notes')).toBe(false);
    });

    test('".*" cannot be used to match every name', () => {
        const re = new RegExp(`^${escapeRegex('.*')}$`);
        expect(re.test('Project Apollo')).toBe(false);
        expect(re.test('.*')).toBe(true);
    });

    test('a catastrophic pattern like (a+)+ is turned into plain text', () => {
        expect(escapeRegex('(a+)+')).toBe('\\(a\\+\\)\\+');
    });

    test('every special character is escaped, including backslash and dollar', () => {
        expect(escapeRegex('\\^$.|?*+()[]{}')).toBe('\\\\\\^\\$\\.\\|\\?\\*\\+\\(\\)\\[\\]\\{\\}');
    });

    test('empty, null and undefined give an empty string', () => {
        expect(escapeRegex('')).toBe('');
        expect(escapeRegex(null)).toBe('');
        expect(escapeRegex(undefined)).toBe('');
    });

    test('a number or a boolean is read as its text; zero is not treated as empty', () => {
        expect(escapeRegex(0)).toBe('0');
        expect(escapeRegex(1.5)).toBe('1\\.5');
        expect(escapeRegex(false)).toBe('false');
    });

    test('plain words, spaces and non-ASCII letters pass through unchanged', () => {
        expect(escapeRegex('Zoë café 東京')).toBe('Zoë café 東京');
    });
});
