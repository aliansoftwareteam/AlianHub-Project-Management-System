import { onBeforeUnmount, onMounted, ref } from 'vue';

const SERIES = ['--brand', '--ok', '--warn', '--agent', '--danger', '--ink-2'];

// The build may rewrite a token to hsla() or another notation; the browser turns it into the rgb() a chart library parses.
const asRgb = (value) => {
    if (!value) return value;
    const probe = document.createElement('span');
    probe.style.color = value;
    document.documentElement.appendChild(probe);
    const colour = window.getComputedStyle(probe).color;
    probe.remove();
    return colour || value;
};

// A chart library paints SVG from its options, which cannot hold var(); the tokens are resolved here.
export function readChartTokens() {
    const style = window.getComputedStyle(document.documentElement);
    const token = (name) => asRgb(style.getPropertyValue(name).trim());
    return {
        series: SERIES.map(token),
        ink2: token('--ink-2'),
        grid: token('--hairline'),
        surface: token('--surface'),
    };
}

export function useChartTokens() {
    const tokens = ref(readChartTokens());
    let observer = null;
    onMounted(() => {
        tokens.value = readChartTokens();
        observer = new MutationObserver(() => { tokens.value = readChartTokens(); });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    });
    onBeforeUnmount(() => { if (observer) observer.disconnect(); });
    return tokens;
}
