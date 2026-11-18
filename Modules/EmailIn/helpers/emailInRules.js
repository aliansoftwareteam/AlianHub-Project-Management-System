// AUTO-01 — pure rules for email-to-task (no DB, no I/O): inbox-address token
// handling + inbound-payload parsing. Provider-agnostic — any inbound-parse
// webhook (Mailgun / SendGrid / SES / Postmark) posts {from, subject, text,
// html, to} and these rules normalize it. Unit-tested in tests/email-in-rules.test.js.

const crypto = require('crypto');

const TOKEN_PATTERN = /^[a-f0-9]{24,}$/;
const MAX_NAME = 250;
const MAX_BODY = 20000;

const generateInboxToken = () => crypto.randomBytes(18).toString('hex'); // 36 hex chars
const isInboxToken = (t) => TOKEN_PATTERN.test(String(t || ''));

// The inbox address tasks are emailed to, e.g. inbox+<token>@<domain>.
const inboxAddress = (token, domain) => `inbox+${String(token || '')}@${String(domain || 'inbox.alianhub.com')}`;

// Pull the inbox token out of a `to` field (string, "Name <addr>", or array of either).
const extractToken = (to) => {
    const parts = Array.isArray(to) ? to : [to];
    for (const p of parts) {
        const m = String(p == null ? '' : p).match(/inbox\+([a-f0-9]{16,})@/i);
        if (m) return m[1].toLowerCase();
    }
    return '';
};

// Best-effort email-address extraction from a `from` field.
const extractEmail = (from) => {
    const s = String(from == null ? '' : from);
    const angle = s.match(/<([^>]+)>/);
    const raw = (angle ? angle[1] : s).trim();
    const m = raw.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    return m ? m[0].toLowerCase() : '';
};

const stripHtml = (html) => String(html || '')
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const clamp = (s, max) => {
    const str = String(s == null ? '' : s);
    return str.length > max ? str.slice(0, max) : str;
};

// Normalize an inbound email into the fields a task needs.
const parseInbound = ({ from, subject, text, html } = {}) => {
    const senderEmail = extractEmail(from);
    const taskName = clamp(String(subject || '').trim() || '(no subject)', MAX_NAME);
    const bodyText = (text && String(text).trim()) ? String(text) : stripHtml(html);
    const description = clamp(bodyText, MAX_BODY);
    return { senderEmail, taskName, description };
};

const MESSAGE_ID_HEADER = /^message-id:\s*(.+?)\s*$/im;

/* Providers send the headers as an object or, like SendGrid, as one raw block. */
const messageIdOf = (body) => {
    const direct = body['message-id'] || body['Message-Id'] || body['Message-ID'] || body.messageId;
    if (direct) return String(direct).trim();
    const headers = body.headers;
    if (headers && typeof headers === 'object') return String(headers['message-id'] || headers['Message-Id'] || headers['Message-ID'] || '').trim();
    const match = typeof headers === 'string' ? MESSAGE_ID_HEADER.exec(headers) : null;
    return match ? match[1].trim() : '';
};

/* Identifies the message without keeping any of it: a hash of its Message-ID, or of the
 * sender, subject and receipt time when the provider sent none, so a repeat sender is
 * a new source each time. */
const originRef = (body = {}, receivedAt = new Date()) => {
    const seed = messageIdOf(body) || `${body.from || ''}|${body.subject || ''}|${new Date(receivedAt).toISOString()}`;
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
};

module.exports = { generateInboxToken, isInboxToken, inboxAddress, extractToken, extractEmail, stripHtml, parseInbound, originRef, MAX_NAME, MAX_BODY };
