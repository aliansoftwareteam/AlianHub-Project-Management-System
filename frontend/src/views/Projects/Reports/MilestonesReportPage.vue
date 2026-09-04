<template>
    <div class="ah-page rp-page">
        <div class="rp-head">
            <h1 class="rp-title">{{ $t('Reports.milestones_title') }}</h1>
            <span class="rp-meta">{{ headline }}</span>
            <ReportsTabs />
            <div class="rp-actions">
                <select v-model="projectId" class="rp-select" :aria-label="$t('Reports.project')">
                    <option value="">{{ $t('Reports.all_projects') }}</option>
                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || $t('Reports.untitled_project') }}</option>
                </select>
            </div>
        </div>

        <p v-if="error" class="rp-error">{{ error }}</p>

        <div v-if="rows.length" class="rp-table">
            <div class="rp-thead">
                <span>{{ $t('Reports.col_milestone') }}</span>
                <span>{{ $t('Reports.col_baseline') }}</span>
                <span>{{ $t('Reports.col_now') }}</span>
                <span>{{ $t('Reports.col_slip') }}</span>
                <span>{{ $t('Reports.col_state') }}</span>
            </div>
            <div v-for="row in rows" :key="row.milestoneId" class="rp-tr rp-tr--static" :class="{ 'is-missed': row.state === 'missed' }">
                <span>
                    <span class="rp-tr__name">{{ row.name }}</span>
                    <span class="rp-tr__sub" :class="{ 'is-danger': row.state === 'missed' }">{{ subLine(row) }}</span>
                </span>
                <span class="rp-num is-muted">{{ fullDate(row.baseline) }}</span>
                <span class="rp-num">{{ fullDate(row.target) }}</span>
                <span class="rp-num" :class="slipTone(row)">{{ slipText(row) }}</span>
                <span class="ah-chip" :class="chipClass(row.state)">{{ $t(`Reports.state_${row.state.replace('-', '_')}`) }}</span>
            </div>
        </div>

        <div v-else-if="!loading" class="rp-empty">
            <strong>{{ $t('Reports.milestones_empty_title') }}</strong>
            <span>{{ $t('Reports.milestones_empty_body') }}</span>
        </div>

        <p class="rp-note">{{ $t('Reports.milestones_footnote') }}</p>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ReportsTabs from './ReportsTabs.vue';

defineOptions({ name: 'MilestonesReportPage' });

const { t } = useI18n();

const projects = ref([]);
const projectId = ref('');
const rows = ref([]);
const totals = ref({ total: 0, atRisk: 0, missed: 0 });
const loading = ref(false);
const error = ref('');

const headline = computed(() => t('Reports.milestones_head', {
    total: totals.value.total || 0,
    risk: totals.value.atRisk || 0,
    missed: totals.value.missed || 0,
}).toUpperCase());

const fullDate = (ms) => {
    if (!ms) return '—';
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const subLine = (row) => {
    const parts = [row.projectName || t('Reports.untitled_project'), t('Reports.n_tasks', { n: row.tasks })];
    if (row.lastMove && row.lastMove.by) {
        parts.push(t('Reports.moved_by', { who: row.lastMove.by, when: fullDate(new Date(row.lastMove.at).getTime()) }));
    }
    return parts.join(' · ');
};

const slipText = (row) => {
    if (row.state === 'missed') return t('Reports.missed');
    if (row.slipDays === null || row.slipDays === 0) return '—';
    return row.slipDays > 0 ? `+${row.slipDays}d` : `${row.slipDays}d`;
};
const slipTone = (row) => {
    if (row.state === 'missed') return 'is-danger';
    if (row.slipDays > 0) return 'is-warn';
    return 'is-muted';
};
const chipClass = (state) => ({
    'on-track': 'ah-chip--ok',
    done: 'ah-chip--ok',
    'at-risk': 'ah-chip--warn',
    missed: 'ah-chip--danger',
}[state] || '');

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projects.value = list.filter((p) => p && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) { projects.value = []; }
};

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const query = projectId.value ? `?projectId=${encodeURIComponent(projectId.value)}` : '';
        const body = (await apiRequest('get', `${env.AGILE_MILESTONES}${query}`))?.data;
        if (body && body.status) {
            rows.value = body.data.milestones || [];
            totals.value = body.data.totals || { total: 0, atRisk: 0, missed: 0 };
        } else {
            error.value = (body && body.statusText) || t('Reports.load_failed');
            rows.value = [];
        }
    } catch (e) {
        error.value = e?.message || t('Reports.load_failed');
        rows.value = [];
    } finally {
        loading.value = false;
    }
};

watch(projectId, load);
onMounted(() => { loadProjects(); load(); });
</script>

<style src="./reportsV2.css"></style>
