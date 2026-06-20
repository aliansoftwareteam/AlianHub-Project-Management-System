// AUTO-04 — pure integrations catalog + connection validation (no DB/IO). One
// generic integration_connections registry backs the marketplace (AUTO-05), the
// Slack bot (AUTO-06) and custom iframe apps (AUTO-07). Unit-tested in
// tests/integrations-rules.test.js.

// Static catalog of connectable integrations. `fields` are the config inputs;
// `secret:true` fields are never returned to the client. `multiple:true` allows
// many instances (e.g. custom embeds). `oauth:true` marks credential-gated ones.
const CATALOG = [
    { key: 'slack', name: 'Slack', category: 'Chat', icon: '💬', description: 'Slash commands (/alianhub) from your Slack workspace.', fields: [{ key: 'verification_token', label: 'Slack verification token', secret: true }, { key: 'default_channel', label: 'Default channel' }] },
    { key: 'github', name: 'GitHub', category: 'Dev', icon: '🐙', description: 'Link commits and pull requests to tasks.', fields: [{ key: 'token', label: 'Personal access token', secret: true }, { key: 'repo', label: 'owner/repo' }] },
    { key: 'gitlab', name: 'GitLab', category: 'Dev', icon: '🦊', description: 'Link merge requests and commits to tasks.', fields: [{ key: 'token', label: 'Access token', secret: true }, { key: 'project', label: 'Project path' }] },
    { key: 'google_calendar', name: 'Google Calendar', category: 'Calendar', icon: '📅', description: '2-way calendar sync (OAuth). The read-only iCal feed needs no setup.', oauth: true, fields: [{ key: 'client_id', label: 'OAuth client ID' }, { key: 'client_secret', label: 'OAuth client secret', secret: true }] },
    { key: 'microsoft_teams', name: 'Microsoft Teams', category: 'Chat', icon: '👔', description: 'Post task updates to a Teams channel.', fields: [{ key: 'webhook_url', label: 'Incoming webhook URL', secret: true }] },
    { key: 'zapier', name: 'Zapier', category: 'Automation', icon: '⚡', description: 'Connect to 6000+ apps via a catch hook.', fields: [{ key: 'hook_url', label: 'Zapier catch hook URL', secret: true }] },
    { key: 'custom_iframe', name: 'Custom embed', category: 'Apps', icon: '🪟', description: 'Embed an external tool as an app panel.', multiple: true, fields: [{ key: 'name', label: 'App name' }, { key: 'url', label: 'Embed URL (https)' }] },
];

const byKey = (key) => CATALOG.find((c) => c.key === String(key)) || null;
const getCatalog = () => CATALOG.map((c) => ({ key: c.key, name: c.name, category: c.category, icon: c.icon, description: c.description, oauth: !!c.oauth, multiple: !!c.multiple, fields: (c.fields || []).map((f) => ({ key: f.key, label: f.label, secret: !!f.secret })) }));

const clip = (s) => String(s == null ? '' : s).slice(0, 2000);

// Validate a connect request against the catalog. Returns { valid, reason, value }.
const validateConnection = ({ type, config } = {}) => {
    const item = byKey(type);
    if (!item) return { valid: false, reason: 'Unknown integration type.' };
    const raw = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {};
    const allowed = (item.fields || []).map((f) => f.key);
    const out = {};
    for (const k of allowed) if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).length) out[k] = clip(raw[k]);
    if (item.multiple && (!out.url || !/^https?:\/\//i.test(out.url))) return { valid: false, reason: 'A valid https URL is required.' };
    const name = item.multiple ? (out.name || item.name) : item.name;
    return { valid: true, reason: '', value: { type: item.key, name, config: out } };
};

// Strip secret values for client display; expose which secrets are set.
const redact = (conn) => {
    if (!conn) return conn;
    const o = conn.toObject ? conn.toObject() : { ...conn };
    const item = byKey(o.type);
    const secretKeys = ((item && item.fields) || []).filter((f) => f.secret).map((f) => f.key);
    const cfg = { ...(o.config || {}) };
    const secrets = {};
    for (const k of secretKeys) { secrets[k] = !!cfg[k]; delete cfg[k]; }
    return { ...o, config: cfg, secrets };
};

module.exports = { CATALOG, byKey, getCatalog, validateConnection, redact };
