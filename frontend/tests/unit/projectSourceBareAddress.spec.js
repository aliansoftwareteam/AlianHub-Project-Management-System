import { describe, expect, it } from 'vitest';
import { cleanProposalId, checkProposalId, checkSourceFields } from '@/utils/projectSource';

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
    it.each(NO_ID_INSIDE)('%s gives an empty id', (address) => {
        expect(cleanProposalId(address)).toBe('');
    });

    it.each(NO_ID_INSIDE)('%s does not pass for an Upwork project', (address) => {
        expect(checkProposalId('upwork', address)).toBe('required');
    });

    it('stops the save and puts the message on the id field', () => {
        const model = { source: { value: 'upwork' }, proposalId: { value: 'https://www.upwork.com' } };
        expect(checkSourceFields(model, (key) => key)).toBe(false);
        expect(model.proposalId.error).toBe('Projects.proposal_id_required_upwork');
    });
});

describe('a pasted address that holds an id', () => {
    it('is still read from the last part of its path, with or without the scheme', () => {
        expect(cleanProposalId('https://www.upwork.com/ab/proposals/1234567890123456789')).toBe('1234567890123456789');
        expect(cleanProposalId('www.upwork.com/proposals/~0123456789abcdef/?tab=x#top')).toBe('0123456789abcdef');
        expect(cleanProposalId('upwork.com/~0123456789abcdef')).toBe('0123456789abcdef');
    });

    it('passes for an Upwork project', () => {
        expect(checkProposalId('upwork', 'https://www.upwork.com/proposals/~0123456789abcdef')).toBeNull();
    });
});
