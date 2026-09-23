// The comment editor inserts a mention as "[Display Name](userId)", and "[All](everyone)" for
// everyone. Only 24-hex ids count, so an ordinary link like "[docs](https://…)" is never one.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EVERYONE = /\[[^\]]*\]\(\s*everyone\s*\)/;

const parseMentionIds = (message) => {
    if (!message || typeof message !== 'string') return [];
    const re = /\[[^\]]*\]\(([^)]*)\)/g;
    const ids = new Set();
    let match;
    while ((match = re.exec(message)) !== null) {
        const id = (match[1] || '').trim();
        if (OBJECT_ID.test(id)) ids.add(id);
    }
    return Array.from(ids);
};

const mentionsEveryone = (message) => typeof message === 'string' && EVERYONE.test(message);

module.exports = { parseMentionIds, mentionsEveryone };
