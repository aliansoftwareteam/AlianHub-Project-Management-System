const { linkTokenAccepted } = require('../Modules/Auth/controller/invitationPreview');

const TOKEN = 'a'.repeat(64);

describe('invitation preview link token', () => {
    it('accepts the token the invitation stored', () => {
        expect(linkTokenAccepted(TOKEN, TOKEN)).toBe(true);
    });

    it('refuses a preview with no token', () => {
        expect(linkTokenAccepted(TOKEN, undefined)).toBe(false);
        expect(linkTokenAccepted(TOKEN, '')).toBe(false);
    });

    it('refuses another invitation\'s token, and one that only shares a prefix', () => {
        expect(linkTokenAccepted(TOKEN, 'b'.repeat(64))).toBe(false);
        expect(linkTokenAccepted(TOKEN, 'a'.repeat(63))).toBe(false);
        expect(linkTokenAccepted(TOKEN, `${TOKEN}a`)).toBe(false);
    });

    it('refuses every token for an invitation that stores none', () => {
        expect(linkTokenAccepted('', '')).toBe(false);
        expect(linkTokenAccepted(undefined, undefined)).toBe(false);
        expect(linkTokenAccepted('', 'anything')).toBe(false);
    });
});
