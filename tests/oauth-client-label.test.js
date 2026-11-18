const { appLabel, hostOfClient, LABEL_MAX } = require('../Modules/OAuthServer/clientLabel');

const REGISTERED = 'ahc_0123456789abcdef01234567';

describe('the name an outside app is shown by', () => {
    it('puts the host and the app mark beside a name that does not hold its host', () => {
        expect(appLabel('Claude Code', 'claude.ai')).toBe('Claude Code (app · claude.ai)');
    });

    it('shows a "Claude Code" from another host with that host, so it never reads as the real one', () => {
        const host = hostOfClient('https://evil.example/claude-code.json');
        expect(appLabel('Claude Code', host)).toBe('Claude Code (app · evil.example)');
    });

    it('shows a client named like a member as an app, with its host', () => {
        expect(appLabel('Priya', 'evil.example')).toBe('Priya (app · evil.example)');
    });

    it('keeps the mark alone when the name already holds the host', () => {
        expect(appLabel('claude.ai', 'claude.ai')).toBe('claude.ai (app)');
    });

    it('keeps the host and the mark whole when the name is long, inside the shortest byline', () => {
        const label = appLabel('A'.repeat(200), 'a-very-long-subdomain.of.some.publisher.example.com');
        expect(label.length).toBeLessThanOrEqual(LABEL_MAX);
        expect(label).toMatch(/ \(app · …[a-z.-]+example\.com\)$/);
    });

    it('takes a metadata document client\'s host from its document, whatever its redirects', () => {
        expect(hostOfClient('https://claude.ai/oauth/claude-code-client-metadata', { redirectUris: ['http://127.0.0.1:4000/cb'] })).toBe('claude.ai');
    });

    it('takes a registered client\'s host from its redirects, an https one first', () => {
        expect(hostOfClient(REGISTERED, { redirectUris: ['http://127.0.0.1:41415/callback', 'https://app.example/cb'] })).toBe('app.example');
        expect(hostOfClient(REGISTERED, { redirectUris: ['http://127.0.0.1:41415/callback'] })).toBe('127.0.0.1');
    });
});
