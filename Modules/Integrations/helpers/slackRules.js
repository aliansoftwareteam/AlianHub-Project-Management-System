// AUTO-06 — pure Slack slash-command helpers (crypto only, no DB/IO). The live
// endpoint authenticates with the per-workspace verification token (simple, no
// raw-body capture needed); verifySignature (HMAC) is included + tested for the
// forward-compat signed-request path. Unit-tested in tests/slack-rules.test.js.

const crypto = require('crypto');

const SUBCOMMANDS = ['help', 'projects'];

const parseCommand = (text) => {
    const t = String(text || '').trim();
    if (!t) return { sub: 'help', rest: '' };
    const sp = t.indexOf(' ');
    const sub = (sp === -1 ? t : t.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? '' : t.slice(sp + 1).trim();
    return { sub: SUBCOMMANDS.includes(sub) ? sub : 'help', rest };
};

// Constant-time compare of the stored vs incoming verification token.
const verifyToken = (stored, provided) => {
    const a = String(stored || '');
    const b = String(provided || '');
    if (!a || a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (e) { return false; }
};

// Slack request signature: 'v0=' + HMAC-SHA256(signingSecret, `v0:ts:rawBody`).
const verifySignature = ({ signingSecret, timestamp, rawBody, signature } = {}) => {
    if (!signingSecret || !timestamp || !signature) return false;
    const base = `v0:${timestamp}:${rawBody || ''}`;
    const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
    if (expected.length !== String(signature).length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); } catch (e) { return false; }
};

const ephemeral = (text) => ({ response_type: 'ephemeral', text: String(text || '') });
const helpText = () => '*AlianHub* commands:\n• `/alianhub help` — this help\n• `/alianhub projects` — list active projects';
const projectsText = (names = []) => (names.length ? `*Active projects:*\n${names.map((n) => `• ${n}`).join('\n')}` : 'No active projects found.');

module.exports = { SUBCOMMANDS, parseCommand, verifyToken, verifySignature, ephemeral, helpText, projectsText };
