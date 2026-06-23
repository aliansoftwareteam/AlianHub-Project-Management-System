const crypto = require('crypto');
const R = require('../Modules/Integrations/helpers/slackRules');

describe('parseCommand', () => {
    test('empty → help', () => { expect(R.parseCommand('')).toEqual({ sub: 'help', rest: '' }); });
    test('known subcommand (case-insensitive) + rest', () => { expect(R.parseCommand('PROJECTS foo')).toEqual({ sub: 'projects', rest: 'foo' }); });
    test('unknown → help', () => { expect(R.parseCommand('launch missiles').sub).toBe('help'); });
});

describe('verifyToken', () => {
    test('equal → true', () => { expect(R.verifyToken('abc123', 'abc123')).toBe(true); });
    test('different → false', () => { expect(R.verifyToken('abc123', 'abc124')).toBe(false); });
    test('length mismatch / empty → false', () => {
        expect(R.verifyToken('abc', 'abcd')).toBe(false);
        expect(R.verifyToken('', 'x')).toBe(false);
    });
});

describe('verifySignature', () => {
    const signingSecret = 's3cr3t';
    const timestamp = '1700000000';
    const rawBody = 'token=x&text=hi';
    const good = 'v0=' + crypto.createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
    test('valid signature → true', () => { expect(R.verifySignature({ signingSecret, timestamp, rawBody, signature: good })).toBe(true); });
    test('wrong secret → false', () => { expect(R.verifySignature({ signingSecret: 'nope', timestamp, rawBody, signature: good })).toBe(false); });
    test('missing parts → false', () => { expect(R.verifySignature({ signingSecret, timestamp })).toBe(false); });
});

describe('responses', () => {
    test('ephemeral shape', () => { expect(R.ephemeral('hi')).toEqual({ response_type: 'ephemeral', text: 'hi' }); });
    test('helpText lists commands', () => { expect(R.helpText()).toContain('/alianhub projects'); });
    test('projectsText empty vs list', () => {
        expect(R.projectsText([])).toContain('No active projects');
        expect(R.projectsText(['Alpha', 'Beta'])).toContain('• Alpha');
    });
});
