const mockSend = jest.fn();
jest.mock('@aws-sdk/client-ses', () => {
    class Command { constructor(input) { this.input = input; } }
    return {
        SESClient: jest.fn().mockImplementation((options) => ({ config: { region: options.region }, options, send: mockSend })),
        SendRawEmailCommand: class SendRawEmailCommand extends Command {},
        GetSendQuotaCommand: class GetSendQuotaCommand extends Command {},
        GetIdentityVerificationAttributesCommand: class GetIdentityVerificationAttributesCommand extends Command {},
    };
});
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../Modules/Entitlements/mailCap', () => ({ holdForTomorrow: jest.fn(async () => false) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const axios = require('axios');
const { SESClient } = require('@aws-sdk/client-ses');
const { mailProvider, mailConfigured, fromHeader, mailTransport } = require('../Modules/mailProvider');
const service = require('../Modules/service');
const { probeMail } = require('../Modules/Instance/probes');

const MAIL_ENV = ['AWS_SES_KEY', 'AWS_SES_SECRET', 'AWS_SES_REGION', 'AWS_SES_FROM_DEFAULT', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
    'NODEMAILER_HOST', 'NODEMAILER_PORT', 'NODEMAILER_EMAIL', 'NODEMAILER_USER', 'NODEMAILER_EMAIL_PASSWORD', 'APP_NAME'];
const saved = Object.fromEntries(MAIL_ENV.map((key) => [key, process.env[key]]));
const SES = { AWS_SES_KEY: 'AKIATEST', AWS_SES_SECRET: 'secret', AWS_SES_REGION: 'us-east-1', AWS_SES_FROM_DEFAULT: 'noreply@alianhub.com' };

const useEnv = (values) => {
    MAIL_ENV.forEach((key) => delete process.env[key]);
    Object.assign(process.env, values);
};
const call = (fn, ...args) => new Promise((resolve) => fn(...args, resolve));
const sentCommand = () => mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
const rawMessage = () => sentCommand().input.RawMessage.Data.toString();
const awsError = (name) => Object.assign(new Error(name), { name });

beforeEach(() => {
    mockSend.mockReset();
    axios.post.mockReset();
    useEnv({});
});
afterAll(() => {
    MAIL_ENV.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; });
});

describe('which provider sends', () => {
    it('prefers SES, then Resend, then SMTP, and needs all three SES values', () => {
        const all = { ...SES, RESEND_API_KEY: 're_x', NODEMAILER_HOST: 'smtp.example.com' };
        expect(mailProvider(all)).toBe('ses');
        expect(mailProvider({ ...all, AWS_SES_REGION: '' })).toBe('resend');
        expect(mailProvider({ NODEMAILER_HOST: 'smtp.example.com', AWS_SES_KEY: 'AKIATEST' })).toBe('smtp');
        expect(mailProvider({})).toBeNull();
    });

    it('counts mail as configured only with a from address for the chosen provider', () => {
        expect(mailConfigured(SES)).toBe(true);
        expect(mailConfigured({ ...SES, AWS_SES_FROM_DEFAULT: '' })).toBe(false);
        expect(mailConfigured({ RESEND_API_KEY: 're_x', NODEMAILER_EMAIL: 'hi@example.com' })).toBe(true);
        expect(mailConfigured({ NODEMAILER_HOST: 'smtp.example.com' })).toBe(false);
        expect(mailConfigured({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_EMAIL: 'hi@example.com' })).toBe(true);
    });

    it('signs SES mail with the product name and keeps the SMTP sender as before', () => {
        expect(fromHeader('ses', { ...SES, APP_NAME: 'AlianHub' })).toEqual({ name: 'AlianHub', address: 'noreply@alianhub.com' });
        expect(fromHeader('ses', SES)).toBe('noreply@alianhub.com');
        expect(fromHeader('smtp', { NODEMAILER_EMAIL: 'hi@example.com' })).toBe('<hi@example.com>');
    });

    it('builds the SMTP transport from NODEMAILER_* when nothing else is set', () => {
        const transport = mailTransport({ NODEMAILER_HOST: 'smtp.example.com', NODEMAILER_PORT: '465', NODEMAILER_EMAIL: 'hi@example.com' });
        expect(transport.transporter.name).toBe('SMTP');
        expect(transport.transporter.options).toMatchObject({ host: 'smtp.example.com', secure: true, auth: { user: 'hi@example.com' } });
    });
});

