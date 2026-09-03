<template>
    <div v-if="isMobile" class="ah-page tv-page"><div class="tv-empty"><span>{{ $t('TimeV2.desktop_only') }}</span></div></div>
    <div v-else class="ah-page tv-page cp">
        <div class="tv-head">
            <h1 class="tv-title cp__title">{{ $t('TimeV2.capacity_planning') }}</h1>
            <span class="tv-range">
                <button type="button" :aria-label="$t('TimeV2.prev_month')" @click="shift(-1)">‹</button>
                <span>{{ rangeLabel }}</span>
                <button type="button" :aria-label="$t('TimeV2.next_month')" @click="shift(1)">›</button>
            </span>
            <div class="tv-actions">
                <select v-model.number="span" class="tv-select">
                    <option :value="3">{{ $t('TimeV2.months_3') }}</option>
                    <option :value="4">{{ $t('TimeV2.months_4') }}</option>
                    <option :value="6">{{ $t('TimeV2.months_6') }}</option>
                </select>
                <label class="cp__hpd"><input v-model.number="hoursPerDay" type="number" min="1" max="24" class="ah-input" @change="load" /><span>{{ $t('TimeV2.hours_per_day') }}</span></label>
                <select v-model="teamFilter" class="tv-select">
                    <option value="">{{ $t('TimeV2.by_team') }} · {{ $t('TimeV2.all_teams') }}</option>
                    <option v-for="tm in teams" :key="tm.teamId" :value="tm.teamId">{{ teamName(tm) }}</option>
                </select>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!teams.length" @click="exportCsv">{{ $t('TimeV2.export') }}</button>
                <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" :disabled="!topGap" @click="modelGap">{{ $t('TimeV2.fill_gap') }}</button>
            </div>
        </div>

        <p v-if="error" class="tv-error">{{ error }}</p>

        <div class="tv-card tv-card--pad cp__chart" :style="{ '--months': months.length || 4 }">
            <div class="cp__row cp__row--head">
                <span></span>
                <span v-for="m in months" :key="m">{{ monthLabel(m) }}</span>
            </div>
            <template v-for="tm in visibleTeams" :key="tm.teamId">
                <div class="cp__row">
                    <span class="cp__team">{{ teamName(tm) }}<small>{{ tm.members }}</small></span>
                    <div v-for="m in months" :key="m" class="cp__track" :title="cellTitle(tm, m)">
                        <div class="cp__bar cp__bar--pipeline" :style="{ bottom: `${pct(cell(tm, m).committedHours, tm)}%`, height: `${pct(cell(tm, m).pipelineHours, tm)}%` }"></div>
                        <div class="cp__bar" :class="`is-${cell(tm, m).status}`" :style="{ height: `${pct(cell(tm, m).committedHours, tm)}%` }"></div>
                        <div class="cp__line" :class="{ 'is-dashed': isFar(m) }" :style="{ bottom: `${pct(cell(tm, m).availableHours, tm)}%` }"></div>
                    </div>
                </div>
                <div v-if="whatIf.teamId === tm.teamId" class="cp__row cp__row--whatif">
                    <span class="cp__team cp__team--whatif">{{ $t('TimeV2.contractor_row') }}</span>
                    <div class="cp__whatif" :style="{ gridColumn: `2 / span ${months.length}` }">
                        <input v-model.number="whatIf.hours" type="number" min="0" step="10" class="ah-input cp__whatif-input" />
                        <span>{{ $t('TimeV2.hours_per_month') }}</span>
                        <span class="ah-muted">{{ $t('TimeV2.contractor_hint', { h: whatIf.hours, team: teamName(tm) }) }}</span>
                        <button type="button" class="tv-link" @click="whatIf = { teamId: '', hours: 0 }">{{ $t('TimeV2.remove_contractor') }}</button>
                    </div>
                </div>
            </template>
            <div v-if="!visibleTeams.length" class="tv-empty"><span>{{ loading ? $t('TimeV2.loading') : $t('TimeV2.capacity_empty') }}</span></div>
            <div class="tv-legend">
                <span><i style="background: var(--brand)"></i>{{ $t('TimeV2.legend_committed') }}</span>
                <span><i style="background: var(--brand); opacity: .5"></i>{{ $t('TimeV2.legend_pipeline') }}</span>
                <span><i style="background: var(--danger)"></i>{{ $t('TimeV2.legend_over_avail') }}</span>
                <span>{{ $t('TimeV2.legend_line') }}</span>
            </div>
        </div>

        <div v-if="topGap" class="tv-card cp__gap">
            <strong>{{ $t('TimeV2.gap_title', { month: monthName(topGap.month) }) }}</strong>
            {{ $t('TimeV2.gap_body', { team: topGap.teamName || $t('TimeV2.unassigned_team'), committed: fmtH(topGap.committedHours), available: fmtH(topGap.availableHours) }) }}<span v-if="gapNotes(topGap)"> ({{ gapNotes(topGap) }})</span>.
            <span v-for="g in otherGaps" :key="`${g.teamId}-${g.month}`" class="cp__gap-more">· {{ monthName(g.month) }}: {{ g.teamName || $t('TimeV2.unassigned_team') }} +{{ fmtH(g.gapHours) }}h</span>
        </div>
        <div v-else-if="teams.length" class="tv-card cp__gap cp__gap--ok">{{ $t('TimeV2.no_gaps') }}</div>

        <div v-if="topGap" class="tv-dark cp__options">
            <span class="tv-spark">{{ $t('TimeV2.options') }}</span>
            {{ options.join(' · ') }}.
            <button type="button" class="tv-link" @click="modelGap">{{ $t('TimeV2.model_each') }}</button>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

