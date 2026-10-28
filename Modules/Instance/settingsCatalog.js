/* Every setting the Instance console can hold. `restart` marks a value read at
 * module load (storage driver, security middleware, cron zone); everything else
 * takes effect on save. Labels and help are English on purpose: the page
 * translates group and field names through InstanceV2.*, these are the fallback.
 * `legacy` fields are shown only while they hold a value: an older name a newer field replaces. */
const { allowlistError } = require('../Webhooks/helpers/privateHostAllowlist');
const { baseUrlError } = require('../AICore/llmProvider/compatibleClient');
const { prefixProblem } = require('../../common-storage/s3Config');

const GROUPS = ['general', 'mail', 'storage', 'ai', 'auth', 'calling', 'security'];

/* Who sets a group on a hosted instance (HOSTING_MODE=managed); a field's own `owner` overrides
 * its group. Self-hosted, the owner sets everything and this is not consulted. */
const GROUP_OWNER = Object.freeze({ general: 'platform', mail: 'platform', storage: 'platform', ai: 'customer', auth: 'customer', calling: 'customer', security: 'platform' });
const OWNERS = ['platform', 'customer'];

const taintDefaultOn = (env) => {
    const { anyToolOn } = require('../Mcp/defaultOn');
    return anyToolOn(env) || require('../OAuthServer/config').isOn(env);
};

const onOff = (value) => (require('../Mcp/defaultOn').isOn(value) ? 'true' : 'false');

const field = (key, group, type, extra = {}) => ({ key, group, type, secret: type === 'secret', default: '', ...extra });

