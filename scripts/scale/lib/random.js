const mulberry32 = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/* One stream per task index, so task n is the same document whatever the total: 10,000 tasks are the first 10,000 of 50,000. */
const randomFor = (index) => {
    const next = mulberry32(Math.imul(index + 1, 0x9e3779b1) ^ 0x5ca1e5ed);
    const int = (max) => Math.floor(next() * max);
    const pick = (list) => list[int(list.length)];
    const weighted = (pairs) => {
        const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
        let at = next() * total;
        for (const [value, weight] of pairs) {
            at -= weight;
            if (at < 0) return value;
        }
        return pairs[pairs.length - 1][0];
    };
    const sample = (list, count) => {
        const pool = [...list];
        const out = [];
        while (out.length < count && pool.length) out.push(pool.splice(int(pool.length), 1)[0]);
        return out;
    };
    return { next, int, pick, weighted, sample, chance: (share) => next() < share };
};

module.exports = { mulberry32, randomFor };
