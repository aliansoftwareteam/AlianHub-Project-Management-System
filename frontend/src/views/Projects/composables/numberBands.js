const MAX_BANDS = 5;

/* Read as the server's $convert to double reads it, so a task lands in the same band in the browser as in the group's query. */
export const numberOf = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const rounded = (number) => Math.round(number * 100) / 100;

/* Where one band ends and the next begins: up to five even bands from `min` to `max`, on whole numbers when both ends are whole. */
export function bandEdges(min, max) {
    if (!(max > min)) return [];
    const whole = Number.isInteger(min) && Number.isInteger(max);
    const step = whole ? Math.ceil((max - min) / MAX_BANDS) : (max - min) / MAX_BANDS;
    const edges = [];
    for (let at = 1; at < MAX_BANDS && rounded(min + step * at) < max; at += 1) edges.push(rounded(min + step * at));
    return edges;
}

/* The first band has no lower end and the last no upper end, so a value outside the range the bands were cut from still has a group. */
export function numberBands(range) {
    const edges = range ? bandEdges(range[0], range[1]) : [];
    if (!edges.length) return [{ from: null, to: null }];
    return [
        { from: null, to: edges[0] },
        ...edges.slice(0, -1).map((from, at) => ({ from, to: edges[at + 1] })),
        { from: edges[edges.length - 1], to: null }
    ];
}

export const inBand = (number, band) => number !== null && (band.from === null || number >= band.from) && (band.to === null || number < band.to);
