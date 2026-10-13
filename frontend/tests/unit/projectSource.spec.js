import { describe, expect, it } from 'vitest';
import {
    PROJECT_SOURCES, DEFAULT_SOURCE, cleanProposalId, isUpwork, checkProposalId, checkSourceFields,
} from '@/utils/projectSource';

describe('cleanProposalId', () => {
    it('keeps a bare id as it is', () => {
        expect(cleanProposalId('021234567890123456789')).toBe('021234567890123456789');
    });

    it('drops the leading ~ so an all-digit Upwork reference matches the stored id', () => {
        expect(cleanProposalId('~021234567890123456789')).toBe('021234567890123456789');
        expect(cleanProposalId('~~0abc')).toBe('0abc');
    });

    it('unwraps a pasted address to the last part of its path', () => {
        expect(cleanProposalId('https://www.upwork.com/ab/proposals/1234567890123456789')).toBe('1234567890123456789');
        expect(cleanProposalId('https://www.upwork.com/proposals/~0123456789abcdef/?tab=x#top')).toBe('0123456789abcdef');
    });

    it('drops quotes, spaces and a trailing slash', () => {
        expect(cleanProposalId('  "abc123"  ')).toBe('abc123');
        expect(cleanProposalId("'abc123'")).toBe('abc123');
        expect(cleanProposalId('abc123///')).toBe('abc123');
    });

    it('is cut to 100 characters', () => {
        expect(cleanProposalId('a'.repeat(250))).toHaveLength(100);
    });

    it('empty, null and undefined give an empty id; a number is read as text', () => {
        expect(cleanProposalId('')).toBe('');
        expect(cleanProposalId(null)).toBe('');
        expect(cleanProposalId(undefined)).toBe('');
        expect(cleanProposalId(123456789012345)).toBe('123456789012345');
    });
});

describe('checkProposalId', () => {
    it('only Upwork needs an id', () => {
        expect(checkProposalId('fiverr', '')).toBeNull();
        expect(checkProposalId('other', undefined)).toBeNull();
        expect(checkProposalId(undefined, '')).toBeNull();
    });

    it('an Upwork project without an id cannot be saved', () => {
        expect(checkProposalId('upwork', '')).toBe('required');
        expect(checkProposalId('upwork', '  ~  ')).toBe('required');
    });

    it('an id of 15 or more hex characters is fine, in any case', () => {
        expect(checkProposalId('upwork', '0123456789abcde')).toBeNull();
        expect(checkProposalId('upwork', '~0123456789ABCDEF0123')).toBeNull();
    });

    it('a shorter or odd-looking id is only a format warning', () => {
        expect(checkProposalId('upwork', '0123456789abcd')).toBe('format');
        expect(checkProposalId('upwork', 'not-an-id-at-all-really')).toBe('format');
    });

    it('a pasted address is judged by the id inside it', () => {
        expect(checkProposalId('upwork', 'https://www.upwork.com/proposals/~0123456789abcdef')).toBeNull();
    });
});

describe('sources', () => {
    it('lists upwork, fiverr and other, and the default is one of them', () => {
        expect(PROJECT_SOURCES).toEqual(['upwork', 'fiverr', 'other']);
        expect(PROJECT_SOURCES).toContain(DEFAULT_SOURCE);
    });

    it('isUpwork is exact', () => {
        expect(isUpwork('upwork')).toBe(true);
        expect(isUpwork('Upwork')).toBe(false);
        expect(isUpwork(undefined)).toBe(false);
    });
});

describe('checkSourceFields', () => {
    const t = (key) => `t:${key}`;

    it('a form with a good source passes and gets no message', () => {
        const model = { source: { value: 'fiverr' }, proposalId: { value: '' } };
        expect(checkSourceFields(model, t)).toBe(true);
        expect(model.source.error).toBeUndefined();
        expect(model.proposalId.error).toBeUndefined();
    });

    it('no source stops the save and puts the message on the source field', () => {
        const model = { source: { value: '' } };
        expect(checkSourceFields(model, t)).toBe(false);
        expect(model.source.error).toBe('t:Projects.source_required');
    });

    it('a source that is not on the list stops the save', () => {
        expect(checkSourceFields({ source: { value: 'linkedin' } }, t)).toBe(false);
    });

    it('Upwork with no id stops the save and puts the message on the id field', () => {
        const model = { source: { value: 'upwork' }, proposalId: { value: '' } };
        expect(checkSourceFields(model, t)).toBe(false);
        expect(model.proposalId.error).toBe('t:Projects.proposal_id_required_upwork');
    });

    it('Upwork with an id of an odd shape still saves', () => {
        expect(checkSourceFields({ source: { value: 'upwork' }, proposalId: { value: 'abc123' } }, t)).toBe(true);
    });

    it('a form with no source field at all does not throw, and does not pass', () => {
        expect(checkSourceFields({}, t)).toBe(false);
    });
});
