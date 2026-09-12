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

    /* Invitations sent before the link carried a token: the link in the inbox has none to
     * present, so those keep working until they are accepted or resent. */
    it('accepts an invitation sent before links carried a token', () => {
        expect(linkTokenAccepted('', '')).toBe(true);
        expect(linkTokenAccepted(undefined, undefined)).toBe(true);
        expect(linkTokenAccepted('', 'anything')).toBe(true);
    });
});
