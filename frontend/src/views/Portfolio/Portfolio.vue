<template>
    <div class="ah-page rp-page">
        <div class="rp-head">
            <h1 class="rp-title">{{ $t('Reports.portfolio_title') }}</h1>
            <span class="rp-meta">{{ headline }}</span>
            <ReportsTabs />
            <div class="rp-actions">
                <select v-model="selectedId" class="rp-select" :aria-label="$t('Reports.portfolio_pick')">
                    <option v-for="p in portfolios" :key="p._id" :value="String(p._id)">{{ p.name }}</option>
                </select>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!selected" @click="openEdit">{{ $t('Reports.edit') }}</button>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openCreate">{{ $t('Reports.new_portfolio') }}</button>
            </div>
        </div>

        <div v-if="!portfolios.length && !loading" class="rp-empty">
            <strong>{{ $t('Reports.portfolio_none_title') }}</strong>
            <span>{{ $t('Reports.portfolio_none_body') }}</span>
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openCreate">{{ $t('Reports.new_portfolio') }}</button>
        </div>

        <div v-else-if="rollup" class="rp-two">
            <div class="rp-col">
                <div class="rp-stats rp-stats--4">
                    <div class="rp-stat">
                        <span class="rp-stat__label">{{ $t('Reports.on_track') }}</span>
                        <span class="rp-stat__value is-ok">{{ rollup.totals.onTrack }}</span>
                    </div>
                    <div class="rp-stat">
                        <span class="rp-stat__label">{{ $t('Reports.at_risk') }}</span>
                        <span class="rp-stat__value is-warn">{{ rollup.totals.atRisk }}</span>
                    </div>
                    <div class="rp-stat">
                        <span class="rp-stat__label">{{ $t('Reports.off_track') }}</span>
                        <span class="rp-stat__value is-danger">{{ rollup.totals.offTrack }}</span>
                    </div>
                    <div class="rp-stat">
                        <span class="rp-stat__label">{{ $t('Reports.team_load') }}</span>
                        <span class="rp-stat__value">{{ capacity ? `${capacity.totals.utilizationPct}%` : '—' }}</span>
                    </div>
                </div>

                <div class="rp-card">
                    <div class="rp-card__head">
                        {{ burndownTitle }}
                        <span v-if="burndownNote" class="rp-card__note">{{ burndownNote }}</span>
                    </div>
                    <ApexChart v-if="burndownDays.length" type="line" height="230" :options="burndownOptions" :series="burndownSeries" />
                    <div v-else class="rp-empty"><span>{{ $t('Reports.no_active_sprint') }}</span></div>
                </div>

                <div class="rp-card">
                    <div class="rp-card__head">
                        {{ $t('Reports.at_risk_now') }}
                        <span class="rp-card__note">{{ atRisk.length }}</span>
                    </div>
                    <div v-for="p in atRisk" :key="p.projectId" class="rp-meter">
                        <span class="rp-meter__name" :title="p.name">{{ p.name }}</span>
                        <span class="rp-meter__track"><span class="rp-meter__fill" :class="{ 'is-over': p.health === 'off-track' }" :style="{ width: `${p.progressPct}%` }"></span></span>
                        <span class="rp-meter__pct">{{ p.progressPct }}%</span>
                        <span class="ah-chip" :class="p.health === 'off-track' ? 'ah-chip--danger' : 'ah-chip--warn'">{{ $t(`Reports.h_${p.health.replace('-', '_')}`) }}</span>
                        <span class="rp-row__data">{{ $t('Reports.n_overdue', { n: p.overdue }) }}</span>
                    </div>
                    <span v-if="!atRisk.length" class="ah-small">{{ $t('Reports.nothing_at_risk') }}</span>
                </div>
            </div>

            <div class="rp-col">
                <div class="rp-dark">
                    <div class="rp-dark__head">
                        <span class="rp-dark__mark"><ShellIcon name="ai" :size="13" /></span>
                        <span>{{ $t('Reports.digest_title') }}</span>
                        <span v-if="summaryModel" class="rp-dark__meta">{{ summaryModel }}</span>
                    </div>
                    <div v-if="summary" class="rp-dark__body">{{ summary }}</div>
                    <div v-else class="rp-dark__body">{{ $t(`Reports.digest_${summaryReason}`) }}</div>
                </div>

                <div class="rp-card">
                    <div class="rp-card__head">
                        {{ $t('Reports.capacity_week') }}
                        <span class="rp-card__note">{{ capacity ? $t('Reports.n_people', { n: capacity.totals.users }) : '' }}</span>
                    </div>
                    <div v-for="u in capacityRows" :key="u.userId" class="rp-meter">
                        <span class="rp-meter__name" :title="u.name">{{ u.name }}</span>
                        <span class="rp-meter__track">
                            <span class="rp-meter__fill" :class="{ 'is-over': u.status === 'over' }" :style="{ width: `${Math.min(100, u.utilizationPct)}%` }"></span>
                        </span>
                        <span class="rp-meter__pct" :class="{ 'is-over': u.status === 'over' }">{{ u.utilizationPct }}%</span>
                        <span v-if="u.ptoHours" class="rp-row__data">{{ $t('Reports.pto_h', { h: Math.round(u.ptoHours) }) }}</span>
                    </div>
                    <span v-if="!capacityRows.length" class="ah-small">{{ $t('Reports.no_capacity') }}</span>
                </div>
            </div>
        </div>

        <div v-if="showForm" class="rp-modal-bg" @click.self="showForm = false">
            <div class="rp-modal">
                <h2 class="ah-h2">{{ editing ? $t('Reports.edit_portfolio') : $t('Reports.new_portfolio') }}</h2>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Reports.portfolio_name') }}</span>
                    <input v-model="form.name" class="ah-input" :placeholder="$t('Reports.portfolio_name_ph')" />
                </label>
                <div class="rp-modal__list ah-scroll">
                    <label v-for="pr in allProjects" :key="pr._id" class="rp-row">
                        <input type="checkbox" :value="String(pr._id)" v-model="form.projectIds" />
                        <span class="rp-row__name">{{ pr.ProjectName || $t('Reports.untitled_project') }}</span>
                    </label>
                    <span v-if="!allProjects.length" class="ah-small">{{ $t('Reports.no_company_projects') }}</span>
                </div>
                <div class="rp-modal__actions">
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !form.name.trim()" @click="savePortfolio">
                        {{ busy ? $t('Reports.saving') : $t('Reports.save') }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--ghost" @click="showForm = false">{{ $t('Reports.cancel') }}</button>
                    <button v-if="editing" type="button" class="ah-btn ah-btn--ghost" @click="removeSelected">{{ $t('Reports.delete') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import ReportsTabs from '@/views/Projects/Reports/ReportsTabs.vue';

defineOptions({ name: 'PortfolioReport' });

const { t } = useI18n();

const portfolios = ref([]);
const selectedId = ref('');
const rollup = ref(null);
const capacity = ref(null);
const burndown = ref(null);
const burndownProject = ref('');
const summary = ref('');
const summaryModel = ref('');
const summaryReason = ref('unavailable');
const allProjects = ref([]);
const loading = ref(false);
const busy = ref(false);
const showForm = ref(false);
const editing = ref(false);
const form = reactive({ name: '', projectIds: [] });

const selected = computed(() => portfolios.value.find((p) => String(p._id) === selectedId.value) || null);

const headline = computed(() => {
    const count = rollup.value ? rollup.value.totals.projects : 0;
    return t('Reports.portfolio_head', { n: count, week: moment().startOf('week').format('MMM D') }).toUpperCase();
});

const atRisk = computed(() => (rollup.value ? rollup.value.projects : [])
    .filter((p) => p.health !== 'on-track')
    .sort((a, b) => b.overdue - a.overdue));

const capacityRows = computed(() => ((capacity.value && capacity.value.users) || []).slice(0, 6));

const burndownDays = computed(() => ((burndown.value && burndown.value.days) || []));
const burndownTitle = computed(() => (burndown.value && burndown.value.sprintName
    ? `${burndown.value.sprintName} · ${burndownProject.value}`
    : t('Reports.burndown')));
const burndownNote = computed(() => {
    if (!burndown.value || !burndown.value.endDate) return '';
    const left = moment(burndown.value.endDate).diff(moment(), 'days');
    return left >= 0 ? t('Reports.days_left', { n: left }).toUpperCase() : t('Reports.sprint_over').toUpperCase();
});

const burndownSeries = computed(() => [
    { name: t('Reports.remaining'), data: burndownDays.value.map((d) => (d.remainingPoints === null ? null : Number(d.remainingPoints) || 0)) },
    { name: t('Reports.ideal'), data: burndownDays.value.map((d) => Number(d.idealPoints) || 0) },
]);

const burndownOptions = computed(() => ({
    chart: { id: 'portfolio-burndown', toolbar: { show: false }, animations: { enabled: false }, fontFamily: 'Inter Tight, sans-serif' },
    colors: ['#2F3990', 'rgba(0,0,0,.2)'],
    stroke: { width: [2.5, 1.5], dashArray: [0, 5], curve: 'straight' },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    xaxis: { categories: burndownDays.value.map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '10px' } }, tooltip: { enabled: false } },
    yaxis: { min: 0, labels: { style: { fontSize: '10px' } } },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '11px' },
    grid: { borderColor: 'rgba(0,0,0,.07)' },
}));

