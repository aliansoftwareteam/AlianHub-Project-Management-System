const ALIAN_MENTION_KEY = 'alian';
const ALIAN_DISPLAY_NAME = 'Alian';

const TOKEN_RE = /@\[[^\]]*\]\(alian\)/gi;
const BARE_RE = /@Alian\b/gi;

function stripAlianMentions(text) {
    return String(text || '')
        .replace(TOKEN_RE, ' ')
        .replace(BARE_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstAlianMention(text) {
    const raw = String(text || '');
    TOKEN_RE.lastIndex = 0;
    BARE_RE.lastIndex = 0;
    const token = TOKEN_RE.exec(raw);
    const bare = BARE_RE.exec(raw);
    let match = null;
    if (token && bare) match = token.index <= bare.index ? token : bare;
    else match = token || bare;
    if (!match) return null;
    return { index: match.index, length: match[0].length };
}

function extractAlianQuestion(message) {
    const raw = String(message || '').trim();
    const hit = firstAlianMention(raw);
    if (!hit) {
        return { mentioned: false, question: '' };
    }
    const after = stripAlianMentions(raw.slice(hit.index + hit.length)).replace(/^[\s,.:;!?-]+/, '').trim();
    if (after) {
        return { mentioned: true, question: after };
    }
    return { mentioned: true, question: stripAlianMentions(raw) };
}

function isAlianAuthor(id) {
    return String(id || '') === ALIAN_MENTION_KEY;
}

export {
    ALIAN_MENTION_KEY,
    ALIAN_DISPLAY_NAME,
    extractAlianQuestion,
    isAlianAuthor,
};
