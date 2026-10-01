const { parseArgs: rawArgs } = require('../demo/lib/cli');

const THEMES = ['light', 'dark'];
const VARIANTS = ['a', 'b', 'c', 'classic'];
const DEFAULT_SIZES = '1440x900,390x844';
const SEPARATOR = '__';
const SHOT = /^([a-z0-9]+(?:-[a-z0-9]+)*)__([a-z]+)__(\d+x\d+)\.png$/;

const isScreenName = (name) => typeof name === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);

const fileName = ({ screen, theme, size }) => `${[screen, theme, size].join(SEPARATOR)}.png`;

const parseFileName = (file) => {
    const match = SHOT.exec(String(file));
    return match ? { screen: match[1], theme: match[2], size: match[3] } : null;
};

const parseSize = (value) => {
    const match = /^(\d+)x(\d+)$/.exec(String(value).trim());
    if (!match) throw new Error(`"${value}" is not a size. Write width x height, like 390x844.`);
    return { label: `${match[1]}x${match[2]}`, width: Number(match[1]), height: Number(match[2]) };
};

const list = (value) => String(value).split(',').map((item) => item.trim()).filter(Boolean);

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function parseArgs(argv) {
    const raw = rawArgs(argv);
    const themes = list(raw.themes || THEMES.join(','));
    const unknownTheme = themes.find((theme) => !THEMES.includes(theme));
    if (unknownTheme || !themes.length) throw new Error(`--themes takes ${THEMES.join(', ')}.`);
    const variant = text(raw.variant);
    if (raw.variant !== undefined && !VARIANTS.includes(variant)) throw new Error(`--variant takes one of ${VARIANTS.join(', ')}.`);
    return {
        baseUrl: String(raw['base-url'] || 'http://localhost:4000').replace(/\/+$/, ''),
        out: text(raw.out),
        only: raw.only ? list(raw.only) : null,
        themes,
        sizes: list(raw.sizes || DEFAULT_SIZES).map(parseSize),
        variant,
        tokenFile: text(raw['token-file']),
        company: text(raw.company),
        project: text(raw.project),
    };
}

const pad = (n) => String(n).padStart(2, '0');

const timestamp = (date = new Date()) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;

module.exports = { THEMES, VARIANTS, fileName, parseFileName, parseSize, parseArgs, isScreenName, timestamp };
