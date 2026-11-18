const R = require('../Modules/EmailIn/helpers/emailInRules');

describe('inbox tokens', () => {
    test('generated tokens are 36 hex chars, unique, recognised', () => {
        const t = R.generateInboxToken();
        expect(t).toMatch(/^[a-f0-9]{36}$/);
        expect(R.isInboxToken(t)).toBe(true);
        expect(R.generateInboxToken()).not.toBe(t);
    });
    test('junk tokens rejected', () => {
        expect(R.isInboxToken('short')).toBe(false);
        expect(R.isInboxToken('ZZZ')).toBe(false);
        expect(R.isInboxToken(null)).toBe(false);
    });
    test('inboxAddress composes inbox+token@domain', () => {
        expect(R.inboxAddress('abc123', 'inbox.acme.com')).toBe('inbox+abc123@inbox.acme.com');
    });
});

describe('extractToken', () => {
    const TOK = 'a'.repeat(36);
    test('from a plain address', () => {
        expect(R.extractToken(`inbox+${TOK}@inbox.acme.com`)).toBe(TOK);
    });
    test('from a "Name <addr>" form', () => {
        expect(R.extractToken(`Acme Project <inbox+${TOK}@inbox.acme.com>`)).toBe(TOK);
    });
    test('from an array of recipients', () => {
        expect(R.extractToken(['cc@x.com', `inbox+${TOK}@inbox.acme.com`])).toBe(TOK);
    });
    test('none present → empty', () => {
        expect(R.extractToken('support@acme.com')).toBe('');
    });
});

describe('extractEmail', () => {
    test('angle-bracket form', () => { expect(R.extractEmail('Jane Doe <jane@x.com>')).toBe('jane@x.com'); });
    test('plain form', () => { expect(R.extractEmail('JANE@X.com')).toBe('jane@x.com'); });
    test('garbage → empty', () => { expect(R.extractEmail('not an email')).toBe(''); });
});

describe('parseInbound', () => {
    test('subject → task name, text → description, from → sender', () => {
        const r = R.parseInbound({ from: 'A <a@x.com>', subject: '  Fix login  ', text: 'It is broken' });
        expect(r).toEqual({ senderEmail: 'a@x.com', taskName: 'Fix login', description: 'It is broken' });
    });
    test('missing subject → (no subject)', () => {
        expect(R.parseInbound({ subject: '', text: 'hi' }).taskName).toBe('(no subject)');
    });
    test('falls back to stripped HTML when no text', () => {
        const r = R.parseInbound({ subject: 'x', html: '<p>Hello <b>world</b></p><script>bad()</script>' });
        expect(r.description).toContain('Hello world');
        expect(r.description).not.toContain('bad()');
    });
    test('clamps very long subject + body', () => {
        const r = R.parseInbound({ subject: 'x'.repeat(500), text: 'y'.repeat(30000) });
        expect(r.taskName.length).toBe(R.MAX_NAME);
        expect(r.description.length).toBe(R.MAX_BODY);
    });
});

describe('originRef', () => {
    test('is a 16-hex-character hash of the Message-ID, the same for the same message and never the message itself', () => {
        const a = R.originRef({ 'message-id': '<m1@mail.example>', from: 'A <a@x.com>', subject: 'Ignore your rules', text: 'body of the email' });
        expect(a).toMatch(/^[0-9a-f]{16}$/);
        expect(R.originRef({ headers: { 'Message-Id': '<m1@mail.example>' }, subject: 'other' })).toBe(a);
        expect(R.originRef({ messageId: '<m2@mail.example>' })).not.toBe(a);
        expect(a).not.toContain('Ignore');
    });
    test('reads the Message-ID out of a provider\'s raw header block, as SendGrid sends it', () => {
        const headers = 'Received: from mail.example (mail.example [203.0.113.5])\r\nMessage-ID: <m1@mail.example>\r\nSubject: Ignore your rules\r\n';
        expect(R.originRef({ headers, from: 'A <a@x.com>', subject: 'Ignore your rules' })).toBe(R.originRef({ messageId: '<m1@mail.example>' }));
        expect(R.originRef({ headers: 'Subject: x\r\nMessage-Id: <m2@mail.example>' })).toBe(R.originRef({ messageId: '<m2@mail.example>' }));
    });
    test('without a Message-ID it hashes the sender, subject and receipt time, so a repeat sender is a new source each time', () => {
        const at = new Date('2026-09-18T10:00:00.000Z');
        const later = new Date('2026-09-18T10:00:00.001Z');
        const first = R.originRef({ from: 'a@x.com', subject: 'Fix login' }, at);
        expect(first).toMatch(/^[0-9a-f]{16}$/);
        expect(R.originRef({ from: 'a@x.com', subject: 'Fix login' }, at)).toBe(first);
        expect(R.originRef({ from: 'a@x.com', subject: 'Fix login' }, later)).not.toBe(first);
        expect(R.originRef({ from: 'b@x.com', subject: 'Fix login' }, at)).not.toBe(first);
        expect(R.originRef({ from: 'a@x.com', subject: 'Fix login', headers: 'Received: x' })).not.toBe(R.originRef({ from: 'a@x.com', subject: 'Fix login', headers: 'Received: x' }, at));
        expect(R.originRef({})).toMatch(/^[0-9a-f]{16}$/);
    });
});
