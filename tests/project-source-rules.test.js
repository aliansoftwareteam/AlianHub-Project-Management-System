/**
 * Project Source Rules Test Suite
 * AlianHub Project Management System
 *
 * The bidding DB stores 19-digit numeric proposal ids, while managers copy the
 * "~…" reference out of the Upwork URL bar. `proposalIdNumeric` is what the
 * warehouse joins on, so the derivation is pinned here — a silent change turns
 * every project into an unmatched row in the dashboard.
 */

const {
    PROJECT_SOURCES,
    DEFAULT_SOURCE,
    normaliseSource,
    sourceOrDefault,
    cleanProposalId,
    numericProposalId,
    validateProposalId,
} = require('../Modules/Project/helpers/projectSourceRules');

describe('🏷️ PROJECT SOURCE - the enum', () => {

    test('the three supported sources', () => {
        expect(PROJECT_SOURCES).toEqual(['upwork', 'fiverr', 'other']);
        expect(DEFAULT_SOURCE).toBe('other');
    });

    test('casing and padding are accepted', () => {
        expect(normaliseSource(' Upwork ')).toBe('upwork');
        expect(normaliseSource('FIVERR')).toBe('fiverr');
    });

    test('anything outside the set is rejected, not coerced', () => {
        expect(normaliseSource('freelancer')).toBeNull();
        expect(normaliseSource('')).toBeNull();
        expect(normaliseSource(null)).toBeNull();
        expect(normaliseSource(undefined)).toBeNull();
    });

    test('projects predating the field read as other', () => {
        expect(sourceOrDefault(undefined)).toBe('other');
        expect(sourceOrDefault('nonsense')).toBe('other');
        expect(sourceOrDefault('upwork')).toBe('upwork');
    });
});

describe('🏷️ PROJECT SOURCE - cleaning what was pasted', () => {

    test('the trailing slash people copy is dropped', () => {
        expect(cleanProposalId('021234567890abcdef/')).toBe('021234567890abcdef');
        expect(cleanProposalId('021234567890abcdef///')).toBe('021234567890abcdef');
    });

    // Stripping the "~" is what makes the warehouse join work: Upwork's URL
    // reference is "~" + the id the bidding DB stores, so an all-digit reference
    // becomes a direct match once the prefix is gone.
    test('the leading "~" is stripped, leaving the bare id', () => {
        expect(cleanProposalId('~0123456789012345678')).toBe('0123456789012345678');
        expect(cleanProposalId('~~0123456789012345678')).toBe('0123456789012345678');
        expect(cleanProposalId('~021234567890abcdef/')).toBe('021234567890abcdef');
    });

    test('a full Upwork URL yields just the id', () => {
        expect(cleanProposalId('https://www.upwork.com/nx/proposals/~0123456789012345678/'))
            .toBe('0123456789012345678');
        expect(cleanProposalId('https://www.upwork.com/nx/proposals/1234567890123456789?tab=details'))
            .toBe('1234567890123456789');
    });

    test('whitespace and stray quotes go', () => {
        expect(cleanProposalId('  "1234567890123456789"  ')).toBe('1234567890123456789');
    });

    test('junk in, empty string out', () => {
        expect(cleanProposalId('')).toBe('');
        expect(cleanProposalId(null)).toBe('');
        expect(cleanProposalId(undefined)).toBe('');
    });
});

describe('🏷️ PROJECT SOURCE - the numeric id the warehouse joins on', () => {

    test('a 19-digit id passes straight through', () => {
        expect(numericProposalId('1234567890123456789')).toBe('1234567890123456789');
    });

    // The payoff: a "~"-prefixed reference of digits maps straight onto the id
    // the bidding DB holds, once cleanProposalId has removed the prefix.
    test('a cleaned all-digit URL reference becomes the join key', () => {
        expect(numericProposalId(cleanProposalId('~0123456789012345678'))).toBe('0123456789012345678');
    });

    test('a hex reference has no numeric form — empty, not a guess', () => {
        expect(numericProposalId('021234567890abcdef')).toBe('');
    });

    test('a numeric id embedded in a longer string is extracted', () => {
        expect(numericProposalId('proposal 1234567890123456789 (won)')).toBe('1234567890123456789');
    });

    test('short numbers are not mistaken for ids', () => {
        expect(numericProposalId('2026')).toBe('');
        expect(numericProposalId('12345')).toBe('');
        expect(numericProposalId('')).toBe('');
    });
});

describe('🏷️ PROJECT SOURCE - the Upwork requirement', () => {

    test('Upwork with no proposal id is rejected', () => {
        expect(validateProposalId('upwork', '')).toEqual({
            valid: false, reason: 'PROPOSAL_ID_REQUIRED_FOR_UPWORK',
        });
    });

    test('both expected Upwork shapes pass without a warning', () => {
        expect(validateProposalId('upwork', '021234567890abcdef').warning).toBeNull();
        expect(validateProposalId('upwork', '1234567890123456789').warning).toBeNull();
    });

    test('a still-prefixed value warns — validation runs on the cleaned id', () => {
        expect(validateProposalId('upwork', '~021234567890abcdef').warning)
            .toBe('PROPOSAL_ID_FORMAT_UNEXPECTED');
    });

    test('an unexpected shape warns but still saves', () => {
        const result = validateProposalId('upwork', 'ask-priya');
        expect(result.valid).toBe(true);
        expect(result.warning).toBe('PROPOSAL_ID_FORMAT_UNEXPECTED');
    });

    test('fiverr and other never require or warn', () => {
        expect(validateProposalId('fiverr', '')).toEqual({ valid: true, warning: null });
        expect(validateProposalId('other', 'FO-2291')).toEqual({ valid: true, warning: null });
    });
});

describe('🏷️ PROJECT SOURCE - projects schema', () => {

    test('source and proposalIdNumeric are declared', () => {
        const { schema } = require('../utils/mongo-handler/schema');
        expect(schema.projects.source).toEqual({ type: String, required: false, default: 'other' });
        expect(schema.projects.proposalIdNumeric).toEqual({ type: String, required: false, default: '' });
    });
});
