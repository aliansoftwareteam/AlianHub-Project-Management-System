/* Every setting the Instance console can hold. `restart` marks a value read at
 * module load (storage driver, security middleware, cron zone); everything else
 * takes effect on save. Labels and help are English on purpose: the page
 * translates group and field names through InstanceV2.*, these are the fallback. */
const GROUPS = ['general', 'mail', 'storage', 'ai', 'auth', 'calling', 'security'];

const field = (key, group, type, extra = {}) => ({ key, group, type, secret: type === 'secret', default: '', ...extra });

const CATALOG = [
    field('APP_NAME', 'general', 'text', { default: 'AlianHub', label: 'Product name' }),
    field('WEBURL', 'general', 'text', { label: 'Public web URL', help: 'The address people open in the browser; used in emails and OAuth callbacks.' }),
    field('APIURL', 'general', 'text', { label: 'Public API URL', help: 'Usually the web URL with a trailing slash.' }),
    field('CRON_TZ', 'general', 'text', { default: 'UTC', label: 'Scheduler time zone', restart: true }),

    field('NODEMAILER_HOST', 'mail', 'text', { label: 'SMTP host' }),
    field('NODEMAILER_PORT', 'mail', 'number', { default: '587', label: 'SMTP port', help: '587 (STARTTLS) or 465 (TLS).' }),
    field('NODEMAILER_EMAIL', 'mail', 'text', { label: 'SMTP user / from address' }),
    field('NODEMAILER_EMAIL_PASSWORD', 'mail', 'secret', { label: 'SMTP password' }),
    field('RESEND_API_KEY', 'mail', 'secret', { label: 'Resend API key', help: 'When set, Resend is used instead of SMTP.' }),
    field('RESEND_FROM_EMAIL', 'mail', 'text', { label: 'Resend from address' }),

    field('STORAGE_TYPE', 'storage', 'select', { default: 'server', options: ['server', 'wasabi'], label: 'Storage driver', restart: true }),
    field('WASABI_ACCESS_KEY', 'storage', 'text', { label: 'Wasabi access key', restart: true }),
    field('WASABI_SECRET_ACCESS_KEY', 'storage', 'secret', { label: 'Wasabi secret key', restart: true }),
    field('WASABI_USERID', 'storage', 'text', { label: 'Wasabi user id', restart: true }),
    field('WASABIENDPOINT', 'storage', 'text', { default: 'https://s3.wasabisys.com', label: 'S3 endpoint', restart: true }),
    field('WASABI_REGION', 'storage', 'text', { default: 'us-east-1', label: 'Region', restart: true }),
    field('IAM_ENDPOINT', 'storage', 'text', { default: 'https://iam.wasabisys.com', label: 'IAM endpoint', restart: true }),
    field('USERPROFILEBUCKET', 'storage', 'text', { label: 'Public assets bucket', restart: true }),

    field('LLM_PROVIDER', 'ai', 'select', { default: 'openai', options: ['openai', 'anthropic', 'deepseek'], label: 'Provider' }),
    field('AI_API_KEY', 'ai', 'secret', { label: 'OpenAI API key' }),
    field('AI_MODEL', 'ai', 'text', { default: 'gpt-4.1', label: 'OpenAI model' }),
    field('ANTHROPIC_API_KEY', 'ai', 'secret', { label: 'Anthropic API key' }),
    field('ANTHROPIC_MODEL', 'ai', 'text', { default: 'claude-sonnet-4-5-20250929', label: 'Anthropic model' }),
    field('DEEPSEEK_API_KEY', 'ai', 'secret', { label: 'DeepSeek API key' }),
    field('DEEPSEEK_MODEL', 'ai', 'text', { default: 'deepseek-v4-flash', label: 'DeepSeek model' }),

    field('GOOGLE_LOGIN_ENABLED', 'auth', 'boolean', { default: 'false', label: 'Google sign-in' }),
    field('GOOGLE_CLIENT_ID', 'auth', 'text', { label: 'Google client id', public: true }),
    field('GOOGLE_CLIENT_SECRET', 'auth', 'secret', { label: 'Google client secret' }),
    field('GITHUB_LOGIN_ENABLED', 'auth', 'boolean', { default: 'false', label: 'GitHub sign-in' }),
    field('GITHUB_CLIENT_ID', 'auth', 'text', { label: 'GitHub client id', public: true }),
    field('GITHUB_CLIENT_SECRET', 'auth', 'secret', { label: 'GitHub client secret' }),
    field('GITHUB_BASE_OAUTH_URL', 'auth', 'text', { default: 'https://github.com/login/oauth', label: 'GitHub OAuth base URL', public: true }),
    field('GITLAB_LOGIN_ENABLED', 'auth', 'boolean', { default: 'false', label: 'GitLab sign-in' }),
    field('GITLAB_CLIENT_ID', 'auth', 'text', { label: 'GitLab client id', public: true }),
    field('GITLAB_CLIENT_SECRET', 'auth', 'secret', { label: 'GitLab client secret' }),
    field('GITLAB_BASE_OAUTH_URL', 'auth', 'text', { default: 'https://gitlab.com/oauth', label: 'GitLab OAuth base URL', public: true }),
    field('SSO_LOGIN_ENABLED', 'auth', 'boolean', { default: 'true', label: 'Show "Continue with SSO" on the login page' }),

    field('STUN_URLS', 'calling', 'text', { default: 'stun:stun.l.google.com:19302', label: 'STUN servers' }),
    field('TURN_URLS', 'calling', 'text', { label: 'TURN servers', help: 'Comma-separated, e.g. turn:turn.example.com:3478' }),
    field('TURN_STATIC_AUTH_SECRET', 'calling', 'secret', { label: 'TURN static auth secret' }),
    field('TURN_USERNAME', 'calling', 'text', { label: 'TURN username (fallback)' }),
    field('TURN_PASSWORD', 'calling', 'secret', { label: 'TURN password (fallback)' }),

    field('TRUST_PROXY', 'security', 'text', { default: 'loopback', label: 'Trusted proxies', help: '"loopback", a hop count such as "1", or "true" behind any proxy.', restart: true }),
    field('GLOBAL_RATE_LIMIT_PER_MIN', 'security', 'number', { default: '1000', label: 'API requests per minute per IP', help: '0 turns the limit off.', restart: true }),
    field('HELMET_ENABLED', 'security', 'boolean', { default: 'true', label: 'Security response headers', restart: true }),
];

