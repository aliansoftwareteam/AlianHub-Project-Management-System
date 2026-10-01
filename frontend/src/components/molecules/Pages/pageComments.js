const idOf = (row) => String((row && row._id) || '');
const byCreated = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || idOf(a).localeCompare(idOf(b));

/* `blockIds` is the doc's current block ids, or null while they are not known. A thread whose block is gone reads as
 * a doc-level one, the way the server lists it. */
export const threadsOf = (comments, blockIds) => {
    const known = Array.isArray(blockIds) ? new Set(blockIds.map(String)) : null;
    const roots = new Map();
    (comments || []).filter((row) => row && !row.isDeleted && !row.parentId).forEach((root) => {
        const gone = Boolean(root.blockRemoved) || Boolean(root.blockId && known && !known.has(String(root.blockId)));
        roots.set(idOf(root), { root, replies: [], blockId: gone ? '' : String(root.blockId || ''), blockRemoved: gone });
    });
    (comments || []).filter((row) => row && !row.isDeleted && row.parentId).forEach((reply) => {
        const thread = roots.get(String(reply.parentId));
        if (thread) thread.replies.push(reply);
    });
    const threads = [...roots.values()].sort((a, b) => byCreated(a.root, b.root));
    threads.forEach((thread) => thread.replies.sort(byCreated));
    return threads;
};

export const applyCommentEvent = (comments, doc) => {
    if (!doc || !doc._id) return comments;
    const id = idOf(doc);
    if (doc.isDeleted) return comments.filter((row) => idOf(row) !== id && String(row.parentId || '') !== id);
    const at = comments.findIndex((row) => idOf(row) === id);
    if (at === -1) return [...comments, doc];
    const next = comments.slice();
    next[at] = { ...comments[at], ...doc };
    return next;
};

const MENTION_QUERY = /(^|\s)@([^\s@[\]()]*)$/;

/* The "@name" being typed just before the caret, if any. */
export const mentionQueryAt = (text, caret) => {
    const match = MENTION_QUERY.exec(String(text || '').slice(0, caret));
    if (!match) return null;
    return { start: caret - match[2].length - 1, query: match[2] };
};

const REFERENCE_PREFIX = { doc: 'doc_', task: 'task_' };

/* A person is written as the task comments write one, so the server's mention parser and every comment renderer read
 * it; a doc or a task carries its kind before the id, which keeps it out of the people a comment notifies. */
export const insertMention = (text, start, caret, item) => {
    const label = String(item.label ?? item.name ?? '').replace(/[[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const token = `@[${label}](${REFERENCE_PREFIX[item.type] || ''}${item.id}) `;
    return { text: `${text.slice(0, start)}${token}${text.slice(caret)}`, caret: start + token.length };
};