const loadPortfolios = async () => {
    loading.value = true;
    try {
        const body = (await apiRequest('get', env.PORTFOLIO))?.data;
        portfolios.value = (body && body.data) || [];
        if (!selectedId.value && portfolios.value.length) selectedId.value = String(portfolios.value[0]._id);
    } catch (e) { portfolios.value = []; } finally { loading.value = false; }
};

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        allProjects.value = list.filter((p) => p && p.status !== 'close' && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) { allProjects.value = []; }
};

const loadCapacity = async () => {
    const from = moment().startOf('week').format('YYYY-MM-DD');
    const to = moment().endOf('week').format('YYYY-MM-DD');
    try {
        const body = (await apiRequest('get', `${env.CAPACITY}?from=${from}&to=${to}`))?.data;
        capacity.value = (body && body.status) ? body.data : null;
    } catch (e) { capacity.value = null; }
};

// The burn-down shown is the one that matters most: the active sprint of the
// project furthest from on-track.
const loadBurndown = async () => {
    burndown.value = null;
    burndownProject.value = '';
    const candidate = atRisk.value[0] || (rollup.value ? rollup.value.projects[0] : null);
    if (!candidate) return;
    try {
        const res = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${candidate.projectId}?collection=sprints`);
        const sprints = res?.data?.data || res?.data || [];
        const active = (sprints || []).find((s) => s && s.isScrum === true && s.state === 'active')
            || (sprints || []).filter((s) => s && s.isScrum === true).sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))[0];
        if (!active) return;
        const body = (await apiRequest('get', `${env.AGILE_BURNDOWN}?sprintId=${encodeURIComponent(String(active._id || active.id))}`))?.data;
        if (body && body.status) {
            burndown.value = body.data;
            burndownProject.value = candidate.name;
        }
    } catch (e) { burndown.value = null; }
};

const loadSummary = async () => {
    summary.value = '';
    summaryModel.value = '';
    summaryReason.value = 'unavailable';
    if (!selectedId.value) return;
    try {
        const body = (await apiRequest('post', env.PORTFOLIO_SUMMARY, { portfolioId: selectedId.value }))?.data;
        if (body && body.status && body.data) {
            summary.value = body.data.summary || '';
            summaryModel.value = body.data.model || '';
            summaryReason.value = body.data.reason || 'unavailable';
        }
    } catch (e) { summaryReason.value = 'unavailable'; }
};

const loadRollup = async () => {
    rollup.value = null;
    if (!selectedId.value) return;
    try {
        const body = (await apiRequest('get', `${env.PORTFOLIO}/${selectedId.value}/rollup`))?.data;
        if (body && body.status) rollup.value = body.data;
    } catch (e) { rollup.value = null; }
    await Promise.all([loadBurndown(), loadSummary()]);
};

const openCreate = () => { editing.value = false; form.name = ''; form.projectIds = []; showForm.value = true; };
const openEdit = () => {
    if (!selected.value) return;
    editing.value = true;
    form.name = selected.value.name;
    form.projectIds = (selected.value.projectIds || []).map(String);
    showForm.value = true;
};

const savePortfolio = async () => {
    if (busy.value || !form.name.trim()) return;
    busy.value = true;
    try {
        const body = { name: form.name.trim(), projectIds: form.projectIds };
        if (editing.value && selected.value) await apiRequest('put', `${env.PORTFOLIO}/${selected.value._id}`, body);
        else await apiRequest('post', env.PORTFOLIO, body);
        showForm.value = false;
        await loadPortfolios();
        const match = portfolios.value.find((x) => x.name === body.name);
        if (match) selectedId.value = String(match._id);
        await loadRollup();
    } catch (e) { /* the reload shows what actually saved */ } finally { busy.value = false; }
};

const removeSelected = async () => {
    if (!selected.value) return;
    try {
        await apiRequest('delete', `${env.PORTFOLIO}/${selected.value._id}`);
        showForm.value = false;
        selectedId.value = '';
        rollup.value = null;
        await loadPortfolios();
    } catch (e) { /* the reload shows what actually deleted */ }
};

watch(selectedId, loadRollup);
onMounted(() => { loadPortfolios(); loadProjects(); loadCapacity(); });
</script>

<style src="@/views/Projects/Reports/reportsV2.css"></style>
<style scoped>
.rp-modal-bg { position: fixed; inset: 0; background: rgba(20, 22, 40, .45); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.rp-modal { background: var(--surface); border-radius: var(--r-modal); padding: 20px; width: 440px; max-width: 92vw; max-height: 84vh; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-modal); }
.rp-modal__list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; border: 1px solid var(--hairline); border-radius: var(--r-input); padding: 10px; }
.rp-modal__actions { display: flex; gap: 8px; }
</style>
