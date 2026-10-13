const { parseFileName } = require('./naming');

const CHANGED_COLOUR = [255, 0, 102, 255];
const DEFAULT_THRESHOLD = 8;
const FADE = 0.25;
const rank = (row) => {
    if (row.status === 'added') return 1;
    if (row.status === 'removed') return 2;
    return row.ratio > 0 ? 0 : 3;
};

function pairShots(beforeFiles, afterFiles) {
    const before = new Set(beforeFiles.filter(parseFileName));
    const after = new Set(afterFiles.filter(parseFileName));
    return [...new Set([...before, ...after])].sort().map((file) => ({
        file,
        ...parseFileName(file),
        status: before.has(file) && after.has(file) ? 'both' : before.has(file) ? 'removed' : 'added',
    }));
}

const inside = (image, x, y) => x < image.width && y < image.height;

function pixelDiffers(before, after, x, y, threshold) {
    const a = (y * before.width + x) * 4;
    const b = (y * after.width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
        if (Math.abs(before.data[a + channel] - after.data[b + channel]) > threshold) return true;
    }
    return false;
}

/* Images are { width, height, data } with RGBA bytes. The diff image is the after shot
 * faded towards white, with every changed pixel painted in one flat colour. */
function diffPixels(before, after, { threshold = DEFAULT_THRESHOLD } = {}) {
    const width = Math.max(before.width, after.width);
    const height = Math.max(before.height, after.height);
    const data = Buffer.alloc(width * height * 4);
    let changed = 0;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            const inBoth = inside(before, x, y) && inside(after, x, y);
            if (!inBoth || pixelDiffers(before, after, x, y, threshold)) {
                changed += 1;
                data.set(CHANGED_COLOUR, at);
                continue;
            }
            const from = (y * after.width + x) * 4;
            const grey = 0.299 * after.data[from] + 0.587 * after.data[from + 1] + 0.114 * after.data[from + 2];
            const faded = Math.round(255 - (255 - grey) * FADE);
            data.set([faded, faded, faded, 255], at);
        }
    }

    const total = width * height;
    return { width, height, data, changed, total, ratio: total ? changed / total : 0 };
}

function orderByChange(rows) {
    return [...rows].sort((a, b) => (
        rank(a) - rank(b)
        || b.ratio - a.ratio
        || a.file.localeCompare(b.file)
    ));
}

module.exports = { CHANGED_COLOUR, pairShots, diffPixels, orderByChange };
