const KEPT_SUBTYPES = Object.freeze(['bot_message', 'thread_broadcast', 'file_share']);
const SLACK_ID = /^[A-Z0-9]{2,20}$/;
const MIN_PARTIAL_LINE = 40;

/* Slack's own markup for mentions, channels and links is turned into words, so the model is not handed syntax
 * that would notify people or a whole channel if it echoed it into a message. */
const plainText = (value) => String(value || '')
    .replace(/<!([a-z]+)(?:\^[^|>]*)?(?:\|[^>]*)?>/g, '@$1')
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (all, id, name) => `#${name || id}`)
    .replace(/<((?:https?|mailto):[^|>\s]+)(?:\|([^>]*))?>/g, (all, url, label) => (label ? `${label} (${url})` : url))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim();

const isText = (m) => Boolean(m) && m.type === 'message' && (!m.subtype || KEPT_SUBTYPES.includes(m.subtype)) && typeof m.text === 'string' && Boolean(plainText(m.text));
const whoOf = (m) => [m.user, m.bot_id].map((id) => String(id || '')).find((id) => SLACK_ID.test(id)) || 'unknown';
const minuteOf = (ts) => { const at = new Date(Number(ts) * 1000); return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, 16).replace('T', ' '); };
const lineOf = (m) => `${minuteOf(m.ts)} ${whoOf(m)}: ${plainText(m.text)}`.trim();

/* Slack answers newest first. The newest messages are kept while they fit, then put in the order they were said. */
const linesOf = (messages, { limit, maxChars, more }) => {
    const texts = (Array.isArray(messages) ? messages : []).filter(isText);
    const lines = [];
    let left = maxChars;
    let truncated = Boolean(more) || texts.length > limit;
    for (const message of texts.slice(0, limit)) {
        const line = lineOf(message);
        const room = left - (lines.length ? 1 : 0);
        if (line.length <= room) { lines.push(line); left = room - line.length; continue; }
        truncated = true;
        if (!lines.length || room >= MIN_PARTIAL_LINE) lines.push(line.slice(0, Math.max(0, room)));
        break;
    }
    const text = lines.reverse().join('\n');
    return { text, count: lines.length, chars: text.length, truncated };
};

module.exports = { plainText, linesOf };
