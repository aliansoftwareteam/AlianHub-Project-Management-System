const { escapeCommentText } = require('../../Comments/helpers/plainText');
const { contentToEditorData } = require('./pageContent');

const MAX_MESSAGE_LENGTH = 10000;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

const readMessage = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return { reason: 'A comment needs some text.' };
    if (text.length > MAX_MESSAGE_LENGTH) return { reason: `A comment can be up to ${MAX_MESSAGE_LENGTH} characters.` };
    return { message: escapeCommentText(text) };
};

const readBlockId = (value) => {
    if (value === undefined || value === null || value === '') return { blockId: '' };
    return BLOCK_ID.test(String(value)) ? { blockId: String(value) } : { reason: 'blockId must be a block id of this doc.' };
};

const blockIdsOf = (page) => {
    const data = contentToEditorData((page && page.content) || {});
    return new Set((data.blocks || []).map((block) => block && block.id).filter(Boolean).map(String));
};

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : { ...(row || {}) });

/* Read against the saved doc: a comment whose block is gone is shown with the doc-level ones. */
const withBlockFallback = (row, blockIds) => {
    const comment = plain(row);
    if (comment.blockId && !blockIds.has(String(comment.blockId))) return { ...comment, blockId: '', blockRemoved: true };
    return comment;
};

module.exports = { MAX_MESSAGE_LENGTH, readMessage, readBlockId, blockIdsOf, plain, withBlockFallback };
