<template>
    <div class="ah-page rp-page">
        <div class="rp-head">
            <h1 class="rp-title">{{ sprintName || $t('Reports.sprint_title') }}</h1>
            <span v-if="headline" class="rp-meta">{{ headline }}</span>
            <ReportsTabs />
            <div class="rp-actions">
                <select v-model="projectId" class="rp-select" :aria-label="$t('Reports.project')">
                    <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || $t('Reports.untitled_project') }}</option>
                </select>
                <select v-model="sprintId" class="rp-select" :aria-label="$t('Reports.sprint')">
                    <option v-for="s in sprintOptions" :key="s._id" :value="s._id">{{ s.name }}</option>
                </select>
            </div>
        </div>

        <p v-if="error" class="rp-error">{{ error }}</p>

        <div v-if="!loading && !report" class="rp-empty">
            <strong>{{ $t('Reports.sprint_none_title') }}</strong>
            <span>{{ $t('Reports.sprint_none_body') }}</span>
        </div>

        <template v-else-if="report">
            <p class="rp-note rp-note--brand">{{ takeaway }}</p>

            <div class="rp-stats rp-stats--5">
                <button
                    v-for="card in cards" :key="card.key" type="button"
                    class="rp-stat" :class="{ 'is-active': focus === card.key }"
                    :disabled="!card.focusable" @click="focus = card.key"
                >
                    <span class="rp-stat__label">{{ card.label }}</span>
                    <span class="rp-stat__value" :class="card.tone">
                        {{ card.value }}<span class="rp-stat__unit"> {{ card.unit }}</span>
                    </span>
                </button>
            </div>

            <div class="rp-two">
                <div class="rp-card">
                    <div class="rp-card__head">
                        {{ $t('Reports.burndown') }}
                        <span class="rp-card__note">{{ $t('Reports.burndown_note') }}</span>
                    </div>
                    <ApexChart v-if="burndownDays.length" type="line" height="260" :options="burndownOptions" :series="burndownSeries" />
                    <div v-else class="rp-empty"><span>{{ $t('Reports.burndown_empty') }}</span></div>
                </div>

                <div class="rp-col">
                    <div class="rp-card">
                        <div class="rp-card__head">
                            {{ focusTitle }}
                            <span class="rp-card__note">{{ focusList.length }}</span>
                        </div>
                        <button
                            v-for="row in focusList" :key="row.taskId" type="button" class="rp-row"
                            @click="open(row)"
                        >
                            <span class="rp-dot" :class="row.tone"></span>
                            <span class="rp-row__name">{{ row.name }}</span>
                            <span class="rp-row__data">{{ row.meta }}</span>
                        </button>
                        <span v-if="!focusList.length" class="ah-small">{{ $t('Reports.nothing_here') }}</span>
                    </div>

                    <div v-if="blockers.length" class="rp-card">
                        <div class="rp-card__head">
                            {{ $t('Reports.blocked') }}
                            <span class="rp-card__note">{{ $t('Reports.blocked_note') }}</span>
                        </div>
                        <button v-for="b in blockers" :key="b.taskId" type="button" class="rp-row" @click="open(b)">
                            <span class="rp-dot is-danger"></span>
                            <span class="rp-row__name">{{ b.name }}</span>
                            <span class="rp-row__data">{{ $t('Reports.blocked_days', { days: b.blockedDays }) }}</span>
                        </button>
                    </div>

                    <div class="rp-dark">
                        <div class="rp-dark__head">
                            <span class="rp-dark__mark"><ShellIcon name="reports" :size="13" /></span>
                            <span>{{ $t('Reports.retro_title') }}</span>
                        </div>
                        <div class="rp-dark__body">
                            <span v-for="(line, i) in retroLines" :key="i">{{ line }} </span>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { openTask } from '@/components/organisms/TaskDetailOverlay/useTaskOverlay';
import ReportsTabs from './ReportsTabs.vue';

defineOptions({ name: 'SprintReportPage' });

const route = useRoute();
const { t } = useI18n();

const cid = computed(() => String(route.params.cid || ''));
const projects = ref([]);
const sprints = ref([]);
const projectId = ref('');
const sprintId = ref('');
const report = ref(null);
const insights = ref(null);
const burndown = ref(null);
const hours = ref(null);
const loading = ref(false);
const error = ref('');
const focus = ref('carry');

const sprintOptions = computed(() => (sprints.value || [])
    .filter((s) => s && s.isScrum === true && !s.isBacklog && s.mainChat !== true)
    .map((s) => ({ _id: String(s._id || s.id), name: s.name || t('Reports.sprint'), startDate: s.startDate }))
    .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0)));

const sprintName = computed(() => (report.value ? report.value.sprintName : ''));

const shortDate = (value) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const projectName = computed(() => {
    const found = projects.value.find((p) => String(p._id) === projectId.value);
    return found ? (found.ProjectName || '') : '';
});

