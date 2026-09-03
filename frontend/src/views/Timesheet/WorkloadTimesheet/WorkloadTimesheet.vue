<template>
<div v-if="!currentCompany?.planFeature?.workloadTimesheet">
    <UpgradePlan
        :buttonText="$t('Upgrades.upgrade_your_plan')"
        lastTitle="To Unlock Workload Timesheet"
        secondTitle="Unlimited"
        firstTitle="Upgrade To"
        message="That feature isn’t available on your current plan"
    />
</div>
<NotFound v-else-if="!allowed" />
<div v-else-if="isMobile" class="ah-page tv-page"><div class="tv-empty"><span>{{ $t('TimeV2.desktop_only') }}</span></div></div>
<div v-else class="wl">
    <div class="ah-toolbar wl__bar">
        <span class="tv-sq" :style="{ background: activeProject && activeProject.color ? activeProject.color : 'var(--brand)' }"></span>
        <select v-model="projectId" class="tv-select wl__project">
            <option value="">{{ $t('TimeV2.all_projects') }}</option>
            <option v-for="p in projectList" :key="p._id" :value="String(p._id)">{{ p.ProjectName }}</option>
        </select>
        <TimesheetTabs active="workload" />
        <span class="tv-range wl__range">
            <button type="button" :aria-label="$t('TimeV2.prev_week')" @click="shift(-7)">‹</button>
            <span>{{ rangeLabel }}</span>
            <button type="button" :aria-label="$t('TimeV2.next_week')" @click="shift(7)">›</button>
        </span>
        <div class="ah-toolbar__spacer"></div>
        <select v-model="mode" class="tv-select">
            <option value="estimate">{{ $t('TimeV2.by_estimate') }}</option>
            <option value="logged">{{ $t('TimeV2.by_logged') }}</option>
        </select>
        <button type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="suggestBalance">{{ $t('TimeV2.balance') }}</button>
    </div>

    <div class="wl__body">
        <p v-if="error" class="tv-error">{{ error }}</p>
        <p v-else-if="notice" class="tv-ok">{{ notice }}</p>
        <div class="wl__grid" :style="{ '--days': visibleDays.length || 10 }">
            <div class="wl__row wl__row--head">
                <span></span>
                <span v-for="d in visibleDays" :key="d" :class="{ 'is-today': d === today }">{{ dayHead(d) }}</span>
                <span>{{ $t('TimeV2.col_total') }}</span>
            </div>
            <div v-for="u in users" :key="u.userId" class="wl__row">
                <div class="wl__person">
                    <span class="ah-avatar" :style="{ background: colorFor(u.userId) }">
                        <img v-if="u.avatar" :src="u.avatar" :alt="u.name" />
                        <template v-else>{{ initial(u.name) }}</template>
                    </span>
                    <div class="wl__person-text">
                        <div class="wl__name">{{ u.name }}</div>
                        <div class="wl__sub" :class="{ 'is-over': u.utilizationPct > 100 }">{{ subLabel(u) }}</div>
                    </div>
                </div>
                <div
                    v-for="d in u.days.filter((x) => visibleDays.includes(x.date))"
                    :key="d.date"
                    class="wl__cell"
                    :class="{ 'is-pto': d.pto, 'is-today': d.date === today, 'is-drop': dropKey === `${u.userId}|${d.date}`, 'tv-hatch': d.pto }"
                    @dragover.prevent="onDragOver(u, d)"
                    @dragleave="onDragLeave(u, d)"
                    @drop.prevent="onDrop(u, d)"
                >
                    <template v-if="d.pto"><span class="wl__pto">{{ $t('TimeV2.pto') }}</span></template>
                    <template v-else>
                        <div class="wl__fill" :class="{ 'is-over': isOver(d), 'is-tentative': isTentative(d.date) }" :style="{ height: `${fillPct(d)}%` }">
                            <span v-if="value(d)">{{ hLabel(value(d)) }}</span>
                        </div>
                        <div v-if="mode === 'estimate' && d.chips.length" class="wl__chips">
                            <span
                                v-for="c in d.chips.slice(0, 2)"
                                :key="c.estimateId"
                                class="wl__chip"
                                draggable="true"
                                :title="`${c.name} · ${formatHm(c.minutes)}`"
                                @dragstart="onDragStart($event, u, d, c)"
                                @dragend="onDragEnd"
                            >{{ c.name || c.taskId }}</span>
                            <span v-if="d.chips.length > 2" class="wl__chip wl__chip--more" :title="d.chips.slice(2).map((c) => c.name).join(', ')">+{{ d.chips.length - 2 }}</span>
                        </div>
                    </template>
                </div>
                <div class="wl__total" :class="{ 'is-over': u.utilizationPct > 100 }">
                    {{ hLabel(mode === 'estimate' ? u.totalEstimated : u.totalLogged) }}<small>/{{ Math.round(u.capacityMinutes / 60) }}</small>
                </div>
            </div>
            <div v-if="!users.length" class="tv-empty wl__empty"><span>{{ loading ? $t('TimeV2.loading') : $t('TimeV2.workload_empty') }}</span></div>
        </div>

        <div class="wl__foot">
            <div class="tv-legend">
                <span><i style="background: var(--brand)"></i>{{ mode === 'estimate' ? $t('TimeV2.legend_estimated') : $t('TimeV2.legend_logged') }}</span>
                <span><i style="background: var(--brand); opacity: .5"></i>{{ $t('TimeV2.legend_tentative') }}</span>
                <span><i style="background: var(--danger)"></i>{{ $t('TimeV2.legend_over') }}</span>
                <span v-if="!hint" class="ah-muted">{{ $t('TimeV2.drag_hint') }}</span>
            </div>
            <div v-if="hint" class="wl__hint">
                <span class="tv-spark">✦</span>
                <span>{{ hint.text }}</span>
                <button v-if="hint.apply" type="button" class="tv-link" :disabled="busy" @click="applyHint">{{ $t('TimeV2.apply') }}</button>
            </div>
        </div>
    </div>