describe('sending through Amazon SES', () => {
    beforeEach(() => useEnv({ ...SES, APP_NAME: 'AlianHub' }));

    it('sends a plain email with the SES region and keys', async () => {
        mockSend.mockResolvedValue({ MessageId: 'ses-1' });
        const result = await call(service.SendEmail, 'Welcome', '<p>Hello</p>', 'harmit@example.com', true);
        expect(result.status).toBe(true);
        expect(result.data.response).toBe('ses-1');
        expect(sentCommand().constructor.name).toBe('SendRawEmailCommand');
        expect(sentCommand().input).toMatchObject({ Source: 'noreply@alianhub.com', Destinations: ['harmit@example.com'] });
        expect(rawMessage()).toMatch(/^From: AlianHub <noreply@alianhub\.com>/m);
        expect(rawMessage()).toMatch(/^Subject: Welcome/m);
        expect(SESClient).toHaveBeenLastCalledWith({ region: 'us-east-1', credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' } });
    });

    it('keeps notification recipients in BCC, out of the headers', async () => {
        mockSend.mockResolvedValue({ MessageId: 'ses-2' });
        const result = await call(service.SendNotificationEmail, 'Update', '<p>News</p>', ['A@Example.com', 'b@example.com'], true);
        expect(result.status).toBe(true);
        expect(sentCommand().input.Destinations).toEqual(['a@example.com', 'b@example.com']);
        expect(rawMessage()).not.toMatch(/^Bcc:/m);
    });

    it('attaches files', async () => {
        mockSend.mockResolvedValue({ MessageId: 'ses-3' });
        const result = await call(service.sendAttachMail, 'Report', '<p>See file</p>', 'harmit@example.com', [{ filename: 'report.csv', content: Buffer.from('a,b\n1,2') }]);
        expect(result.status).toBe(true);
        expect(rawMessage()).toMatch(/filename=report\.csv/);
        expect(rawMessage()).toContain(Buffer.from('a,b\n1,2').toString('base64'));
    });

    it('reports a refused send through the callback', async () => {
        mockSend.mockRejectedValue(new Error('Email address is not verified.'));
        const result = await call(service.SendEmail, 'Welcome', '<p>Hello</p>', 'harmit@example.com', true);
        expect(result).toEqual({ status: false, error: 'Email address is not verified.' });
    });

    it('builds a new client when the keys change', () => {
        mailTransport(SES);
        const calls = SESClient.mock.calls.length;
        mailTransport(SES);
        expect(SESClient.mock.calls.length).toBe(calls);
        mailTransport({ ...SES, AWS_SES_KEY: 'AKIAOTHER' });
        expect(SESClient.mock.calls.length).toBe(calls + 1);
    });
});

describe('sending through Resend', () => {
    beforeEach(() => useEnv({ RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'AlianHub <notifications@alianhub.com>' }));

    it('posts the email to the Resend API', async () => {
        axios.post.mockResolvedValue({ data: { id: 'rs-1' } });
        const result = await call(service.SendEmail, 'Welcome', '<p>Hello</p>', 'harmit@example.com', true);
        expect(result.status).toBe(true);
        expect(result.data.messageId).toBe('rs-1');
        expect(axios.post).toHaveBeenCalledWith('https://api.resend.com/emails', {
            from: 'AlianHub <notifications@alianhub.com>',
            to: ['harmit@example.com'],
            subject: 'Welcome',
            html: '<p>Hello</p>',
        }, expect.objectContaining({ headers: { Authorization: 'Bearer re_test' } }));
    });

    it('addresses a BCC-only notice to the sender', async () => {
        axios.post.mockResolvedValue({ data: { id: 'rs-2' } });
        await call(service.SendNotificationEmail, 'Update', '<p>News</p>', ['a@example.com'], true);
        expect(axios.post.mock.calls[0][1]).toMatchObject({ to: ['AlianHub <notifications@alianhub.com>'], bcc: ['a@example.com'] });
    });

    it('sends attachments as base64', async () => {
        axios.post.mockResolvedValue({ data: { id: 'rs-3' } });
        await call(service.sendAttachMail, 'Report', '<p>See file</p>', 'harmit@example.com', [{ filename: 'report.csv', content: Buffer.from('a,b'), contentType: 'text/csv' }]);
        expect(axios.post.mock.calls[0][1].attachments).toEqual([{ filename: 'report.csv', content: Buffer.from('a,b').toString('base64'), content_type: 'text/csv' }]);
    });

    it('passes Resend’s own message on a refusal', async () => {
        axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), { response: { data: { message: 'The domain is not verified.' } } }));
        const result = await call(service.SendEmail, 'Welcome', '<p>Hello</p>', 'harmit@example.com', true);
        expect(result).toEqual({ status: false, error: 'The domain is not verified.' });
    });
});