const CATALOG = [
    field('APP_NAME', 'general', 'text', { default: 'AlianHub', label: 'Product name', owner: 'customer' }),
    field('WEBURL', 'general', 'text', { label: 'Public web URL', help: 'The address people open in the browser; used in emails and OAuth callbacks.' }),
    field('APIURL', 'general', 'text', { label: 'Public API URL', help: 'Usually the web URL with a trailing slash.' }),
    field('CRON_TZ', 'general', 'text', { default: 'UTC', label: 'Scheduler time zone', restart: true, owner: 'customer' }),

    field('NODEMAILER_HOST', 'mail', 'text', { label: 'SMTP host' }),
    field('NODEMAILER_PORT', 'mail', 'number', { default: '587', label: 'SMTP port', help: '587 (STARTTLS) or 465 (TLS).' }),
    field('NODEMAILER_USER', 'mail', 'text', { label: 'SMTP username', help: 'Only when the login differs from the from address, e.g. an Amazon SES Mail Manager endpoint ID.' }),
    field('NODEMAILER_EMAIL', 'mail', 'text', { label: 'From address', help: 'Also the SMTP login when no username is set.' }),
    field('NODEMAILER_EMAIL_PASSWORD', 'mail', 'secret', { label: 'SMTP password' }),
    field('RESEND_API_KEY', 'mail', 'secret', { label: 'Resend API key', help: 'When set, Resend is used instead of SMTP.' }),
    field('RESEND_FROM_EMAIL', 'mail', 'text', { label: 'Resend from address' }),

    field('STORAGE_TYPE', 'storage', 'select', { default: 'server', options: ['server', 's3', 'wasabi'], label: 'Storage driver', restart: true }),
    field('S3_ENDPOINT', 'storage', 'text', { label: 'Storage address', help: 'e.g. https://blr1.digitaloceanspaces.com or https://s3.ap-southeast-1.wasabisys.com. Empty uses Amazon S3.' }),
    field('S3_REGION', 'storage', 'text', { label: 'Region', help: 'e.g. blr1 or us-east-1.' }),
    field('S3_BUCKET', 'storage', 'text', { label: 'Bucket', help: 'One bucket for everything. Leave empty to keep a bucket per workspace.' }),
    field('S3_PREFIX', 'storage', 'text', { label: 'Key prefix', help: 'Optional, e.g. prod/. Every file is stored under it, inside the bucket above.', validate: prefixProblem }),
    field('S3_ACCESS_KEY', 'storage', 'text', { label: 'Access key' }),
    field('S3_SECRET_KEY', 'storage', 'secret', { label: 'Secret key' }),
    field('S3_FORCE_PATH_STYLE', 'storage', 'boolean', { default: 'false', label: 'Bucket in the path', help: 'On for MinIO and other servers that cannot take the bucket name in the host name.' }),
    field('S3_PUBLIC_BASE_URL', 'storage', 'text', { label: 'Public files address', help: 'Optional address (a CDN) that serves public files such as email images.' }),
    field('USERPROFILEBUCKET', 'storage', 'text', { label: 'Public assets bucket', help: 'With a bucket per workspace only: the bucket for avatars and public files.' }),
    field('WASABI_ACCESS_KEY', 'storage', 'text', { label: 'Wasabi access key', legacy: true }),
    field('WASABI_SECRET_ACCESS_KEY', 'storage', 'secret', { label: 'Wasabi secret key', legacy: true }),
    field('WASABI_USERID', 'storage', 'text', { label: 'Wasabi user id', legacy: true }),
    field('WASABIENDPOINT', 'storage', 'text', { default: 'https://s3.wasabisys.com', label: 'Wasabi endpoint', legacy: true }),
    field('WASABI_REGION', 'storage', 'text', { default: 'us-east-1', label: 'Wasabi region', legacy: true }),
    field('IAM_ENDPOINT', 'storage', 'text', { default: 'https://iam.wasabisys.com', label: 'IAM endpoint', legacy: true }),

    field('AI_ENABLED', 'ai', 'boolean', {
        default: 'true',
        label: 'AI features',
        help: 'Off stops every AI call on this instance: nothing is sent to any model, AI screens say AI is turned off, and background AI work is skipped.',
    }),
    field('WORKSPACE_GUIDE_AUTO_CREATE', 'ai', 'boolean', {
        default: 'true',
        label: 'Workspace Guide in new workspaces',
        help: 'On adds the built-in Workspace Guide agent to each workspace when it is created. Off adds none until an admin adds it from the Team board.',
    }),
    field('LLM_PROVIDER', 'ai', 'select', { default: 'openai', options: ['openai', 'anthropic', 'deepseek', 'openai_compatible'], label: 'Provider' }),
    field('AI_API_KEY', 'ai', 'secret', { label: 'OpenAI API key' }),
    field('AI_MODEL', 'ai', 'text', { default: 'gpt-4.1', label: 'OpenAI model' }),
    field('OPENAI_BASE_URL', 'ai', 'text', {
        label: 'OpenAI base URL',
        help: "Empty uses OpenAI's own API. Set it only to reach OpenAI through a proxy or a regional endpoint.",
        validate: baseUrlError,
    }),
    field('OPENAI_COMPATIBLE_BASE_URL', 'ai', 'text', {
        label: 'OpenAI-compatible base URL',
        help: 'A server that speaks the OpenAI API on your own network, e.g. http://localhost:11434/v1 (Ollama), http://host:8000/v1 (vLLM) or http://host:1234/v1 (LM Studio). Private and loopback addresses are allowed here.',
        validate: baseUrlError,
    }),
    field('OPENAI_COMPATIBLE_API_KEY', 'ai', 'secret', { label: 'OpenAI-compatible API key', help: 'Leave empty when the server needs none (Ollama, LM Studio).' }),
    field('OPENAI_COMPATIBLE_MODEL', 'ai', 'text', { label: 'OpenAI-compatible chat model', help: 'The model name the server knows, e.g. llama3.1:8b.' }),
    field('OPENAI_COMPATIBLE_EMBEDDINGS_MODEL', 'ai', 'text', {
        label: 'OpenAI-compatible embeddings model',
        help: 'Used for knowledge search, e.g. nomic-embed-text. Changing it means re-embedding each workspace under Instance › Knowledge.',
    }),
    field('ANTHROPIC_API_KEY', 'ai', 'secret', { label: 'Anthropic API key' }),
    field('ANTHROPIC_MODEL', 'ai', 'text', { default: 'claude-sonnet-4-5-20250929', label: 'Anthropic model' }),
    field('DEEPSEEK_API_KEY', 'ai', 'secret', { label: 'DeepSeek API key' }),
    field('DEEPSEEK_MODEL', 'ai', 'text', { default: 'deepseek-v4-flash', label: 'DeepSeek model' }),
    field('AI_FIELD_DAILY_LIMIT', 'ai', 'number', { default: '500', label: 'AI field fills per workspace per day', help: 'Counted per UTC day; a bulk fill stops when the limit is reached.' }),
    field('AI_REPLAY', 'ai', 'select', {
        default: 'agent',
        options: ['off', 'agent', 'all'],
        label: 'Keep replay records of model calls',
        help: 'A redacted record of the prompt and answer, for reviewing what an AI did: off, agent runs only, or every model call.',
    }),
    field('LLM_PRICING', 'ai', 'text', {
        label: 'Model prices (USD per 1M tokens)',
        help: 'JSON keyed by model id, e.g. {"gpt-4.1":{"input":2,"output":8}}. Overrides the built-in list; a model with no price refuses to run. Use 0/0 for a free or self-hosted model.',
        validate: (value) => (require('../AICore/usage').parsePricing(value).errors.length ? 'json' : null),
    }),

    field('MCP_OAUTH', 'ai', 'select', {
        default: (env) => require('../OAuthServer/config').mode(env),
        options: ['both', 'only', 'off'],
        normalise: (value) => require('../OAuthServer/config').mode({ MCP_OAUTH: value }),
        restart: true,
        label: 'Connect an AI app by address',
        help: 'Lets people connect Claude or ChatGPT by address, with a consent screen. "only" refuses personal tokens. Needs an https APIURL or MCP_OAUTH_ISSUER.',
        // A value the issuer cannot serve would stop the next boot, with no console left to undo it.
        validate: (value) => (value !== 'off' && require('../OAuthServer/config').issuerProblem(process.env) ? 'mcp_issuer' : null),
    }),
    field('MCP_TOOLS_DATA', 'ai', 'boolean', { default: 'true', normalise: onOff, label: 'AI data tools', help: 'Projects, lists, docs, comments and time for a connected AI.' }),
    field('MCP_TOOLS_MANAGE', 'ai', 'boolean', { default: 'true', normalise: onOff, label: 'AI management tools', help: 'Changing, moving and archiving tasks and writing docs, for a connection given the manage permission.' }),
    field('MCP_TOOLS_WORK', 'ai', 'boolean', { default: 'true', normalise: onOff, label: 'AI everyday work tools', help: 'Tags, links, lists, doc comments, goals and project setup for a connected AI.' }),

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
    field('GITLAB_BASE_API_URL', 'auth', 'text', { default: 'https://gitlab.com/api/v4', label: 'GitLab API URL', help: 'Change it with the OAuth base URL for a self-managed GitLab.' }),
    field('SSO_LOGIN_ENABLED', 'auth', 'boolean', { default: 'true', label: 'Show "Continue with SSO" on the login page' }),
    field('MAGIC_LINK_ENABLED', 'auth', 'boolean', { default: 'true', label: 'Sign in with an emailed link' }),
    field('TWO_FACTOR_ISSUER', 'auth', 'text', { default: 'AlianHub', label: 'Name in authenticator apps' }),

    field('STUN_URLS', 'calling', 'text', { default: 'stun:stun.l.google.com:19302', label: 'STUN servers' }),
    field('TURN_URLS', 'calling', 'text', { label: 'TURN servers', help: 'Comma-separated, e.g. turn:turn.example.com:3478', owner: 'platform' }),
    field('TURN_STATIC_AUTH_SECRET', 'calling', 'secret', { label: 'TURN static auth secret', owner: 'platform' }),
    field('TURN_USERNAME', 'calling', 'text', { label: 'TURN username (fallback)', owner: 'platform' }),
    field('TURN_PASSWORD', 'calling', 'secret', { label: 'TURN password (fallback)', owner: 'platform' }),

    field('TRUST_PROXY', 'security', 'text', { default: 'loopback', label: 'Trusted proxies', help: '"loopback", a hop count such as "1", or "true" behind any proxy.', restart: true }),
    field('GLOBAL_RATE_LIMIT_PER_MIN', 'security', 'number', { default: '1000', label: 'API requests per minute per IP', help: '0 turns the limit off.', restart: true }),
    field('WEBHOOK_ALLOWED_PRIVATE_HOSTS', 'security', 'list', {
        label: 'Private webhook hosts',
        help: 'Webhooks refuse loopback, private and internal hosts. List the exact hostnames or CIDR ranges on your network they may post to, separated by commas or new lines, e.g. hooks.lan, 192.168.10.0/24. Link-local and cloud metadata addresses stay blocked, and a range can be no wider than /8 (IPv4) or /32 (IPv6).',
        validate: allowlistError,
    }),
    field('HELMET_ENABLED', 'security', 'boolean', { default: 'true', label: 'Security response headers', restart: true }),
    field('AGENT_TAINT_ROUTING', 'security', 'boolean', {
        default: (env) => (taintDefaultOn(env) ? 'true' : 'false'),
        normalise: onOff,
        readOnly: true,
        owner: 'customer',
        label: 'Hold risky AI writes for approval',
        help: 'A risky write by an agent that read outside content, or by an outside AI app, waits for a person to approve it. On by default while the MCP tools or MCP_OAUTH are on. Shown here only: set AGENT_TAINT_ROUTING in .env and restart to change it.',
    }),
    field('PERMISSION_ENFORCEMENT_MODE', 'security', 'select', {
        default: 'off',
        owner: 'customer',
        options: ['off', 'report', 'enforce'],
        label: 'Permission checks for browser sessions',
        help: 'The default for every workspace; a workspace can set its own. Off lets browser sessions through as before, report lets them through and records what would be refused, enforce refuses. API tokens stay enforced on the keys they always were; on other task writes they follow this mode like browser sessions.',
    }),
    field('AUDIT_RETENTION_DAYS', 'security', 'number', {
        label: 'Keep audit log entries (days)',
        help: 'Older entries are pruned each night. Empty keeps the built-in window.',
        owner: 'customer',
    }),
];

