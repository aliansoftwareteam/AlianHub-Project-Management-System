import { onBeforeUnmount, onMounted, ref } from 'vue';

const SERIES = ['--brand', '--ok', '--warn', '--agent', '--danger', '--ink-2'];

// A chart library paints SVG from its options, which cannot hold var(); the tokens are resolved here.
export function readChartTokens() {
    const style = window.getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(name).trim();
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
