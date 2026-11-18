const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { SESClient, GetSendQuotaCommand, GetIdentityVerificationAttributesCommand } = require('@aws-sdk/client-ses');
const { SES_KEYS, mailProvider } = require('../mailProvider');
const { resolveS3Config, prefixProblem } = require('../../common-storage/s3Config');
const { withTimeout } = require('./health');
const compatibleClient = require('../AICore/llmProvider/compatibleClient');
const hostingMode = require('../../Config/hostingMode');

const PROBE_TIMEOUT_MS = 10000;
/* DigitalOcean drops these on every Droplet, so on a hosted instance a timeout there is the
 * provider's block, not a slow server. */
const BLOCKED_SMTP_PORTS = [25, 465, 587];
const SMTP_PORT_BLOCKED = "Our hosting provider blocks this port. Use Amazon SES or Resend, or your provider's alternate port, such as 2525.";
const STORAGE_ROOT = path.join(__dirname, '..', '..', 'storage');
const MAIL_KEYS = [...SES_KEYS, 'AWS_SES_FROM_DEFAULT', 'RESEND_API_KEY', 'NODEMAILER_HOST'];
/* A new SES account may send 200 mails a day, only to verified addresses, until AWS grants production access. */
const SES_SANDBOX_DAILY = 200;
const SES_KEY_PROBLEMS = {
    InvalidClientTokenId: 'AWS does not recognise this access key ID: it was deleted, deactivated or mistyped.',
    UnrecognizedClientException: 'AWS does not recognise this access key ID: it was deleted, deactivated or mistyped.',
    SignatureDoesNotMatch: 'The secret access key does not match this access key ID.',
};
const isAccessDenied = (error) => ['AccessDenied', 'AccessDeniedException'].includes(error?.name);

const ok = (statusText, data) => ({ status: true, statusText, data });
const fail = (error) => ({ status: false, statusText: error?.message || String(error) });

/* Every probe reads the values it is given, falling back to the live
 * environment, so the console can test what an operator typed before saving. */
const pick = (values, key) => (values && values[key] !== undefined && values[key] !== '' ? values[key] : process.env[key]);

const isTimeout = (error) => error?.code === 'ETIMEDOUT' || /timed? ?out/i.test(error?.message || '');

/* Read-only calls, so Test never sends a mail. A key allowed only to send answers AccessDenied, which
 * still proves AWS accepted it; the sandbox and sender checks are then skipped. */
async function probeSes(env) {
    const from = env.AWS_SES_FROM_DEFAULT;
    if (!from) return fail(new Error('Set the Amazon SES from address.'));
    const client = new SESClient({
        region: env.AWS_SES_REGION,
        credentials: { accessKeyId: env.AWS_SES_KEY, secretAccessKey: env.AWS_SES_SECRET },
        maxAttempts: 1,
    });
    let quota = null;
    try {
        quota = await withTimeout(client.send(new GetSendQuotaCommand({})), PROBE_TIMEOUT_MS, 'Amazon SES');
    } catch (error) {
        if (!isAccessDenied(error)) return fail(SES_KEY_PROBLEMS[error?.name] ? new Error(SES_KEY_PROBLEMS[error.name]) : error);
        return ok('Amazon SES key accepted. It may not read the sending quota, so the sandbox and sender checks were skipped.', { provider: 'ses', sandbox: null });
    }
    const domain = String(from).split('@').pop();
    try {
        const { VerificationAttributes = {} } = await withTimeout(client.send(new GetIdentityVerificationAttributesCommand({ Identities: [from, domain] })), PROBE_TIMEOUT_MS, 'Amazon SES');
        const verified = [from, domain].some((identity) => VerificationAttributes[identity]?.VerificationStatus === 'Success');
        if (!verified) return fail(new Error(`${from} is not verified in Amazon SES: verify the address or its domain ${domain} in the SES console.`));
    } catch (error) {
        if (!isAccessDenied(error)) return fail(error);
    }
    const sandbox = Number(quota.Max24HourSend) <= SES_SANDBOX_DAILY;
    return ok(
        sandbox ? 'Amazon SES key accepted. The account is in the SES sandbox: it sends only to verified addresses until AWS grants production access.' : 'Amazon SES key accepted.',
        { provider: 'ses', sandbox, max24HourSend: quota.Max24HourSend },
    );
}

