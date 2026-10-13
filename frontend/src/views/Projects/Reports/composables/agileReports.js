import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { forecastBand, completedSeries } from './forecast';

const dataOf = (res) => {
    const body = res && res.data;
    if (!body || !body.status) throw Object.assign(new Error((body && body.statusText) || 'report failed'), { statusText: (body && body.statusText) || '' });
    return body.data || {};
};

export const fetchBurndown = (sprintId) => apiRequest('get', `${env.AGILE_BURNDOWN}?sprintId=${encodeURIComponent(sprintId)}`).then(dataOf);

export const fetchVelocity = (projectId, limit) => apiRequest('get', `${env.AGILE_VELOCITY}?projectId=${encodeURIComponent(projectId)}&limit=${limit}`).then(dataOf);

export const fetchSprints = async (projectId) => {
    const res = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${encodeURIComponent(projectId)}?collection=sprints`);
    const list = (res && res.data && (res.data.data || res.data)) || [];
    return Array.isArray(list) ? list : [];
};

/* A backlog has no time box, so its burndown would run from its oldest task to today; a folder holds no tasks.
 * Plain lists stay: they chart, just without a box. */
export const sprintChoices = (list) => (list || [])
    .filter((s) => s && s._id && !s.isFolder && !s.isBacklog && s.mainChat !== true && s.deletedStatusKey !== 1)
    .map((s) => ({ _id: String(s._id), name: s.name || s.sprintName || '' }));

const REMAINING = { points: 'remainingPoints', count: 'remainingCount' };
const IDEAL = { points: 'idealPoints', count: 'ideal' };

/* null is a day the sprint has not reached; coercing it to 0 would draw a running sprint as finished. */
export const burndownSeries = (days, { metric = 'points', remaining = '', ideal = '' } = {}) => {
    const key = REMAINING[metric] || REMAINING.points;
    const idealKey = IDEAL[metric] || IDEAL.points;
    return [
        { name: remaining, data: (days || []).map((d) => (d[key] === null ? null : Number(d[key]) || 0)) },
        { name: ideal, data: (days || []).map((d) => Number(d[idealKey]) || 0) },
    ];
};

export const burndownOptions = (days, { id = 'sprint-burndown', markers = [] } = {}) => ({
    chart: { id, toolbar: { show: false }, animations: { enabled: false }, fontFamily: 'Inter Tight, sans-serif' },
    // Remaining is the data series and stays literal. The ideal line is a reference rule, not data, so
    // reportsV2.css strokes it from a token — a literal black tint vanished on a dark card.
    colors: ['#2F3990', 'transparent'],
    stroke: { width: [2.5, 1.5], dashArray: [0, 5], curve: 'straight' },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    xaxis: { categories: (days || []).map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '10px' } }, tooltip: { enabled: false } },
    yaxis: { min: 0, labels: { style: { fontSize: '10px' } } },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '11px' },
    annotations: { xaxis: markers },
    tooltip: { shared: true },
});

export const velocityScale = (rows, { humanOnly = false, window = 6, barHeight = 130 } = {}) => {
    const list = rows || [];
    const completedOf = (row) => {
        if (!humanOnly) return Number(row.completed) || 0;
        const human = row.completedHuman !== undefined ? row.completedHuman : row.humanCompleted;
        return Number(human) || 0;
    };
    const series = completedSeries(list, { humanOnly }).filter((v) => v !== null);
    const forecast = forecastBand(series, { window });
    const max = Math.max(1, ...list.map((r) => Math.max(Number(r.committed) || 0, completedOf(r))), forecast.ok ? forecast.high : 0);
    const heightOf = (value) => `${Math.max(2, Math.round(((Number(value) || 0) / max) * barHeight))}px`;
    const average = series.length ? Math.round(series.reduce((a, b) => a + b, 0) / series.length) : 0;
    return { completedOf, heightOf, forecast, series, average };
};