const headline = computed(() => {
    if (!report.value) return '';
    const range = [shortDate(report.value.startDate), shortDate(report.value.endDate)].filter(Boolean).join('–');
    return [projectName.value, range, t(`Reports.state_${report.value.state || 'planned'}`)].filter(Boolean).join(' · ').toUpperCase();
});

const pts = (group) => Number(group && group.points) || 0;
const tasksOf = (group) => Number(group && group.tasks) || 0;
const completionPct = computed(() => {
    const committed = pts(report.value && report.value.committed);
    if (!committed) return 0;
    return Math.round((pts(report.value.completed) / committed) * 100);
});
const loggedHours = computed(() => Math.round(((hours.value && hours.value.loggedMinutes) || 0) / 60));
const plannedHours = computed(() => Math.round(((hours.value && hours.value.plannedMinutes) || 0) / 60));

const cards = computed(() => {
    if (!report.value) return [];
    const r = report.value;
    return [
        { key: 'committed', label: t('Reports.committed'), value: pts(r.committed), unit: t('Reports.pts'), tone: '', focusable: true },
        { key: 'completed', label: t('Reports.completed'), value: pts(r.completed), unit: `${completionPct.value}%`, tone: 'is-ok', focusable: true },
        { key: 'added', label: t('Reports.added_mid'), value: `+${pts(r.addedAfterStart)}`, unit: t('Reports.n_tasks', { n: tasksOf(r.addedAfterStart) }), tone: 'is-warn', focusable: true },
        { key: 'carry', label: t('Reports.carry_over'), value: pts(r.unfinished), unit: t('Reports.n_tasks', { n: tasksOf(r.unfinished) }), tone: 'is-danger', focusable: true },
        { key: 'hours', label: t('Reports.logged_est'), value: `${loggedHours.value}`, unit: `/${plannedHours.value}h`, tone: '', focusable: false },
    ];
});

const blockerById = computed(() => {
    const map = {};
    ((insights.value && insights.value.blockers) || []).forEach((b) => { map[b.taskId] = b; });
    return map;
});
const blockers = computed(() => (insights.value && insights.value.blockers) || []);
const scopeAddById = computed(() => {
    const map = {};
    ((insights.value && insights.value.scopeAdds) || []).forEach((a) => { map[a.taskId] = a; });
    return map;
});

const focusTitle = computed(() => t(`Reports.focus_${focus.value}`));

const sprintTasks = computed(() => (insights.value && insights.value.tasks) || []);

const focusList = computed(() => {
    const r = report.value;
    if (!r) return [];
    if (focus.value === 'added') {
        return sprintTasks.value.filter((task) => !task.committed).map((task) => {
            const add = scopeAddById.value[task.taskId];
            return {
                ...task,
                tone: 'is-warn',
                meta: add && add.by ? t(`Reports.scope_${add.action}_by`, { who: add.by }) : t('Reports.scope_added'),
            };
        });
    }
    if (focus.value === 'completed') {
        return sprintTasks.value.filter((task) => task.done)
            .map((task) => ({ ...task, tone: 'is-ok', meta: t('Reports.points_n', { n: task.points }) }));
    }
    if (focus.value === 'committed') {
        return sprintTasks.value.filter((task) => task.committed)
            .map((task) => ({ ...task, tone: task.done ? 'is-ok' : '', meta: t('Reports.points_n', { n: task.points }) }));
    }
    return (r.unfinishedList || []).map((task) => {
        const blocked = blockerById.value[String(task._id)];
        return {
            taskId: String(task._id),
            name: task.TaskName || task.TaskKey || '',
            tone: blocked ? 'is-danger' : (task.movedOut ? 'is-warn' : ''),
            meta: blocked
                ? t('Reports.blocked_days', { days: blocked.blockedDays })
                : (task.movedOut ? t('Reports.moved_out') : t('Reports.not_started')),
        };
    });
});

const burndownDays = computed(() => ((burndown.value && burndown.value.days) || []).filter((d) => d));

const burndownSeries = computed(() => [
    { name: t('Reports.remaining'), data: burndownDays.value.map((d) => (d.remainingPoints === null ? null : Number(d.remainingPoints) || 0)) },
    { name: t('Reports.ideal'), data: burndownDays.value.map((d) => Number(d.idealPoints) || 0) },
]);

