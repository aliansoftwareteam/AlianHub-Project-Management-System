const TEXT_FIELDS = ['message', 'reply_message'];

/* The web app escapes comment text before sending it, so text still holding "<" or ">" came from another
 * caller; escaping it the same way keeps one stored shape for every writer. */
const escapeCommentText = (value) => {
    if (typeof value !== 'string' || !/[<>]/.test(value)) return value;
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const escapeCommentFields = (data) => {
    if (!data || typeof data !== 'object') return data;
    const escaped = { ...data };
    for (const field of TEXT_FIELDS) {
        if (field in escaped) escaped[field] = escapeCommentText(escaped[field]);
    }
    return escaped;
};

module.exports = { escapeCommentText, escapeCommentFields };
