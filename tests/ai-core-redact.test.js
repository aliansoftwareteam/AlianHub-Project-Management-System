const { redact, redactMessages } = require('../Modules/AICore/redact');

const MASK = '[redacted]';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('redact masks what must not sit in a replay record', () => {
    it.each([
        ['an email address', 'Reach sam.lee+ops@example.co.uk about the launch', 'sam.lee+ops@example.co.uk'],
        ['a bearer token', 'Authorization: Bearer abc123.DEF456-ghi789_jkl', 'abc123.DEF456-ghi789_jkl'],
        ['an OpenAI-style key', 'key is sk-proj-AbCdEf0123456789GhIjKl here', 'sk-proj-AbCdEf0123456789GhIjKl'],
        ['an Anthropic key', 'sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2', 'sk-ant-api03-Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2'],
        ['a GitHub token', 'token ghp_1234567890abcdefghijABCDEFGHIJ123456', 'ghp_1234567890abcdefghijABCDEFGHIJ123456'],
        ['a GitHub fine-grained token', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
        ['a Slack token', 'slack xoxb-1234567890-0987654321-AbCdEfGhIjKl', 'xoxb-1234567890-0987654321-AbCdEfGhIjKl'],
        ['a JWT', `session ${JWT} ends`, JWT],
        ['a long hex secret', 'secret a3f5c7e9b1d2046813579bdf02468ace13579bdf done', 'a3f5c7e9b1d2046813579bdf02468ace13579bdf'],
        ['a long base64 secret', 'blob QWxhZGRpbjpvcGVuIHNlc2FtZQ9kZXZlbG9wZXJTZWNyZXQ= end', 'QWxhZGRpbjpvcGVuIHNlc2FtZQ9kZXZlbG9wZXJTZWNyZXQ='],
    ])('%s', (name, input, secret) => {
        const out = redact(input);
        expect(out).not.toContain(secret);
        expect(out).toContain(MASK);
    });

    it.each(['password', 'db_password', 'clientSecret', 'accessToken', 'apiKey', 'api_key', 'X-Api-Key'])('the value of a JSON key named %s', (key) => {
        const out = redact(`{"${key}": "hunter2", "title": "Launch plan"}`);
        expect(out).toBe(`{"${key}": "${MASK}", "title": "Launch plan"}`);
    });

    it('a JSON secret nested in an escaped string', () => {
        const out = redact(JSON.stringify({ context: JSON.stringify({ password: 'hunter2', name: 'Ops' }) }));
        expect(out).not.toContain('hunter2');
        expect(out).toContain('Ops');
    });

    it('leaves ordinary prose, ids, numbers and URLs alone', () => {
        const text = 'Task AR-12 in project 6f0000000000000000000c01 costs $12.50; see https://example.com/docs/getting-started and "maxTokens": 800';
        expect(redact(text)).toBe(text);
    });

    it('passes non-strings through and redacts every message content', () => {
        expect(redact(null)).toBe(null);
        expect(redact(42)).toBe(42);
        expect(redactMessages([{ role: 'user', content: 'mail ops@example.com' }, { role: 'assistant', content: 'ok' }])).toEqual([
            { role: 'user', content: `mail ${MASK}` }, { role: 'assistant', content: 'ok' },
        ]);
    });
});
