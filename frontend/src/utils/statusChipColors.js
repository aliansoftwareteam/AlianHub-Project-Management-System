const AA_TEXT = 4.5;
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
// The hardest surface a chip sits on in each theme: --canvas in light, --surface-2 in dark.
const LIGHT_SURFACE = [247, 246, 243];
const DARK_SURFACE = [29, 29, 34];
// Stored tints are the status colour at alpha 0x35, as the status editors save them.
const TINT_ALPHA = 0.21;
const THEME_FALLBACK = { background: "var(--fill)", color: "var(--ink)" };

function parseColor(value) {
    if (typeof value !== "string") return null;
    const input = value.trim().toLowerCase();
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(input);
    if (hex) {
        const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
        const channels = digits.match(/../g).map((pair) => parseInt(pair, 16));
        return { rgb: channels.slice(0, 3), alpha: channels.length === 4 ? channels[3] / 255 : 1 };
    }
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(input);
    if (!fn) return null;
    const rgb = fn.slice(1, 4).map(Number);
    const alpha = fn[4] === undefined ? 1 : Number(fn[4]) / (fn[5] ? 100 : 1);
    if (rgb.some((c) => !(c <= 255)) || !(alpha >= 0 && alpha <= 1)) return null;
    return { rgb, alpha };
}

const over = (rgb, alpha, surface) => rgb.map((c, i) => c * alpha + surface[i] * (1 - alpha));

function luminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

// Walks the status colour toward black or white, whichever the background leaves room for,
// and stops at the first shade that passes; one end always clears 4.5:1 on any background.
function readableInk(ink, background) {
    const target = contrast(BLACK, background) >= contrast(WHITE, background) ? BLACK : WHITE;
    for (let step = 0; step <= 20; step += 1) {
        const shade = ink.map((c, i) => Math.round(c + (target[i] - c) * (step / 20)));
        if (contrast(shade, background) >= AA_TEXT) return toHex(shade);
    }
    return toHex(target);
}

export function statusChipColors(status, { dark = false } = {}) {
    const text = parseColor(status?.textColor);
    const tint = parseColor(status?.bgColor);
    if (!text && !tint) return { ...THEME_FALLBACK };
    const fill = tint || { rgb: text.rgb, alpha: TINT_ALPHA };
    const background = over(fill.rgb, fill.alpha, dark ? DARK_SURFACE : LIGHT_SURFACE);
    const ink = text ? over(text.rgb, text.alpha, background) : fill.rgb;
    return {
        background: tint ? status.bgColor.trim() : `rgba(${text.rgb.join(", ")}, ${TINT_ALPHA})`,
        color: readableInk(ink, background)
    };
}

// The dark text rides along as --status-ink-dark; tokens.css swaps it in under the dark theme
// on elements that carry the ah-status-ink class.
export function statusChipStyle(status) {
    const light = statusChipColors(status);
    return {
        background: light.background,
        color: `var(--status-ink, ${light.color})`,
        "--status-ink-dark": statusChipColors(status, { dark: true }).color
    };
}

export function statusChipCss(status) {
    const style = statusChipStyle(status);
    return `background:${style.background};color:${style.color};--status-ink-dark:${style["--status-ink-dark"]}`;
}
