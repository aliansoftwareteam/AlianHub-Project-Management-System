const { escapeCommentText } = require('../../Comments/helpers/plainText');
const { contentToEditorData } = require('./pageContent');

const MAX_MESSAGE_LENGTH = 10000;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_FILE_NAME = 255;
const REFERENCE = /@\[([^\]]*)\]\(\s*(?:doc|task)_[0-9a-fA-F]{24}\s*\)/g;

const readMessage = (value, { optional = false } = {}) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text && !optional) return { reason: 'A comment needs some text or a file.' };
    if (text.length > MAX_MESSAGE_LENGTH) return { reason: `A comment can be up to ${MAX_MESSAGE_LENGTH} characters.` };
    return { message: escapeCommentText(text) };
};

/* The file a new comment names: its key is checked against the doc by the caller, the rest is display text. */
const readFile = (body) => {
    const key = body && body.mediaURL;
    if (key === undefined || key === null || key === '') return {};
    if (typeof key !== 'string') return { reason: 'mediaURL must be the key of an uploaded file.' };
    const name = String(body.mediaOriginalName || '').replace(/[<>]/g, '').trim().slice(0, MAX_FILE_NAME);
    const size = Number(body.mediaSize);
    return { file: { mediaURL: key, mediaOriginalName: name || key.split('/').pop(), mediaSize: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0 } };
};

/* What a notice says of a comment: a doc or task it names reads as "@Title", and a comment that is only a file reads as the file's name. */
const noticeText = (comment) => String((comment && comment.message) || '').replace(REFERENCE, '@$1')
    || String((comment && comment.mediaOriginalName) || '')
    || '…';

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

module.exports = { MAX_MESSAGE_LENGTH, readMessage, readFile, noticeText, readBlockId, blockIdsOf, plain, withBlockFallback };
