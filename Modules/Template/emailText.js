const { escapeHtml } = require('../../utils/escapeHtml');
const { decodeCommentText, commentHtml, commentPlainText } = require('../Comments/helpers/plainText');

/* Stored text is entity-escaped when the web app wrote it and raw when an API, MCP or import caller did;
 * decoding once before escaping renders both the same and never escapes anything twice. */
const textHtml = (value) => escapeHtml(decodeCommentText(value));

const EMPHASIS_TAG = /&lt;(\/?)(p|b|strong|i|em|u|br)\s*\/?&gt;/gi;

/* Notification messages carry bare emphasis tags; those come back without attributes, everything else stays text. */
const messageHtml = (value) => commentHtml(value).replace(EMPHASIS_TAG, '<$1$2>');

const subjectText = (value) => commentPlainText(value).replace(/\s+/g, ' ').trim();

const CSS_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([\d\s.,%]+\))$/i;

const cssColor = (value) => {
    const color = String(value === undefined || value === null ? '' : value).trim();
    return CSS_COLOR.test(color) ? color : '';
};

const IMAGE_URL = /^(https?:\/\/|\/(?!\/)|data:image\/(png|gif|jpe?g|webp);)/i;

const imageSrc = (value) => {
    const url = decodeCommentText(value).trim();
    return IMAGE_URL.test(url) ? escapeHtml(url) : '';
};

const urlSegment = (value) => encodeURIComponent(String(value === undefined || value === null ? '' : value));

module.exports = { escapeHtml, textHtml, commentHtml, messageHtml, subjectText, cssColor, imageSrc, urlSegment };