</div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { formatHm } from '@/composable/useTimer';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import NotFound from '@/views/NotFound.vue';
import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';

defineOptions({ name: 'WorkloadTimesheet' });

const { getters } = useStore();
const { t } = useI18n();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const currentUserId = inject('$userId');
const clientWidth = inject('$clientWidth');

const uid = computed(() => (currentUserId && currentUserId.value) || localStorage.getItem('userId') || '');
const currentCompany = computed(() => getters['settings/selectedCompany']);
const allowed = computed(() => checkPermission('sheet_settings.workload_timesheet') !== null);
const isMobile = computed(() => !!(clientWidth && clientWidth.value < 768));

const start = ref(moment().startOf('isoWeek'));
const projectId = ref('');
const projectList = ref([]);
const mode = ref('estimate');
const users = ref([]);
const days = ref([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const drag = ref(null);
const dropKey = ref('');
const hint = ref(null);

const today = computed(() => moment().format('YYYY-MM-DD'));
const endDate = computed(() => start.value.clone().add(11, 'days'));
const startIso = computed(() => start.value.format('YYYY-MM-DD'));
const endIso = computed(() => endDate.value.format('YYYY-MM-DD'));
const rangeLabel = computed(() => `${start.value.format('MMM D')} – ${endDate.value.format(start.value.isSame(endDate.value, 'month') ? 'D' : 'MMM D')}`);
const visibleDays = computed(() => days.value.filter((d) => ![0, 6].includes(moment(d).day())));
const activeProject = computed(() => {
    const p = projectList.value.find((x) => String(x._id) === projectId.value);
    return p ? { color: p.projectIcon && p.projectIcon.type === 'color' ? p.projectIcon.data : '' } : null;
});
const timeZone = computed(() => (getUser(uid.value) || {}).timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

const PALETTE = ['var(--brand)', 'var(--ok)', 'var(--warn)', 'var(--agent)'];
const colorFor = (id) => PALETTE[String(id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length];
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const dayHead = (d) => `${moment(d).format('dd').charAt(0)}${moment(d).format('D')}`;
const hLabel = (m) => {
    const h = (Number(m) || 0) / 60;
    return `${h >= 10 || Number.isInteger(h) ? Math.round(h) : Math.round(h * 10) / 10}h`;
};
const value = (d) => (mode.value === 'estimate' ? d.estimated : d.logged);
const isOver = (d) => (d.capacityMinutes > 0 ? value(d) > d.capacityMinutes : value(d) > 0);
const fillPct = (d) => (d.capacityMinutes > 0 ? Math.min(100, (value(d) / d.capacityMinutes) * 100) : (value(d) ? 100 : 0));
const isTentative = (date) => moment(date).isAfter(moment().endOf('isoWeek'));
const subLabel = (u) => {
    if (u.utilizationPct > 100) return t('TimeV2.pct_period', { pct: u.utilizationPct });
    const pto = u.days.filter((d) => d.pto && visibleDays.value.includes(d.date));
    if (pto.length) return t('TimeV2.pto_range', { range: pto.length === 1 ? moment(pto[0].date).format('ddd') : `${moment(pto[0].date).format('ddd')}–${moment(pto[pto.length - 1].date).format('ddd')}` });
    return t('TimeV2.per_day', { h: u.hoursPerDay });
};
const pctAfter = (u, delta) => (u.capacityMinutes > 0 ? Math.round(((u.totalEstimated + delta) / u.capacityMinutes) * 100) : 0);

const load = async () => {
    loading.value = true;
    error.value = '';
    try {
        const body = ((await apiRequest('post', env.WORKLOAD_GRID, {
            start: startIso.value, end: endIso.value, projectIds: projectId.value ? [projectId.value] : [], hoursPerDay: 8, timeZone: timeZone.value,
        })) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'load_failed');
        users.value = body.data.users || [];
        days.value = body.data.days || [];
    } catch (e) {
        error.value = t('TimeV2.load_failed');
    } finally {
        loading.value = false;
    }
};
const loadProjects = async () => {
    try {
        const b = ((await apiRequest('get', env.PROJECT)) || {}).data;
        const list = Array.isArray(b) ? b : (b && b.data) || [];
        projectList.value = list.filter((p) => p && p.status !== 'close' && p.deletedStatusKey !== 1 && p.deletedStatusKey !== 2);
    } catch (e) {
        projectList.value = [];
    }
};
const shift = (n) => { start.value = start.value.clone().add(n, 'days'); };
const flash = (msg) => { notice.value = msg; setTimeout(() => { if (notice.value === msg) notice.value = ''; }, 4000); };

const move = async ({ chip, fromUser, fromDay, toUser, toDay }) => {
    busy.value = true;
    error.value = '';
    try {
        const body = ((await apiRequest('post', env.WORKLOAD_MOVE, {
            taskId: chip.taskId, estimateId: chip.estimateId, fromUserId: fromUser.userId, toUserId: toUser.userId, fromDate: fromDay.date, toDate: toDay.date,
        })) || {}).data || {};
        if (!body.status) throw new Error(body.statusText || 'move_failed');
        flash(t('TimeV2.moved', { task: chip.name, name: toUser.name, day: moment(toDay.date).format('ddd D') }));
        hint.value = null;
        await load();
    } catch (e) {
        error.value = t('TimeV2.move_failed');
    } finally {
        busy.value = false;
    }
};

const onDragStart = (e, u, d, c) => {
    drag.value = { chip: c, fromUser: u, fromDay: d };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', c.taskId);
};
const onDragOver = (u, d) => {
    if (!drag.value || d.pto) return;
    const key = `${u.userId}|${d.date}`;
    if (dropKey.value === key) return;
    dropKey.value = key;
    const { chip, fromUser } = drag.value;
    const same = fromUser.userId === u.userId;
    hint.value = {
        text: t('TimeV2.dragging', {
            task: chip.name, h: formatHm(chip.minutes), name: u.name, day: moment(d.date).format('ddd'),
            from: fromUser.name, fromPct: pctAfter(fromUser, same ? 0 : -chip.minutes), toPct: pctAfter(u, same ? 0 : chip.minutes),
        }),
    };
};
const onDragLeave = (u, d) => { if (dropKey.value === `${u.userId}|${d.date}`) dropKey.value = ''; };
const onDragEnd = () => { drag.value = null; dropKey.value = ''; if (hint.value && !hint.value.apply) hint.value = null; };
const onDrop = (u, d) => {
    const current = drag.value;
    dropKey.value = '';
    drag.value = null;
    if (!current || d.pto) return;
    if (current.fromUser.userId === u.userId && current.fromDay.date === d.date) { hint.value = null; return; }
    move({ ...current, toUser: u, toDay: d });
};

const suggestBalance = () => {
    let worst = null;
    users.value.forEach((u) => u.days.forEach((d) => {
        if (!d.pto && d.chips.length && d.capacityMinutes > 0 && d.estimated > d.capacityMinutes && (!worst || d.estimated - d.capacityMinutes > worst.d.estimated - worst.d.capacityMinutes)) worst = { u, d };
    }));
    if (!worst) { hint.value = { text: t('TimeV2.balance_none') }; return; }
    const chip = [...worst.d.chips].sort((a, b) => b.minutes - a.minutes)[0];
    let target = null;
    users.value.forEach((u) => {
        if (u.userId === worst.u.userId) return;
        const d = u.days.find((x) => x.date === worst.d.date);
        if (!d || d.pto || d.capacityMinutes <= 0) return;
        const room = d.capacityMinutes - d.estimated;
        if (room >= chip.minutes && (!target || room > target.room)) target = { u, d, room };
    });
    if (!target) { hint.value = { text: t('TimeV2.balance_none') }; return; }
    hint.value = {
        text: t('TimeV2.balance_hint', {
            task: chip.name, h: formatHm(chip.minutes), from: worst.u.name, day: moment(worst.d.date).format('ddd'), to: target.u.name,
            fromPct: pctAfter(worst.u, -chip.minutes), toPct: pctAfter(target.u, chip.minutes),
        }),
        apply: { chip, fromUser: worst.u, fromDay: worst.d, toUser: target.u, toDay: target.d },
    };
};
const applyHint = () => { if (hint.value && hint.value.apply && !busy.value) move(hint.value.apply); };

watch([start, projectId], load);
onMounted(() => {
    if (!allowed.value || isMobile.value) return;
    load();
    loadProjects();
});
</script>

<style src="../timeV2.css"></style>
<style scoped>
.wl { display: flex; flex-direction: column; min-height: 100%; color: var(--ink); font: var(--text-small); }
.wl__bar { gap: 12px; }
.wl__project { font-weight: 600; font-size: 14px; max-width: 240px; border-color: transparent; padding-left: 4px; }
.wl__range { margin-left: 6px; }
.wl__body { flex: 1; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.wl__grid { display: flex; flex-direction: column; gap: 8px; overflow-x: auto; }
.wl__row { display: grid; grid-template-columns: 150px repeat(var(--days), minmax(48px, 1fr)) 70px; gap: 5px; align-items: stretch; height: 74px; }
.wl__row--head { height: auto; font: var(--text-label); letter-spacing: .06em; color: var(--ink-3); text-align: center; }
.wl__row--head .is-today { color: var(--brand); }
.wl__person { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wl__person .ah-avatar { width: 26px; height: 26px; font-size: 10px; }
.wl__person-text { min-width: 0; }
.wl__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl__sub { font-size: 11px; color: var(--ink-2); }
.wl__sub.is-over { color: var(--danger); }
.wl__cell { position: relative; background: var(--surface); border: 1px solid var(--hairline); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; transition: border-color var(--t-state) var(--ease), box-shadow var(--t-state) var(--ease); }
.wl__cell.is-today { border: 1.5px solid var(--brand); }
.wl__cell.is-drop { border: 1px dashed var(--brand); box-shadow: var(--focus); }
.wl__cell.is-pto { display: grid; place-items: center; border-color: var(--hairline); }
.wl__pto { font: 500 9.5px/1 var(--font-mono); color: var(--ink-3); }
.wl__fill { background: var(--brand); border-radius: 4px; display: grid; place-items: center; color: #fff; font: 600 10px/1 var(--font-mono); min-height: 0; transition: height var(--t-state) var(--ease); }
.wl__fill.is-tentative { opacity: .5; }
.wl__fill.is-over { background: var(--danger); }
.wl__chips { position: absolute; top: 4px; left: 4px; right: 4px; display: flex; flex-direction: column; gap: 2px; pointer-events: none; }
.wl__chip { pointer-events: auto; cursor: grab; font: 500 9.5px/1.2 var(--font-ui); background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 4px; padding: 2px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl__chip:active { cursor: grabbing; }
.wl__chip--more { color: var(--ink-2); font-family: var(--font-mono); }
.wl__total { display: grid; place-items: center; font: 600 12px/1 var(--font-mono); }
.wl__total small { font: 400 10px/1 var(--font-mono); color: var(--ink-3); }
.wl__total.is-over { color: var(--danger); }
.wl__empty { grid-column: 1 / -1; }
.wl__foot { margin-top: auto; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.wl__hint { display: flex; align-items: center; gap: 6px; color: var(--brand); font-weight: 600; font-size: 11.5px; }
</style>
