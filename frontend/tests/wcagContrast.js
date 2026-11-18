// Independent of src/utils/statusChipColors.js so the specs do not grade the helper with its own maths.
const SURFACES = {
    light: ['#ffffff', '#faf9f7', '#f7f6f3'],
    dark: ['#111114', '#18181c', '#1d1d22']
};

function rgba(value) {
    const input = String(value).trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input);
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
        const [r, g, b, a = 255] = digits.match(/../g).map((pair) => parseInt(pair, 16));
        return [r, g, b, a / 255];
    }
    const fn = /^rgba?\(([^)]+)\)$/i.exec(input);
    if (!fn) throw new Error(`not a colour: ${value}`);
    const [r, g, b, a = '1'] = fn[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), a.endsWith('%') ? parseFloat(a) / 100 : Number(a)];
}

const over = ([r, g, b, a], [sr, sg, sb]) => [r * a + sr * (1 - a), g * a + sg * (1 - a), b * a + sb * (1 - a), 1];

const luminance = (rgb) => rgb.slice(0, 3)
    .map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

export function contrastOn(text, background, surface) {
    const bg = over(rgba(background), rgba(surface));
    const fg = over(rgba(text), bg);
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

export function worstContrast(text, background, theme) {
    return Math.min(...SURFACES[theme].map((surface) => contrastOn(text, background, surface)));
}

export function inkOf(style) {
    const match = /var\(--status-ink,\s*(#[0-9a-f]{6})\)/i.exec(style.color || '');
    return match ? match[1] : style.color;
}