async function probeMail(values = {}) {
    let port = null;
    try {
        const env = Object.fromEntries(MAIL_KEYS.map((key) => [key, pick(values, key)]));
        const provider = mailProvider(env);
        if (provider === 'ses') return await probeSes(env);
        if (provider === 'resend') {
            await withTimeout(axios.get('https://api.resend.com/domains', {
                headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, timeout: PROBE_TIMEOUT_MS,
            }), PROBE_TIMEOUT_MS, 'Resend');
            return ok('Resend API key accepted.', { provider: 'resend' });
        }
        const host = env.NODEMAILER_HOST;
        if (!host) return fail(new Error('No mail provider configured: set Amazon SES (AWS_SES_*), RESEND_API_KEY or SMTP (NODEMAILER_*).'));
        port = Number(pick(values, 'NODEMAILER_PORT')) || 587;
        const transporter = nodemailer.createTransport({
            host, port, secure: port === 465,
            auth: { user: pick(values, 'NODEMAILER_USER') || pick(values, 'NODEMAILER_EMAIL'), pass: pick(values, 'NODEMAILER_EMAIL_PASSWORD') },
            tls: { rejectUnauthorized: false },
            connectionTimeout: PROBE_TIMEOUT_MS,
        });
        await withTimeout(transporter.verify(), PROBE_TIMEOUT_MS, 'SMTP');
        return ok(`SMTP login to ${host}:${port} succeeded.`, { provider: 'smtp' });
    } catch (error) {
        if (port && BLOCKED_SMTP_PORTS.includes(port) && hostingMode.isManaged() && isTimeout(error)) return { ...fail(new Error(SMTP_PORT_BLOCKED)), data: { code: 'smtp_port_blocked', port } };
        return fail(error);
    }
}

/* The console's Test button writes, reads back and deletes an object under the prefix (roundTrip);
 * the health page only checks the bucket or prefix can be reached, and writes nothing. */
async function probeStorage(values = {}, { roundTrip = true } = {}) {
    try {
        const type = pick(values, 'STORAGE_TYPE') || 'server';
        if (type === 'server') {
            fs.mkdirSync(STORAGE_ROOT, { recursive: true });
            const marker = path.join(STORAGE_ROOT, `.write-test-${process.pid}`);
            fs.writeFileSync(marker, 'ok');
            fs.unlinkSync(marker);
            return ok(`Local storage at ${STORAGE_ROOT} is writable.`, { type, path: STORAGE_ROOT });
        }
        const typed = Object.fromEntries(Object.entries(values || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''));
        const cfg = resolveS3Config({ ...process.env, ...typed });
        const bucket = cfg.prefixMode ? cfg.bucket : cfg.profileBucket;
        if (!bucket) return fail(new Error('Set S3_BUCKET (one bucket for everything), or USERPROFILEBUCKET for a bucket per workspace.'));
        if (prefixProblem(cfg.prefix)) return fail(new Error('S3_PREFIX may not contain empty, "." or ".." parts.'));
        const { buildS3Client } = require('../../common-storage/s3Client');
        const { layoutOf } = require('../../common-storage/s3Layout');
        const { storeOf } = require('../../common-storage/s3Store');
        const client = buildS3Client(cfg);
        const store = storeOf({ client: () => client, layout: () => layoutOf(cfg), counter: null });
        const where = cfg.prefixMode && cfg.prefix ? `${bucket}/${cfg.prefix}` : bucket;
        if (roundTrip) {
            await withTimeout(store.roundTrip(), PROBE_TIMEOUT_MS, 'Storage');
            return ok(`Wrote, read back and deleted a test object in ${where}.`, { type, bucket, prefix: cfg.prefix, roundTrip: true });
        }
        await withTimeout(store.reach(), PROBE_TIMEOUT_MS, 'Storage');
        return ok(`Bucket ${where} is reachable.`, { type, bucket, ...(cfg.prefixMode ? { prefix: cfg.prefix } : {}) });
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