describe('the mail Test button with Amazon SES', () => {
    const answer = (byCommand) => mockSend.mockImplementation(async (command) => {
        const reply = byCommand[command.constructor.name];
        if (reply instanceof Error) throw reply;
        return reply;
    });
    const verified = { VerificationAttributes: { 'alianhub.com': { VerificationStatus: 'Success' } } };

    it('accepts a working key and says when the account is in the sandbox', async () => {
        answer({ GetSendQuotaCommand: { Max24HourSend: 200 }, GetIdentityVerificationAttributesCommand: verified });
        const result = await probeMail(SES);
        expect(result.status).toBe(true);
        expect(result.data).toEqual({ provider: 'ses', sandbox: true, max24HourSend: 200 });
        expect(result.statusText).toMatch(/sandbox/);
        expect(sentCommand().input).toEqual({ Identities: ['noreply@alianhub.com', 'alianhub.com'] });
    });

    it('accepts a production account without the sandbox note', async () => {
        answer({ GetSendQuotaCommand: { Max24HourSend: 50000 }, GetIdentityVerificationAttributesCommand: verified });
        expect(await probeMail(SES)).toEqual({ status: true, statusText: 'Amazon SES key accepted.', data: { provider: 'ses', sandbox: false, max24HourSend: 50000 } });
    });

    it('explains a key AWS does not know and a wrong secret', async () => {
        answer({ GetSendQuotaCommand: awsError('InvalidClientTokenId') });
        expect(await probeMail(SES)).toEqual({ status: false, statusText: 'AWS does not recognise this access key ID: it was deleted, deactivated or mistyped.' });
        answer({ GetSendQuotaCommand: awsError('SignatureDoesNotMatch') });
        expect((await probeMail(SES)).statusText).toBe('The secret access key does not match this access key ID.');
    });

    it('treats a send-only key as accepted and skips the checks it may not run', async () => {
        answer({ GetSendQuotaCommand: awsError('AccessDenied') });
        const result = await probeMail(SES);
        expect(result.status).toBe(true);
        expect(result.data).toEqual({ provider: 'ses', sandbox: null });
    });

    it('refuses a from address on an unverified domain', async () => {
        answer({ GetSendQuotaCommand: { Max24HourSend: 50000 }, GetIdentityVerificationAttributesCommand: { VerificationAttributes: {} } });
        expect((await probeMail(SES)).statusText).toBe('noreply@alianhub.com is not verified in Amazon SES: verify the address or its domain alianhub.com in the SES console.');
    });

    it('asks for a from address before calling AWS', async () => {
        expect(await probeMail({ ...SES, AWS_SES_FROM_DEFAULT: '' })).toEqual({ status: false, statusText: 'Set the Amazon SES from address.' });
        expect(mockSend).not.toHaveBeenCalled();
    });
});