const scopeMarkers = computed(() => {
    const byDay = {};
    ((insights.value && insights.value.scopeAdds) || []).forEach((add) => {
        if (!add.at) return;
        const d = new Date(add.at);
        if (Number.isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDay[key] = (byDay[key] || 0) + (Number(add.points) || 0);
    });
    return Object.keys(byDay)
        .filter((key) => burndownDays.value.some((d) => d.date === key))
        .map((key) => ({
            x: key,
            borderColor: '#d98324',
            label: { text: `+${byDay[key]}`, style: { background: '#fdf1e3', color: '#a4470f', fontSize: '10px' } },
        }));
});

const burndownOptions = computed(() => ({
    chart: { id: 'sprint-burndown', toolbar: { show: false }, animations: { enabled: false }, fontFamily: 'Inter Tight, sans-serif' },
    colors: ['#2F3990', 'rgba(0,0,0,.2)'],
    stroke: { width: [2.5, 1.5], dashArray: [0, 5], curve: 'straight' },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    xaxis: { categories: burndownDays.value.map((d) => d.date), labels: { rotate: -45, hideOverlappingLabels: true, style: { fontSize: '10px' } }, tooltip: { enabled: false } },
    yaxis: { min: 0, labels: { style: { fontSize: '10px' } } },
    legend: { position: 'top', horizontalAlign: 'right', fontSize: '11px' },
    grid: { borderColor: 'rgba(0,0,0,.07)' },
    annotations: { xaxis: scopeMarkers.value },
    tooltip: { shared: true },
}));

const scopeGrowthPct = computed(() => {
    const committed = pts(report.value && report.value.committed);
    if (!committed) return 0;
    return Math.round((pts(report.value.addedAfterStart) / committed) * 100);
});

const takeaway = computed(() => {
    if (!report.value) return '';
    return t('Reports.takeaway', {
        done: pts(report.value.completed),
        committed: pts(report.value.committed),
        pct: `${completionPct.value}%`,
        growth: `${scopeGrowthPct.value}%`,
        carry: pts(report.value.unfinished),
    });
});

const retroLines = computed(() => {
    if (!report.value) return [];
    const lines = [];
    if (blockers.value.length) {
        const oldest = blockers.value[0];
        lines.push(t('Reports.retro_blocked', { n: blockers.value.length, days: oldest.blockedDays || 0 }));
    }
    if (pts(report.value.addedAfterStart)) {
        lines.push(t('Reports.retro_scope', { pct: `${scopeGrowthPct.value}%`, points: pts(report.value.addedAfterStart) }));
    }
    if (plannedHours.value) {
        const delta = Math.round(((loggedHours.value - plannedHours.value) / plannedHours.value) * 100);
        lines.push(delta >= 0 ? t('Reports.retro_over_hours', { pct: `${delta}%` }) : t('Reports.retro_under_hours', { pct: `${Math.abs(delta)}%` }));
    }
    if (!lines.length) lines.push(t('Reports.retro_clean'));
    return lines;
});

const open = (row) => {
    openTask({
        companyId: cid.value,
        projectId: row.projectId || projectId.value,
        sprintId: row.sprintId || sprintId.value,
        folderId: row.folderId || '',
        taskId: row.taskId,
    });
};

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projects.value = list.filter((p) => p && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
        if (!projectId.value && projects.value.length) projectId.value = String(projects.value[0]._id);
    } catch (e) { projects.value = []; }
};

const loadSprints = async () => {
    sprints.value = [];
    sprintId.value = '';
    if (!projectId.value) return;
    try {
        const res = await apiRequest('get', `/api/v1/${env.GET_SPRINT_OR_PROJECT}/${projectId.value}?collection=sprints`);
        sprints.value = res?.data?.data || res?.data || [];
    } catch (e) { sprints.value = []; }
    if (sprintOptions.value.length) sprintId.value = sprintOptions.value[0]._id;
};

const loadReport = async () => {
    report.value = null;
    insights.value = null;
    burndown.value = null;
    hours.value = null;
    if (!sprintId.value) return;
    loading.value = true;
    error.value = '';
    const id = encodeURIComponent(sprintId.value);
    const [rep, ins, burn, hrs] = await Promise.allSettled([
        apiRequest('get', `/api/v2/sprints/report?sprintId=${id}`),
        apiRequest('get', `${env.AGILE_SPRINT_INSIGHTS}?sprintId=${id}`),
        apiRequest('get', `${env.AGILE_BURNDOWN}?sprintId=${id}`),
        apiRequest('post', env.SPRINT_HOURS, { sprintId: sprintId.value }),
    ]);
    if (rep.status === 'fulfilled' && rep.value?.data?.status) report.value = rep.value.data.data;
    else error.value = (rep.status === 'fulfilled' && rep.value?.data?.statusText) || t('Reports.load_failed');
    if (ins.status === 'fulfilled' && ins.value?.data?.status) insights.value = ins.value.data.data;
    if (burn.status === 'fulfilled' && burn.value?.data?.status) burndown.value = burn.value.data.data;
    if (hrs.status === 'fulfilled' && hrs.value?.data?.status) hours.value = hrs.value.data.data;
    loading.value = false;
};

watch(projectId, loadSprints);
watch(sprintId, loadReport);
onMounted(loadProjects);
</script>

<style src="./reportsV2.css"></style>
