// Pure catalog and connection validation (no DB or network I/O). Unit-tested in
// tests/integrations-rules.test.js and tests/integrations-access.test.js.
const secretField = require('../../../utils/secretField');
const { isBlockedHostname } = require('../../Agents/engine/safeFetch');

// `secret` fields are never returned to the client, `multiple` allows many
// instances, `oauth` marks credential-gated ones. `format` names a FORMATS entry.
const CATALOG = [
    { key: 'slack', name: 'Slack', category: 'Chat', icon: '💬', description: 'Slash commands (/alianhub) from your Slack workspace.', fields: [{ key: 'verification_token', label: 'Slack verification token', secret: true, required: true, format: 'slack_verification_token' }, { key: 'default_channel', label: 'Default channel', format: 'slack_channel' }] },
    { key: 'github', name: 'GitHub', category: 'Dev', icon: '🐙', description: 'Link commits and pull requests to tasks.', fields: [{ key: 'token', label: 'Personal access token', secret: true, required: true, format: 'github_token' }, { key: 'repo', label: 'owner/repo', required: true, format: 'github_repo' }] },
    { key: 'gitlab', name: 'GitLab', category: 'Dev', icon: '🦊', description: 'Link merge requests and commits to tasks.', fields: [{ key: 'token', label: 'Access token', secret: true, required: true, format: 'gitlab_token' }, { key: 'project', label: 'Project path', required: true, format: 'gitlab_project' }] },
    { key: 'google_calendar', name: 'Google Calendar', category: 'Calendar', icon: '📅', description: '2-way calendar sync (OAuth). The read-only iCal feed needs no setup.', oauth: true, fields: [{ key: 'client_id', label: 'OAuth client ID', required: true, format: 'google_client_id' }, { key: 'client_secret', label: 'OAuth client secret', secret: true, required: true, format: 'google_client_secret' }] },
    { key: 'microsoft_teams', name: 'Microsoft Teams', category: 'Chat', icon: '👔', description: 'Post task updates to a Teams channel.', fields: [{ key: 'webhook_url', label: 'Incoming webhook URL', secret: true, required: true, format: 'public_https_url' }] },
    { key: 'zapier', name: 'Zapier', category: 'Automation', icon: '⚡', description: 'Connect to 6000+ apps via a catch hook.', fields: [{ key: 'hook_url', label: 'Zapier catch hook URL', secret: true, required: true, format: 'zapier_hook_url' }] },
    { key: 'custom_iframe', name: 'Custom embed', category: 'Apps', icon: '🪟', description: 'Embed an external tool as an app panel.', multiple: true, fields: [{ key: 'name', label: 'App name' }, { key: 'url', label: 'Embed URL (https)', required: true, format: 'embed_url' }] },
    // Cloud storage providers (Google Drive / Dropbox) are deliberately absent:
    // Modules/CloudStorage owns them on Settings → Integrations (AHE-3838), and a
    // second place to configure the same thing would compete with it.
];

const MAX_FIELD_LENGTH = 2000;

const byKey = (key) => CATALOG.find((c) => c.key === String(key)) || null;
const getCatalog = () => CATALOG.map((c) => ({
    key: c.key, name: c.name, category: c.category, icon: c.icon, description: c.description, oauth: !!c.oauth, multiple: !!c.multiple,
    fields: (c.fields || []).map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, required: !!f.required })),
}));

// Embeds render in the viewer's browser, so https alone blocks javascript:, data: and mixed content.
const isEmbeddableUrl = (u) => /^https:\/\/[^\s]+$/i.test(String(u || ''));

const parseHttps = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url : null;
    } catch (e) {
        return null;
    }
};

const FORMATS = {
    slack_verification_token: { test: (v) => /^[A-Za-z0-9]{20,64}$/.test(v), message: 'must be the verification token from your Slack app’s Basic Information page.' },
    slack_channel: { test: (v) => /^#?[a-z0-9][a-z0-9._-]{0,79}$/i.test(v), message: 'must be a Slack channel name such as #general.' },
    github_token: { test: (v) => /^(gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{22,244}|[a-f0-9]{40})$/.test(v), message: 'must be a GitHub token (ghp_…, github_pat_…).' },
    github_repo: { test: (v) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(v) && !/\/\.{1,2}$/.test(v), message: 'must look like owner/repo.' },
    gitlab_token: { test: (v) => /^(gl[a-z]{2,8}-[A-Za-z0-9_.-]{20,255}|[A-Za-z0-9_-]{20})$/.test(v), message: 'must be a GitLab access token (glpat-…).' },
    gitlab_project: { test: (v) => /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(v) && !v.split('/').some((s) => s === '.' || s === '..'), message: 'must be a project path such as group/project.' },
    google_client_id: { test: (v) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(v), message: 'must be a Google OAuth client ID ending in .apps.googleusercontent.com.' },
    google_client_secret: { test: (v) => /^(GOCSPX-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{24})$/.test(v), message: 'must be a Google OAuth client secret (GOCSPX-…).' },
    public_https_url: { test: (v) => { const u = parseHttps(v); return !!u && !isBlockedHostname(u.hostname); }, message: 'must be an https:// URL on a public host.' },
    zapier_hook_url: { test: (v) => { const u = parseHttps(v); return !!u && u.hostname === 'hooks.zapier.com' && u.pathname.startsWith('/hooks/'); }, message: 'must be a Zapier catch hook URL (https://hooks.zapier.com/hooks/…).' },
    embed_url: { test: isEmbeddableUrl, message: 'must be a valid https:// URL.' },
};

const invalid = (field, reason) => ({ valid: false, field, reason });

const validateConnection = ({ type, config } = {}) => {
    const item = byKey(type);
    if (!item) return invalid('type', 'Unknown integration type.');
    const raw = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {};
    const out = {};
    for (const field of item.fields || []) {
        const given = raw[field.key];
        if (given !== undefined && given !== null && typeof given !== 'string' && typeof given !== 'number') {
            return invalid(field.key, `${field.label} must be text.`);
        }
        const value = given === undefined || given === null ? '' : String(given).trim();
        if (!value) {
            if (field.required) return invalid(field.key, `${field.label} is required.`);
            continue;
        }
        if (value.length > MAX_FIELD_LENGTH) return invalid(field.key, `${field.label} is too long.`);
        const format = FORMATS[field.format];
        if (format && !format.test(value)) return invalid(field.key, `${field.label} ${format.message}`);
        out[field.key] = value;
    }
    const name = item.multiple ? (out.name || item.name) : item.name;
    return { valid: true, field: '', reason: '', value: { type: item.key, name, config: out } };
};

const secretKeys = (type) => { const item = byKey(type); return ((item && item.fields) || []).filter((f) => f.secret).map((f) => f.key); };

const sealConfig = (type, config) => secretField.sealFields(config, secretKeys(type));
const openConfig = (type, config) => secretField.openFields(config, secretKeys(type));

const redact = (conn) => {
    if (!conn) return conn;
    const o = conn.toObject ? conn.toObject() : { ...conn };
    const cfg = { ...(o.config || {}) };
    const secrets = {};
    for (const k of secretKeys(o.type)) { secrets[k] = !!cfg[k]; delete cfg[k]; }
    return { ...o, config: cfg, secrets };
};

module.exports = { CATALOG, SECRETS_VERSION: secretField.VERSION, byKey, getCatalog, validateConnection, redact, isEmbeddableUrl, secretKeys, sealConfig, openConfig };