const byKey = new Map(CATALOG.map((f) => [f.key, f]));

/* A key override beats a group override, which beats the field's own owner, which beats its
 * group's: `{ mail: 'customer' }` hands the whole mail group to a Business plan with its own SMTP. */
function ownerOf(key, overrides = {}) {
    const def = byKey.get(key);
    if (!def) return null;
    return overrides[key] || overrides[def.group] || def.owner || GROUP_OWNER[def.group];
}

const platformOwnedKeys = (overrides = {}) => CATALOG.filter((def) => ownerOf(def.key, overrides) === 'platform').map((def) => def.key);

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
        if (def.readOnly) { errors[key] = 'readonly'; continue; }
        if (raw && typeof raw === 'object' && raw.set === true) continue;
        if (raw === null || raw === undefined) { values[key] = ''; continue; }
        const value = String(raw).trim();
        if (value === '') { values[key] = ''; continue; }
        if (def.type === 'number' && !/^\d+$/.test(value)) { errors[key] = 'number'; continue; }
        if (def.type === 'boolean' && !isBooleanString(value)) { errors[key] = 'boolean'; continue; }
        if (def.type === 'select' && !def.options.includes(value)) { errors[key] = 'option'; continue; }
        const problem = def.validate ? def.validate(value) : null;
        if (problem) { errors[key] = problem; continue; }
        values[key] = value;
    }
    return { values, errors, valid: Object.keys(errors).length === 0 };
}

