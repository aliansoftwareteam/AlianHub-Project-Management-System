// Shared by the extractor and its parser thread: what extracted text looks like on the way out.

const TRUNCATION_MARKER = '[text truncated: the index keeps only the start of a file this long]';

/* Built from code points so no control byte lives in this source file. Tab, line feed and
 * carriage return stay. */
const CONTROL_CHARS = new RegExp(`[${[[0, 8], [11, 12], [14, 31], [127, 127]]
    .map(([from, to]) => `\\u${from.toString(16).padStart(4, '0')}-\\u${to.toString(16).padStart(4, '0')}`).join('')}]`, 'g');

const clean = (text) => String(text == null ? '' : text).replace(CONTROL_CHARS, '');

/* `partial` says a page, sheet or row limit already cut the file short, so the marker goes on
 * even when the text that was read fits. */
const finish = (text, maxChars, partial = false) => {
    const cleaned = clean(text);
    const over = cleaned.length > maxChars;
    if (!over && !partial) return { text: cleaned, truncated: false };
    return { text: `${(over ? cleaned.slice(0, maxChars) : cleaned).trimEnd()}\n${TRUNCATION_MARKER}`, truncated: true };
};

/* UTF-16 is read only when it says so with a little-endian byte order mark; any other bytes with
 * a NUL in them are refused before this as not text. */
const isUtf16 = (buffer) => buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;

const decodeText = (buffer) => (isUtf16(buffer)
    ? new TextDecoder('utf-16le').decode(buffer.subarray(2))
    : new TextDecoder('utf-8').decode(buffer));

module.exports = { TRUNCATION_MARKER, finish, isUtf16, decodeText };
