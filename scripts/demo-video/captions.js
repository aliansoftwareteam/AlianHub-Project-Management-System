const path = require('node:path');
const sharp = require('sharp');

const WIDTH = 960;
const LINE = 58;
const MAX_CHARS = 30;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const wrap = (text) => {
    const lines = [];
    for (const word of String(text).split(/\s+/)) {
        const last = lines[lines.length - 1];
        if (last !== undefined && `${last} ${word}`.length <= MAX_CHARS) lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word);
    }
    return lines;
};

/* One PNG per caption cue, large enough to read on a phone, for the vertical cut's lower third. */
async function captionPngs(cues, dir) {
    const out = [];
    for (const [at, cue] of cues.entries()) {
        if (!cue.text || cue.end - cue.start < 0.2) continue;
        const lines = wrap(cue.text);
        const height = 48 + lines.length * LINE + (cue.sub ? 44 : 0);
        const text = lines.map((line, i) => `<text x="${WIDTH / 2}" y="${36 + (i + 1) * LINE - 12}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff">${escape(line)}</text>`).join('');
        const sub = cue.sub ? `<text x="${WIDTH / 2}" y="${height - 26}" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" font-weight="500" fill="#c9cbe0">${escape(cue.sub)}</text>` : '';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="${WIDTH}" height="${height}" rx="28" fill="#111322" fill-opacity="0.88"/>${text}${sub}</svg>`;
        const file = path.join(dir, `caption-${at}.png`);
        await sharp(Buffer.from(svg)).png().toFile(file);
        out.push({ file, start: cue.start, end: cue.end });
    }
    return out;
}

module.exports = { captionPngs };