const filled = (value) => value !== undefined && value !== null && value !== '';

/* Pure: what the page shows, resolved env > platform > saved > default. A secret never leaves
 * the server; a `managed` row (hosted, ours to set) shows no value at all, so a customer cannot
 * read our relay, bucket or proxy settings. */
function describeSettings({ saved = {}, env = {}, locked = [], platform = {}, managed = [] }) {
    const lockedSet = new Set(locked);
    const managedSet = new Set(managed);
    return CATALOG.map((def) => {
        const isManaged = managedSet.has(def.key);
        const fromEnv = lockedSet.has(def.key) ? env[def.key] : undefined;
        const fromPlatform = platform[def.key];
        const fromSaved = isManaged ? undefined : saved[def.key];
        const fallback = typeof def.default === 'function' ? def.default(env) : def.default;
        const source = filled(fromEnv) ? 'env'
            : filled(fromPlatform) ? 'platform'
                : filled(fromSaved) ? 'saved'
                    : fallback !== '' ? 'default' : 'unset';
        const raw = { env: fromEnv, platform: fromPlatform, saved: fromSaved }[source] ?? fallback;
        const effective = def.normalise && source !== 'unset' ? def.normalise(raw) : raw;
        const value = isManaged ? null : def.secret ? { set: source !== 'unset' } : effective;
        return {
            key: def.key, group: def.group, type: def.type, secret: def.secret, label: def.label, help: def.help || '',
            options: def.options || null, default: isManaged ? null : fallback, restart: Boolean(def.restart), public: Boolean(def.public),
            value, source, locked: isManaged || source === 'env' || source === 'platform' || Boolean(def.readOnly), readOnly: Boolean(def.readOnly),
            managed: isManaged,
            hidden: Boolean(def.legacy) && source !== 'env' && source !== 'saved' && source !== 'platform',
        };
    });
}

module.exports = { GROUPS, GROUP_OWNER, OWNERS, CATALOG, byKey, ownerOf, platformOwnedKeys, validateSettings, describeSettings };
