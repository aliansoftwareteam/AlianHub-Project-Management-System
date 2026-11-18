const { ALLOWED, describeError, unexpectedErrors } = require('../e2e/support/consoleGuard');

const consoleError = (text, url = '') => ({ kind: 'console', text, url });
const pageError = (text) => ({ kind: 'pageerror', text, url: '' });
const allowed = [{ text: /^Failed to load resource/, url: /fonts\.example\.test/, reason: 'The font host is not reachable from the test machine.' }];

describe('the console guard', () => {
    test('an uncaught page error is never let through, whatever the lists say', () => {
        const thrown = pageError('Failed to load resource: TypeError: x is undefined');
        expect(unexpectedErrors([thrown], { allowed: [{ text: /./, reason: 'everything' }], expected: [/./] })).toEqual([thrown]);
    });

    test('a console error that is on neither list is reported', () => {
        const error = consoleError('ERROR in load trash: Network Error', 'http://127.0.0.1:4100/js/app.js');
        expect(unexpectedErrors([error], { allowed })).toEqual([error]);
    });

    test('an allowlisted error is let through only for the resource the entry names', () => {
        const font = consoleError('Failed to load resource: net::ERR_CONNECTION_REFUSED', 'https://fonts.example.test/inter.woff2');
        const api = consoleError('Failed to load resource: the server responded with a status of 500', 'http://127.0.0.1:4100/api/v2/tasks');
        expect(unexpectedErrors([font, api], { allowed })).toEqual([api]);
    });

    test('a test can name the errors it provokes on purpose, by text or by address', () => {
        const refused = consoleError('Failed to load resource: the server responded with a status of 403 (Forbidden)', 'http://127.0.0.1:4100/api/v2/instance/access');
        const other = consoleError('Failed to load resource: the server responded with a status of 403 (Forbidden)', 'http://127.0.0.1:4100/api/v2/sso/config');
        expect(unexpectedErrors([refused, other], { allowed: [], expected: [/403 .*\/api\/v2\/instance\/access/] })).toEqual([other]);
    });

    test('a reported error reads as one line with where it came from', () => {
        expect(describeError(consoleError('boom', 'http://127.0.0.1:4100/js/app.js'))).toBe('console.error: boom (http://127.0.0.1:4100/js/app.js)');
        expect(describeError(consoleError('boom'))).toBe('console.error: boom');
        expect(describeError(pageError('x is undefined'))).toBe('uncaught error: x is undefined');
    });

    test('every entry on the shared allowlist says why it is there', () => {
        for (const entry of ALLOWED) {
            expect(entry.text).toBeInstanceOf(RegExp);
            expect(String(entry.reason || '').length).toBeGreaterThan(30);
        }
    });
});
