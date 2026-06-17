// Extract mentioned user ids from a comment body. The comment editor inserts a
// mention as the markdown-style token "[Display Name](userId)" where userId is
// the user's 24-hex id (see the frontend CommentInput `addMention`). Only 24-hex
// ids count as mentions, so an ordinary link like "[docs](https://…)" is never
// mistaken for one. Pure — no I/O — shared by the controller and the tests.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

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

module.exports = { parseMentionIds };
