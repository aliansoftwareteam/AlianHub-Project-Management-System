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

/* Where Windows-1252 differs from Latin-1: bytes 0x80 to 0x9F. Node's own 'windows-1252' decoder
 * reads them as Latin-1 control characters, so they are mapped here. The five bytes the code page
 * leaves undefined keep their control character. */
const WINDOWS_1252_HIGH = [
    0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

const decodeWindows1252 = (buffer) => buffer.toString('latin1')
    .replace(/[\u0080-\u009f]/g, (ch) => String.fromCharCode(WINDOWS_1252_HIGH[ch.charCodeAt(0) - 0x80]));

/* Bytes that are not valid UTF-8 are read in the Windows Western code page, which is what Excel's
 * plain "CSV" and older Notepad save in on Western systems. */
const decodeText = (buffer) => {
    if (isUtf16(buffer)) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
        return decodeWindows1252(buffer);
    }
};

module.exports = { TRUNCATION_MARKER, finish, isUtf16, decodeText };
