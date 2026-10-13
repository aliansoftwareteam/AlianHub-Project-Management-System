const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { withTimeout } = require('./health');
const compatibleClient = require('../AICore/llmProvider/compatibleClient');

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

const openaiBase = (values) => String(pick(values, 'OPENAI_BASE_URL') || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');

const AI_ENDPOINTS = {
    openai: (values) => ({ url: `${openaiBase(values)}/models`, headers: { Authorization: `Bearer ${pick(values, 'AI_API_KEY')}` }, key: pick(values, 'AI_API_KEY') }),
    anthropic: (values) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': pick(values, 'ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' }, key: pick(values, 'ANTHROPIC_API_KEY') }),
    deepseek: (values) => ({ url: `${pick(values, 'DEEPSEEK_BASE_URL') || 'https://api.deepseek.com'}/models`, headers: { Authorization: `Bearer ${pick(values, 'DEEPSEEK_API_KEY')}` }, key: pick(values, 'DEEPSEEK_API_KEY') }),
};

const modelIdsOf = (data) => (Array.isArray(data && data.data) ? data.data.map((row) => row && row.id).filter((id) => typeof id === 'string') : []);

/* The owner's own endpoint, often on loopback or the LAN: reached only through the dedicated
 * client, which allows private addresses for this one configured URL and nothing else. */
async function probeCompatible(values) {
    const baseUrl = pick(values, 'OPENAI_COMPATIBLE_BASE_URL');
    if (!baseUrl) return fail(new Error('Set the base URL of the OpenAI-compatible server first, e.g. http://localhost:11434/v1 for Ollama.'));
    try {
        const { models } = await compatibleClient.listModels({ baseUrl, apiKey: pick(values, 'OPENAI_COMPATIBLE_API_KEY'), timeoutMs: PROBE_TIMEOUT_MS });
        return ok(`Connected: the endpoint serves ${models.length} model${models.length === 1 ? '' : 's'}.`, { provider: 'openai_compatible', models });
    } catch (error) {
        return fail(new Error(compatibleClient.describeFailure(error, { timeoutMs: PROBE_TIMEOUT_MS })));
    }
}

async function probeAi(values = {}) {
    const provider = String(pick(values, 'LLM_PROVIDER') || 'openai').toLowerCase();
    if (provider === 'openai_compatible') return probeCompatible(values);
    try {
        const build = AI_ENDPOINTS[provider];
        if (!build) return fail(new Error(`Unknown LLM_PROVIDER "${provider}".`));
        const { url, headers, key } = build(values);
        if (!key) return fail(new Error(`No API key set for ${provider}.`));
        const response = await withTimeout(axios.get(url, { headers, timeout: PROBE_TIMEOUT_MS }), PROBE_TIMEOUT_MS, provider);
        return ok(`${provider} accepted the API key.`, { provider, models: modelIdsOf(response && response.data) });
    } catch (error) {
        const status = error?.response?.status;
        return fail(status === 401 || status === 403 ? new Error('The provider rejected the API key.') : error);
    }
}

const PROBES = { mail: probeMail, storage: probeStorage, ai: probeAi };

module.exports = { probeMail, probeStorage, probeAi, PROBES, STORAGE_ROOT };
