import { describe, expect, it } from 'vitest';
import { REPLAY_SECTION_ID, replayAnchorId, replayAnchor, replayIdFromHash } from '@/views/Ai/replayAnchor';

describe('replay anchor', () => {
    it('an anchor id is the section name and the record id', () => {
        expect(replayAnchorId('abc123')).toBe('replay-abc123');
        expect(replayAnchor('abc123')).toBe('#replay-abc123');
    });

    it('the record id comes back out of the address hash', () => {
        expect(replayIdFromHash('#replay-abc123')).toBe('abc123');
        expect(replayIdFromHash('replay-abc123')).toBe('abc123');
    });

    it('an anchor that was made reads back to the same id', () => {
        ['64f0c0ffee', 'with-dash', 'a b'].forEach((id) => {
            expect(replayIdFromHash(replayAnchor(id))).toBe(id);
        });
    });

    it('an id that was encoded in the address is decoded', () => {
        expect(replayIdFromHash('#replay-a%20b%2Fc')).toBe('a b/c');
    });

    it('the whole section\'s own hash is not a record', () => {
        expect(REPLAY_SECTION_ID).toBe('replay');
        expect(replayIdFromHash('#replay')).toBe('');
    });

    it('a different hash, an empty hash, null and undefined give no id', () => {
        expect(replayIdFromHash('#other-abc')).toBe('');
        expect(replayIdFromHash('#replayabc')).toBe('');
        expect(replayIdFromHash('')).toBe('');
        expect(replayIdFromHash(null)).toBe('');
        expect(replayIdFromHash(undefined)).toBe('');
    });

    it('the prefix only counts at the start of the hash', () => {
        expect(replayIdFromHash('#x-replay-abc')).toBe('');
    });
});
