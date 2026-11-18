import { describe, expect, it } from 'vitest';
import { DECLINE_REASONS, normaliseEpisode, declineReasonText, declinedLine, episodeSummary } from '@/views/Ai/episodeText';

const t = (key, params = {}) => `${key}${Object.keys(params).length ? `(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : ''}`;

describe('normaliseEpisode', () => {
    it('turns counts into numbers and the rest into the expected shape', () => {
        expect(normaliseEpisode({ proposed: '3', acted: 2, approved: null, declined: undefined, reverted: 1, declinedReason: 'wrong_tone' })).toEqual({
            proposed: 3, acted: 2, approved: 0, declined: 0, reverted: true, declinedReason: 'wrong_tone',
        });
    });

    it('an empty record is all zeros', () => {
        expect(normaliseEpisode({})).toEqual({ proposed: 0, acted: 0, approved: 0, declined: 0, reverted: false, declinedReason: '' });
    });

    it('a reason that is not text is dropped', () => {
        expect(normaliseEpisode({ declinedReason: 5 }).declinedReason).toBe('');
    });

    it('null, text and undefined are not episodes', () => {
        expect(normaliseEpisode(null)).toBeNull();
        expect(normaliseEpisode('x')).toBeNull();
        expect(normaliseEpisode(undefined)).toBeNull();
    });
});

describe('declineReasonText', () => {
    it('every known reason has its own words', () => {
        DECLINE_REASONS.forEach((reason) => expect(declineReasonText(reason, t)).toBe(`Ai.decline_reason_${reason}`));
    });

    it('a reason a person typed is shown as typed', () => {
        expect(declineReasonText('Because I said so', t)).toBe('Because I said so');
    });
});

describe('declinedLine', () => {
    it('without a reason it only counts', () => {
        expect(declinedLine({ declined: 2, declinedReason: '' }, t)).toBe('Ai.episode_declined(n=2)');
    });

    it('with a reason it adds it', () => {
        expect(declinedLine({ declined: 1, declinedReason: 'not_now' }, t)).toBe('Ai.episode_declined_reason(n=1,reason=Ai.decline_reason_not_now)');
    });
});

describe('episodeSummary', () => {
    it('a proposal nobody has touched says only how many were proposed', () => {
        expect(episodeSummary({ proposed: 4 }, t)).toBe('Ai.episode_proposed(n=4)');
    });

    it('lists only the steps that happened, in order', () => {
        expect(episodeSummary({ proposed: 5, acted: 3, approved: 2, declined: 1, reverted: true }, t)).toBe([
            'Ai.episode_proposed(n=5)', 'Ai.episode_acted(n=3)', 'Ai.episode_approved(n=2)', 'Ai.episode_declined(n=1)', 'Ai.episode_reverted_yes',
        ].join(', '));
    });

    it('a zero count is left out', () => {
        expect(episodeSummary({ proposed: 1, acted: 0, approved: 0, declined: 0 }, t)).toBe('Ai.episode_proposed(n=1)');
    });

    it('no episode gives an empty line', () => {
        expect(episodeSummary(null, t)).toBe('');
        expect(episodeSummary(undefined, t)).toBe('');
    });
});
