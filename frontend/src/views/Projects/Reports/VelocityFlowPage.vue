<template>
    <div class="ah-page rp-page">
        <div class="rp-head">
            <h1 class="rp-title">{{ $t('ReportsV2.velocity_title') }}</h1>
            <span class="rp-meta">{{ headline }}</span>
            <ReportsTabs />
            <div class="rp-actions">
                <select v-model="projectId" class="rp-select" :aria-label="$t('ReportsV2.project')">
                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || $t('ReportsV2.untitled_project') }}</option>
                </select>
                <button
                    v-if="splitAvailable" type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm" :class="{ 'ah-btn--outline': humanOnly }"
                    @click="humanOnly = !humanOnly"
                >{{ $t('ReportsV2.human_only') }}</button>
            </div>
        </div>

        <div class="rp-two rp-two--even">
            <div class="rp-card">
                <div class="rp-card__head">
                    {{ $t('ReportsV2.velocity') }}
                    <span class="rp-card__note">{{ velocityNote }}</span>
                </div>

                <div v-if="rows.length" class="rp-bars">
                    <div v-for="(row, i) in rows" :key="row.sprintId" class="rp-bar">
                        <div class="rp-bar__pair">
                            <span
                                class="rp-bar__fill" :class="i === rows.length - 1 ? 'is-current' : ''"
                                :style="{ height: heightOf(completedOf(row)) }"
                                :title="$t('ReportsV2.completed_n', { n: completedOf(row) })"
                            ></span>
                            <span
                                class="rp-bar__fill is-committed"
                                :style="{ height: heightOf(row.committed) }"
                                :title="$t('ReportsV2.committed_n', { n: row.committed })"
                            ></span>
                        </div>
                        <span class="rp-bar__label" :class="i === rows.length - 1 ? 'is-current' : ''">{{ shortName(row.name) }}</span>
                    </div>
                    <div v-if="forecast.ok" class="rp-bar">
                        <div class="rp-bar__pair">
                            <span class="rp-bar__forecast" :style="{ height: heightOf(forecast.mean) }" :title="forecastRange"></span>
                        </div>
                        <span class="rp-bar__label">{{ $t('ReportsV2.next') }}</span>
                    </div>
                </div>
                <div v-else class="rp-empty">
                    <strong>{{ $t('ReportsV2.velocity_empty_title') }}</strong>
                    <span>{{ $t('ReportsV2.velocity_empty_body') }}</span>
                </div>

                <div v-if="rows.length" class="rp-legend">
                    <span><i style="background: var(--ok)"></i>{{ $t('ReportsV2.legend_completed') }}</span>
                    <span><i class="rp-bar__fill is-committed" style="display:inline-block"></i>{{ $t('ReportsV2.legend_committed') }}</span>
                    <span v-if="forecast.ok"><i style="border: 1.5px dashed rgba(47,57,144,.5)"></i>{{ $t('ReportsV2.legend_forecast') }}</span>
                </div>
                <span v-if="humanOnly" class="ah-small">{{ $t('ReportsV2.human_only_note') }}</span>
            </div>

            <div class="rp-card">
                <div class="rp-card__head">
                    {{ $t('ReportsV2.cfd') }}
                    <span class="rp-card__note">{{ $t('ReportsV2.cfd_note') }}</span>
                </div>
                <ApexChart v-if="cfdDays.length" type="area" height="240" :options="cfdOptions" :series="cfdSeries" />
                <div v-else class="rp-empty"><span>{{ $t('ReportsV2.cfd_empty') }}</span></div>
            </div>
        </div>

        <p class="rp-note rp-note--brand">
            <span class="rp-spark">✦</span>
            {{ forecast.ok ? $t('ReportsV2.forecast_line', { low: forecast.low, high: forecast.high, n: forecast.samples }) : $t('ReportsV2.forecast_none', { n: forecast.samples, min: forecast.minSamples }) }}
        </p>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ReportsTabs from './ReportsTabs.vue';
import { forecastBand, completedSeries, hasActorSplit } from './composables/forecast';

defineOptions({ name: 'VelocityFlowPage' });

const { t } = useI18n();

const SPRINT_WINDOW = 6;
const BAR_HEIGHT = 130;

const projects = ref([]);
const projectId = ref('');
const rows = ref([]);
const cfdDays = ref([]);
const humanOnly = ref(false);

