const { cleanProposalId, numericProposalId, validateProposalId } = require('../Modules/Project/helpers/projectSourceRules');

const NO_ID_INSIDE = [
    'https://www.upwork.com',
    'https://www.upwork.com/',
    'http://upwork.com?ref=mail',
    'www.upwork.com',
    'upwork.com/',
    'https://www.fiverr.com#top',
    'https:///',
    'https://',
];

describe('a pasted site address that holds no id', () => {
    test.each(NO_ID_INSIDE)('%s gives an empty id', (address) => {
        expect(cleanProposalId(address)).toBe('');
        expect(numericProposalId(cleanProposalId(address))).toBe('');
    });

    test.each(NO_ID_INSIDE)('%s is refused for an Upwork project', (address) => {
        expect(validateProposalId('upwork', cleanProposalId(address))).toEqual({ valid: false, reason: 'PROPOSAL_ID_REQUIRED_FOR_UPWORK' });
    });

    test.each(NO_ID_INSIDE)('%s is fine for a project that needs no id', (address) => {
        expect(validateProposalId('fiverr', cleanProposalId(address))).toEqual({ valid: true, warning: null });
    });
});

describe('a pasted address that holds an id', () => {
    test('is still read from the last part of its path, with or without the scheme', () => {
        expect(cleanProposalId('https://www.upwork.com/ab/proposals/1234567890123456789')).toBe('1234567890123456789');
        expect(cleanProposalId('www.upwork.com/proposals/~0123456789abcdef/?tab=x#top')).toBe('0123456789abcdef');
        expect(cleanProposalId('upwork.com/~0123456789abcdef')).toBe('0123456789abcdef');
    });

    test('is accepted for an Upwork project', () => {
        expect(validateProposalId('upwork', cleanProposalId('https://www.upwork.com/proposals/~0123456789abcdef'))).toEqual({ valid: true, warning: null });
    });
});
