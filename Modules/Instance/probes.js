const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { withTimeout } = require('./health');

const PROBE_TIMEOUT_MS = 10000;
const STORAGE_ROOT = path.join(__dirname, '..', '..', 'storage');

const ok = (statusText, data) => ({ status: true, statusText, data });
const fail = (error) => ({ status: false, statusText: error?.message || String(error) });

/* Every probe reads the values it is given, falling back to the live
 * environment, so the console can test what an operator typed before saving. */
const pick = (values, key) => (values && values[key] !== undefined && values[key] !== '' ? values[key] : process.env[key]);

async function probeMail(values = {}) {
    try {
        const resendKey = pick(values, 'RESEND_API_KEY');
        if (resendKey) {
            await withTimeout(axios.get('https://api.resend.com/domains', {
                headers: { Authorization: `Bearer ${resendKey}` }, timeout: PROBE_TIMEOUT_MS,
            }), PROBE_TIMEOUT_MS, 'Resend');
            return ok('Resend API key accepted.', { provider: 'resend' });
        }
        const host = pick(values, 'NODEMAILER_HOST');
        if (!host) return fail(new Error('No mail provider configured: set SMTP (NODEMAILER_*) or RESEND_API_KEY.'));
        const port = Number(pick(values, 'NODEMAILER_PORT')) || 587;
        const transporter = nodemailer.createTransport({
            host, port, secure: port === 465,
            auth: { user: pick(values, 'NODEMAILER_EMAIL'), pass: pick(values, 'NODEMAILER_EMAIL_PASSWORD') },
            tls: { rejectUnauthorized: false },
            connectionTimeout: PROBE_TIMEOUT_MS,
        });
        await withTimeout(transporter.verify(), PROBE_TIMEOUT_MS, 'SMTP');
        return ok(`SMTP login to ${host}:${port} succeeded.`, { provider: 'smtp' });
    } catch (error) {
        return fail(error);
    }
}

async function probeStorage(values = {}) {
    try {
        const type = pick(values, 'STORAGE_TYPE') || 'server';
        if (type === 'server') {
            fs.mkdirSync(STORAGE_ROOT, { recursive: true });
            const marker = path.join(STORAGE_ROOT, `.write-test-${process.pid}`);
            fs.writeFileSync(marker, 'ok');
            fs.unlinkSync(marker);
            return ok(`Local storage at ${STORAGE_ROOT} is writable.`, { type, path: STORAGE_ROOT });
        }
        const bucket = pick(values, 'USERPROFILEBUCKET');
        if (!bucket) return fail(new Error('USERPROFILEBUCKET is not set.'));
        const client = new S3Client({
            region: pick(values, 'WASABI_REGION') || 'us-east-1',
            endpoint: pick(values, 'WASABIENDPOINT'),
            credentials: { accessKeyId: pick(values, 'WASABI_ACCESS_KEY'), secretAccessKey: pick(values, 'WASABI_SECRET_ACCESS_KEY') },
        });
        await withTimeout(client.send(new HeadBucketCommand({ Bucket: bucket })), PROBE_TIMEOUT_MS, 'Wasabi');
        return ok(`Bucket ${bucket} is reachable.`, { type, bucket });
    } catch (error) {
        return fail(error);
    }
}

const AI_ENDPOINTS = {
    openai: (values) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${pick(values, 'AI_API_KEY')}` }, key: pick(values, 'AI_API_KEY') }),
    anthropic: (values) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': pick(values, 'ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, key: pick(values, 'ANTHROPIC_API_KEY') }),
    deepseek: (values) => ({ url: `${pick(values, 'DEEPSEEK_BASE_URL') || 'https://api.deepseek.com'}/models`, headers: { Authorization: `Bearer ${pick(values, 'DEEPSEEK_API_KEY')}` }, key: pick(values, 'DEEPSEEK_API_KEY') }),
};

async function probeAi(values = {}) {
    try {
        const provider = String(pick(values, 'LLM_PROVIDER') || 'openai').toLowerCase();
        const build = AI_ENDPOINTS[provider];
        if (!build) return fail(new Error(`Unknown LLM_PROVIDER "${provider}".`));
        const { url, headers, key } = build(values);
        if (!key) return fail(new Error(`No API key set for ${provider}.`));
        await withTimeout(axios.get(url, { headers, timeout: PROBE_TIMEOUT_MS }), PROBE_TIMEOUT_MS, provider);
        return ok(`${provider} accepted the API key.`, { provider });
    } catch (error) {
        const status = error?.response?.status;
        return fail(status === 401 || status === 403 ? new Error('The provider rejected the API key.') : error);
    }
}

const PROBES = { mail: probeMail, storage: probeStorage, ai: probeAi };

module.exports = { probeMail, probeStorage, probeAi, PROBES, STORAGE_ROOT };
