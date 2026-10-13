// The report's burndown options with every colour taken from the theme tokens. The ideal line stays
// transparent here: reportsV2.css strokes it, as it does on the report page.
export const burndownCardOptions = (base, tokens) => {
    const labels = (axis) => ({ ...axis.labels, style: { ...(axis.labels && axis.labels.style), colors: tokens.ink2 } });
    return {
        ...base,
        colors: [tokens.series[0], 'transparent'],
        legend: { show: false },
        grid: { ...base.grid, borderColor: tokens.grid },
        xaxis: { ...base.xaxis, labels: labels(base.xaxis), axisBorder: { color: tokens.grid }, axisTicks: { color: tokens.grid } },
        yaxis: { ...base.yaxis, labels: labels(base.yaxis) },
        markers: { ...base.markers, strokeColors: tokens.surface },
    };
};