const byKey = new Map(CATALOG.map((f) => [f.key, f]));

const isBooleanString = (v) => ['true', 'false'].includes(String(v));

/* Pure: turns a PUT body into the values to store, or the problems with it.
 * `{set:true}` is the mask the GET returns for a secret; sending it back means
 * "leave it alone". An empty string clears a value. */
function validateSettings(patch = {}) {
    const values = {};
    const errors = {};
    for (const [key, raw] of Object.entries(patch)) {
        const def = byKey.get(key);
        if (!def) { errors[key] = 'unknown'; continue; }
        if (raw && typeof raw === 'object' && raw.set === true) continue;
        if (raw === null || raw === undefined) { values[key] = ''; continue; }
        const value = String(raw).trim();
        if (value === '') { values[key] = ''; continue; }
        if (def.type === 'number' && !/^\d+$/.test(value)) { errors[key] = 'number'; continue; }
        if (def.type === 'boolean' && !isBooleanString(value)) { errors[key] = 'boolean'; continue; }
        if (def.type === 'select' && !def.options.includes(value)) { errors[key] = 'option'; continue; }
        values[key] = value;
    }
    return { values, errors, valid: Object.keys(errors).length === 0 };
}

/* Pure: what the page shows. A secret never leaves the server; the page learns
 * only whether one is set and where the effective value comes from. */
function describeSettings({ saved = {}, env = {}, locked = [] }) {
    const lockedSet = new Set(locked);
    return CATALOG.map((def) => {
        const fromEnv = lockedSet.has(def.key) ? env[def.key] : undefined;
        const fromSaved = saved[def.key];
        const source = fromEnv !== undefined && fromEnv !== '' ? 'env'
            : fromSaved !== undefined && fromSaved !== '' ? 'saved'
                : def.default !== '' ? 'default' : 'unset';
        const effective = source === 'env' ? fromEnv : source === 'saved' ? fromSaved : def.default;
        const value = def.secret ? (source === 'unset' ? { set: false } : { set: true }) : effective;
        return {
            key: def.key, group: def.group, type: def.type, secret: def.secret, label: def.label, help: def.help || '',
            options: def.options || null, default: def.default, restart: Boolean(def.restart), public: Boolean(def.public),
            value, source, locked: source === 'env',
        };
    });
}

module.exports = { GROUPS, CATALOG, byKey, validateSettings, describeSettings };