const projectName = computed(() => {
    const found = projects.value.find((p) => String(p._id) === projectId.value);
    return found ? (found.ProjectName || '') : '';
});
const headline = computed(() => [projectName.value, t('ReportsV2.last_n_sprints', { n: rows.value.length || SPRINT_WINDOW })]
    .filter(Boolean).join(' · ').toUpperCase());

const splitAvailable = computed(() => hasActorSplit(rows.value));
const completedOf = (row) => {
    if (!humanOnly.value) return Number(row.completed) || 0;
    const human = row.completedHuman !== undefined ? row.completedHuman : row.humanCompleted;
    return Number(human) || 0;
};

const series = computed(() => completedSeries(rows.value, { humanOnly: humanOnly.value }).filter((v) => v !== null));
const forecast = computed(() => forecastBand(series.value, { window: SPRINT_WINDOW }));
const forecastRange = computed(() => (forecast.value.ok ? `${forecast.value.low}–${forecast.value.high}` : ''));

const scaleMax = computed(() => Math.max(
    1,
    ...rows.value.map((r) => Math.max(Number(r.committed) || 0, completedOf(r))),
    forecast.value.ok ? forecast.value.high : 0,
));
const heightOf = (value) => `${Math.max(2, Math.round(((Number(value) || 0) / scaleMax.value) * BAR_HEIGHT))}px`;

const velocityNote = computed(() => {
    if (!rows.value.length) return '';
    const avg = Math.round(series.value.reduce((a, b) => a + b, 0) / Math.max(1, series.value.length));
    return forecast.value.ok
        ? t('ReportsV2.avg_next', { avg, low: forecast.value.low, high: forecast.value.high }).toUpperCase()
        : t('ReportsV2.avg_only', { avg }).toUpperCase();
});

const shortName = (name) => String(name || '').replace(/sprint\s*/i, 'S').slice(0, 6);

const CFD_BANDS = [
    { key: 'close', label: 'ReportsV2.band_done', color: '#2f9e7e' },
    { key: 'inprogress', label: 'ReportsV2.band_progress', color: '#2F3990' },
    { key: 'onhold', label: 'ReportsV2.band_blocked', color: '#c1121f' },
    { key: 'open', label: 'ReportsV2.band_todo', color: '#9aa0b4' },
];

const cfdSeries = computed(() => CFD_BANDS.map((band) => ({
    name: t(band.label),
    data: cfdDays.value.map((day) => Number(day[band.key]) || 0),
})));

const cfdOptions = computed(() => ({
    chart: { id: 'cfd', type: 'area', stacked: true, toolbar: { show: false }, animations: { enabled: false }, fontFamily: 'Inter Tight, sans-serif' },
    colors: CFD_BANDS.map((b) => b.color),
    dataLabels: { enabled: false },
    stroke: { curve: 'straight', width: 1 },
    fill: { type: 'solid', opacity: 0.75 },
    xaxis: { categories: cfdDays.value.map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '10px' } }, tooltip: { enabled: false } },
    yaxis: { min: 0, labels: { style: { fontSize: '10px' } } },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '11px' },
    grid: { borderColor: 'rgba(0,0,0,.07)' },
}));

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projects.value = list.filter((p) => p && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
        if (!projectId.value && projects.value.length) projectId.value = String(projects.value[0]._id);
    } catch (e) { projects.value = []; }
};

const load = async () => {
    rows.value = [];
    cfdDays.value = [];
    if (!projectId.value) return;
    const pid = encodeURIComponent(projectId.value);
    const [vel, cfd] = await Promise.allSettled([
        apiRequest('get', `${env.AGILE_VELOCITY}?projectId=${pid}&limit=${SPRINT_WINDOW}`),
        apiRequest('get', `${env.AGILE_CFD}?projectId=${pid}`),
    ]);
    if (vel.status === 'fulfilled' && vel.value?.data?.status) rows.value = vel.value.data.data.sprints || [];
    if (cfd.status === 'fulfilled' && cfd.value?.data?.status) cfdDays.value = cfd.value.data.data.days || [];
    if (!splitAvailable.value) humanOnly.value = false;
};

watch(projectId, load);
onMounted(loadProjects);
</script>

<style src="./reportsV2.css"></style>