defineOptions({ name: 'CapacityPlanning' });

const { t } = useI18n();
const clientWidth = inject('$clientWidth');
const isMobile = computed(() => !!(clientWidth && clientWidth.value < 768));

const from = ref(moment().startOf('month'));
const span = ref(4);
const hoursPerDay = ref(8);
const teamFilter = ref('');
const months = ref([]);
const teams = ref([]);
const gaps = ref([]);
const loading = ref(false);
const error = ref('');
const whatIf = ref({ teamId: '', hours: 0 });

const TIGHT_PCT = 90;
const toKey = (m) => m.format('YYYY-MM');
const toIso = computed(() => from.value.clone().add(span.value - 1, 'months'));
const rangeLabel = computed(() => `${from.value.format('MMM')} – ${toIso.value.format('MMM')}`.toUpperCase());
const monthLabel = (m) => moment(m, 'YYYY-MM').format('MMM').toUpperCase();
const monthName = (m) => moment(m, 'YYYY-MM').format('MMMM');
const fmtH = (h) => Math.round(Number(h) || 0).toLocaleString();
const teamName = (tm) => (tm.unassigned ? t('TimeV2.unassigned_team') : tm.name);
const isFar = (m) => months.value.indexOf(m) >= 3;

const cell = (tm, m) => {
    const raw = tm.months[m] || { availableHours: 0, ptoHours: 0, committedHours: 0, pipelineHours: 0, notes: [] };
    const extra = whatIf.value.teamId === tm.teamId ? Number(whatIf.value.hours) || 0 : 0;
    const availableHours = raw.availableHours + extra;
    const status = raw.committedHours > availableHours ? 'over' : (availableHours > 0 && (raw.committedHours / availableHours) * 100 >= TIGHT_PCT ? 'tight' : 'ok');
    return { ...raw, availableHours, status, gapHours: Math.max(0, raw.committedHours - availableHours) };
};
const scale = (tm) => Math.max(1, ...months.value.map((m) => { const c = cell(tm, m); return Math.max(c.availableHours, c.committedHours + c.pipelineHours); }));
const pct = (h, tm) => Math.min(100, ((Number(h) || 0) / scale(tm)) * 100);
const cellTitle = (tm, m) => { const c = cell(tm, m); return `${teamName(tm)} · ${monthName(m)}: ${fmtH(c.committedHours)}h committed, ${fmtH(c.pipelineHours)}h pipeline, ${fmtH(c.availableHours)}h available`; };
const visibleTeams = computed(() => teams.value.filter((tm) => !teamFilter.value || tm.teamId === teamFilter.value));
const liveGaps = computed(() => {
    const list = [];
    visibleTeams.value.forEach((tm) => months.value.forEach((m) => {
        const c = cell(tm, m);
        if (c.status === 'over') list.push({ teamId: tm.teamId, teamName: tm.name, month: m, ...c });
    }));
    return list.sort((a, b) => b.gapHours - a.gapHours);
});
const topGap = computed(() => liveGaps.value[0] || null);
const otherGaps = computed(() => liveGaps.value.slice(1, 4));
const gapNotes = (g) => (g.notes || []).map((n) => (n.kind === 'pto' ? t('TimeV2.gap_pto', { name: n.name, days: n.days }) : t('TimeV2.gap_over', { name: n.name, pct: n.pct }))).join(', ');
const options = computed(() => {
    const g = topGap.value;
    if (!g) return [];
    const team = g.teamName || t('TimeV2.unassigned_team');
    const rounded = Math.ceil(g.gapHours / 40) * 40;
    const list = [t('TimeV2.option_contractor', { month: monthName(g.month), h: rounded })];
    const tm = teams.value.find((x) => x.teamId === g.teamId);
    const roomMonth = tm ? months.value.find((m) => m > g.month && cell(tm, m).availableHours - cell(tm, m).committedHours >= g.gapHours) : null;
    if (roomMonth) list.push(t('TimeV2.option_shift', { h: fmtH(g.gapHours), team, month: monthName(roomMonth) }));
    list.push(t('TimeV2.option_cut', { h: fmtH(g.gapHours), team, month: monthName(g.month) }));
    return list;
});
const modelGap = () => {
    const g = topGap.value;
    if (!g) return;
    whatIf.value = { teamId: g.teamId, hours: Math.ceil(g.gapHours / 40) * 40 };
};

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const body = ((await apiRequest('get', `${env.CAPACITY_MONTHS}?from=${toKey(from.value)}&to=${toKey(toIso.value)}&hoursPerDay=${hoursPerDay.value}`)) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'load_failed');
        months.value = body.data.months || [];
        teams.value = body.data.teams || [];
        gaps.value = body.data.gaps || [];
    } catch (e) {
        error.value = t('TimeV2.load_failed');
    } finally {
        loading.value = false;
    }
};
const shift = (n) => { from.value = from.value.clone().add(n, 'months'); };
const exportCsv = () => {
    const head = ['Team', 'Month', 'Available (h)', 'PTO (h)', 'Committed (h)', 'Pipeline (h)', 'Gap (h)', 'Status'];
    const rows = [];
    visibleTeams.value.forEach((tm) => months.value.forEach((m) => {
        const c = cell(tm, m);
        rows.push([teamName(tm), m, c.availableHours, c.ptoHours, c.committedHours, c.pipelineHours, c.gapHours, c.status]);
    }));
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `capacity-${toKey(from.value)}_${toKey(toIso.value)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

watch([from, span], load);
onMounted(() => { if (!isMobile.value) load(); });
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.cp { max-width: 980px; }
.cp__title { font-size: 15px; }
.cp__hpd { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--ink-2); }
.cp__hpd .ah-input { width: 56px; height: 30px; padding: 0 8px; }
.cp__chart { display: flex; flex-direction: column; gap: 12px; }
.cp__row { display: grid; grid-template-columns: 110px repeat(var(--months), 1fr); gap: 8px; align-items: end; height: 110px; }
.cp__row--head { height: auto; font: var(--text-label); letter-spacing: .06em; color: var(--ink-3); text-align: center; }
.cp__row--whatif { height: 40px; align-items: center; }
.cp__team { align-self: center; font-weight: 600; display: flex; flex-direction: column; min-width: 0; }
.cp__team small { font: 500 10.5px/1.2 var(--font-mono); color: var(--ink-3); }
.cp__team--whatif { color: var(--brand); font-size: 11.5px; }
.cp__track { position: relative; height: 100%; background: rgba(0, 0, 0, .06); border-radius: 5px; overflow: hidden; }
:root[data-theme="dark"] .cp__track { background: rgba(255, 255, 255, .08); }
.cp__bar { position: absolute; bottom: 0; left: 0; right: 0; background: var(--brand); border-radius: 5px; transition: height var(--t-state) var(--ease); }
.cp__bar.is-over { background: var(--danger); }
.cp__bar.is-tight { background: var(--warn); }
.cp__bar--pipeline { background: var(--brand); opacity: .5; border-radius: 5px 5px 0 0; }
.cp__line { position: absolute; left: 0; right: 0; border-top: 2px solid var(--ink); }
.cp__line.is-dashed { border-top-style: dashed; border-top-color: var(--ink-3); }
.cp__whatif { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cp__whatif-input { width: 84px; height: 30px; font-family: var(--font-mono); }
.cp__gap { padding: 11px 13px; border-color: rgba(193, 18, 31, .25); line-height: 1.5; }
.cp__gap strong { font-weight: 600; color: var(--danger-ink); }
.cp__gap--ok { border-color: var(--hairline); color: var(--ink-2); }
.cp__gap-more { color: var(--ink-2); margin-left: 6px; }
.cp__options { margin-top: auto; }
.cp__options .tv-link { margin-left: 4px; }
</style>
