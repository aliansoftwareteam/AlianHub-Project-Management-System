<template>
    <div class="lt" :class="`lt--${mode}`">
        <header class="lt__head">
            <div>
                <div class="lt__title">{{ $t('TimeV2.log_time') }}</div>
                <div class="lt__sub">{{ $t('TimeV2.so_far', { day: todayLabel, h: formatMinutes(todayMinutes) }) }}</div>
            </div>
            <button v-if="mode === 'panel'" type="button" class="ah-btn ah-btn--ghost ah-btn--sm lt__close" :aria-label="$t('TimeV2.close')" @click="$emit('close')">
                <ShellIcon name="x" :size="16" />
            </button>
        </header>

        <div class="lt__body ah-scroll">
            <section v-for="s in overnightSessions" :key="s.key" class="lt__alert">
                <div class="lt__alert-title">{{ $t('TimeV2.overnight_title') }}</div>
                <i18n-t keypath="TimeV2.overnight_body" tag="div" class="lt__alert-body">
                    <template #start>{{ s.startClock }}</template>
                    <template #when>{{ s.whenLabel }}</template>
                    <template #task><strong>{{ s.taskName }}</strong></template>
                    <template #recorded>{{ formatHm(s.recordedMinutes) }}</template>
                </i18n-t>
                <div class="tv-row-actions">
                    <button type="button" class="ah-btn ah-btn--primary ah-btn--grow" :disabled="busy" @click="trimSession(s)">
                        {{ busy === s.key ? $t('TimeV2.trimming') : $t('TimeV2.trim_to') }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--secondary" :disabled="busy" @click="editSession(s)">{{ $t('TimeV2.edit') }}</button>
                </div>
                <p v-if="s.error" class="tv-error">{{ s.error }}</p>
            </section>

            <section class="tv-card lt__form">
                <div class="ah-field">
                    <label class="ah-field__label">{{ $t('TimeV2.task') }}</label>
                    <div class="lt__picker">
                        <button type="button" class="lt__task-btn" :class="{ 'ah-input--error': errors.task }" @click="togglePicker">
                            <span class="tv-sq" :style="{ background: task && task.projectColor ? task.projectColor : 'var(--brand)' }"></span>
                            <span class="lt__task-name" :class="{ 'is-placeholder': !task }">{{ task ? task.taskName : $t('TimeV2.pick_task') }}</span>
                            <ShellIcon name="chevronDown" :size="14" />
                        </button>
                        <div v-if="pickerOpen" class="ah-pop lt__pop">
                            <input ref="searchInput" v-model="search" class="ah-input lt__search" :placeholder="$t('TimeV2.search_tasks')" @input="searchTasks" />
                            <div class="lt__pop-list ah-scroll">
                                <template v-if="recentList.length">
                                    <div class="ah-label ah-pop__label">{{ $t('TimeV2.recent') }}</div>
                                    <button v-for="opt in recentList" :key="`r-${opt.taskId}`" type="button" class="ah-pop__item" @click="chooseTask(opt)">
                                        <span class="tv-sq" :style="{ background: opt.projectColor || 'var(--brand)' }"></span>
                                        <span class="lt__opt">{{ opt.taskName }}<small v-if="opt.projectName">{{ opt.projectName }}</small></span>
                                    </button>
                                </template>
                                <div class="ah-label ah-pop__label">{{ $t('TimeV2.assigned') }}</div>
                                <button v-for="opt in assignedList" :key="`a-${opt.taskId}`" type="button" class="ah-pop__item" @click="chooseTask(opt)">
                                    <span class="tv-sq" :style="{ background: opt.projectColor || 'var(--brand)' }"></span>
                                    <span class="lt__opt">{{ opt.taskName }}<small v-if="opt.projectName">{{ opt.projectName }}</small></span>
                                </button>
                                <div v-if="!assignedList.length && !recentList.length" class="ah-pop__item is-disabled">{{ searching ? $t('TimeV2.loading') : $t('TimeV2.no_tasks') }}</div>
                            </div>
                        </div>
                    </div>
                    <p v-if="errors.task" class="ah-field__error">{{ errors.task }}</p>
                </div>

                <div class="lt__two">
                    <div class="ah-field">
                        <label class="ah-field__label" for="lt-hours">{{ $t('TimeV2.hours') }}</label>
                        <input id="lt-hours" v-model="hoursText" class="ah-input tv-input-mono lt__hours" :class="{ 'ah-input--error': errors.hours }" inputmode="decimal" placeholder="0:00" @blur="normalizeHours" />
                        <p v-if="errors.hours" class="ah-field__error">{{ errors.hours }}</p>
                    </div>
                    <div class="ah-field">
                        <label class="ah-field__label" for="lt-when">{{ $t('TimeV2.when') }}</label>
                        <select id="lt-when" v-model="whenChoice" class="ah-input">
                            <option value="today">{{ $t('TimeV2.when_today') }}</option>
                            <option value="yesterday">{{ $t('TimeV2.when_yesterday') }}</option>
                            <option value="custom">{{ $t('TimeV2.when_custom') }}</option>
                        </select>
                        <input v-if="whenChoice === 'custom'" v-model="customDate" type="date" class="ah-input" :max="todayIso" />
                    </div>
                </div>

                <div class="lt__quick">
                    <button type="button" class="lt__chip" @click="addMinutes(15)">+15m</button>
                    <button type="button" class="lt__chip" @click="addMinutes(30)">+30m</button>
                    <button type="button" class="lt__chip" @click="addMinutes(60)">+1h</button>
                    <button type="button" class="lt__chip lt__chip--grey" @click="roundTo15">{{ $t('TimeV2.round_15') }}</button>
                </div>

                <div class="ah-field">
                    <label class="ah-field__label" for="lt-note">{{ $t('TimeV2.note') }} <span class="ah-muted">{{ $t('TimeV2.optional') }}</span></label>
                    <textarea id="lt-note" v-model="note" class="ah-input ah-textarea lt__note" :placeholder="$t('TimeV2.note_ph')"></textarea>
                </div>

                <label class="lt__bill">
                    <input v-model="billable" type="checkbox" class="ah-check" />
                    <span>{{ $t('TimeV2.billable') }}</span>
                </label>
            </section>

            <p v-if="error" class="tv-error">{{ error }}</p>
            <p v-else-if="success" class="tv-ok">{{ success }}</p>
            <p class="lt__hint">{{ $t('TimeV2.entries_editable') }}</p>
        </div>

        <footer class="lt__foot">
            <button type="button" class="ah-btn ah-btn--primary ah-btn--lg ah-btn--block" :disabled="!!busy" @click="submit">
                {{ busy === 'submit' ? $t('TimeV2.logging') : $t('TimeV2.log_btn', { h: hoursText || '0:00' }) }}
            </button>
        </footer>
    </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useTimer, formatMinutes, formatHm, formatClock } from '@/composable/useTimer';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';

defineOptions({ name: 'LogTimeSheet' });
const props = defineProps({
    mode: { type: String, default: 'page' },
    prefill: { type: Object, default: () => ({}) },
    recentTasks: { type: Array, default: () => [] },
});
const emit = defineEmits(['close', 'logged']);

const { getters } = useStore();
const route = useRoute();
const { t } = useI18n();
const currentUserId = inject('$userId');
const timer = useTimer();
const uid = computed(() => (currentUserId && currentUserId.value) || localStorage.getItem('userId') || '');

const task = ref(null);
const hoursText = ref('');
const whenChoice = ref('today');
const customDate = ref('');
const note = ref('');
const billable = ref(true);
const pickerOpen = ref(false);
const search = ref('');
const searching = ref(false);
const searchInput = ref(null);
const assigned = ref([]);
const errors = ref({ task: '', hours: '' });
const error = ref('');
const success = ref('');
const busy = ref('');
const todayMinutes = ref(0);
const editing = ref(null);
const sessionErrors = ref({});
let projectNames = null;

const todayIso = computed(() => moment().format('YYYY-MM-DD'));
const todayLabel = computed(() => moment().format('ddd MMM D').toUpperCase());
const selectedDate = computed(() => {
    if (whenChoice.value === 'yesterday') return moment().subtract(1, 'day').format('YYYY-MM-DD');
    if (whenChoice.value === 'custom' && customDate.value) return customDate.value;
    return todayIso.value;
});

const parseHours = (text) => {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return 0;
    let m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/);
    if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
    m = s.match(/^(\d+(?:\.\d+)?)$/);
    if (m) return Math.round(Number(m[1]) * 60);
    return NaN;
};
const minutes = computed(() => parseHours(hoursText.value));
const setMinutes = (m) => { hoursText.value = m > 0 ? formatMinutes(m) : ''; };
const normalizeHours = () => { if (!Number.isNaN(minutes.value)) setMinutes(minutes.value); };
const addMinutes = (m) => setMinutes((Number.isNaN(minutes.value) ? 0 : minutes.value) + m);
const roundTo15 = () => { if (!Number.isNaN(minutes.value)) setMinutes(Math.max(15, Math.round(minutes.value / 15) * 15)); };

const sessionKey = (s) => s.timeSheetId || 'local';
const overnightSessions = computed(() => {
    const list = timer.sessions.value.filter((s) => s.overnight).map((s) => ({ ...s, key: sessionKey(s), local: false }));
    const a = timer.active.value;
    if (a && timer.overnight.value) {
        list.unshift({ key: 'local', local: true, taskId: a.taskId, taskName: a.taskName, projectId: a.projectId, projectName: a.projectName, sprintId: a.sprintId, startedAt: a.startedAt, recordedMinutes: Math.floor(timer.elapsed.value / 60), suggestedMinutes: 180 });
    }
    return list.map((s) => {
        const started = moment(s.startedAt);
        const when = started.isSame(moment(), 'day') ? t('TimeV2.today') : (started.isSame(moment().subtract(1, 'day'), 'day') ? t('TimeV2.yesterday') : started.format('MMM D'));
        return { ...s, startClock: started.format('HH:mm'), whenLabel: when, error: sessionErrors.value[s.key] || '' };
    });
});

const toOption = (x) => ({ taskId: x.taskId, taskName: x.taskName || '', projectId: x.projectId || '', projectName: x.projectName || '', sprintId: x.sprintId || '', projectColor: x.projectColor || '' });
const recentList = computed(() => {
    const q = search.value.trim().toLowerCase();
    return props.recentTasks.map(toOption).filter((x) => !q || x.taskName.toLowerCase().includes(q)).slice(0, 6);
});
const assignedList = computed(() => assigned.value.filter((x) => !recentList.value.some((r) => r.taskId === x.taskId)));

const loadProjectNames = async () => {
    if (projectNames) return projectNames;
    projectNames = {};
    const fromStore = (getters['projectData/allProjects'] && getters['projectData/allProjects'].data) || [];
    fromStore.forEach((p) => { projectNames[String(p._id)] = p; });
    if (!fromStore.length) {
        try {
            const b = ((await apiRequest('get', env.PROJECT)) || {}).data;
            const list = Array.isArray(b) ? b : (b && b.data) || [];
            list.forEach((p) => { projectNames[String(p._id)] = p; });
        } catch (e) { /* names stay empty; the id still logs correctly */ }
    }
    return projectNames;
};
const projectMeta = (id) => {
    const p = projectNames && projectNames[String(id)];
    return { projectName: p ? p.ProjectName || '' : '', projectColor: p && p.projectIcon && p.projectIcon.type === 'color' ? p.projectIcon.data : '' };
};
let searchTimer = null;
const searchTasks = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(fetchAssigned, 250);
};
const fetchAssigned = async () => {
    searching.value = true;
    try {
        await loadProjectNames();
        const match = { AssigneeUserId: { $in: [uid.value] }, deletedStatusKey: { $in: [0, null] } };
        const q = search.value.trim();
        if (q) match.TaskName = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        const findQuery = [{ $match: match }, { $sort: { updatedAt: -1 } }, { $limit: 30 }, { $project: { TaskName: 1, ProjectID: 1, sprintId: 1 } }];
        const res = await apiRequest('post', `${env.TASK}/find`, { findQuery });
        const list = Array.isArray(res && res.data) ? res.data : [];
        assigned.value = list.map((x) => ({ taskId: String(x._id), taskName: x.TaskName || '', projectId: String(x.ProjectID || ''), sprintId: String(x.sprintId || ''), ...projectMeta(x.ProjectID) }));
    } catch (e) {
        assigned.value = [];
    } finally {
        searching.value = false;
    }
};
const togglePicker = async () => {
    pickerOpen.value = !pickerOpen.value;
    if (pickerOpen.value) {
        if (!assigned.value.length) fetchAssigned();
        await nextTick();
        if (searchInput.value) searchInput.value.focus();
    }
};
const chooseTask = (opt) => {
    task.value = opt;
    pickerOpen.value = false;
    errors.value.task = '';
};
const loadTaskById = async (id) => {
    try {
        await loadProjectNames();
        const res = await apiRequest('get', `${env.TASK}/${id}`);
        const x = res && res.data && (res.data.data || res.data);
        if (x && x._id) task.value = { taskId: String(x._id), taskName: x.TaskName || '', projectId: String(x.ProjectID || ''), sprintId: String(x.sprintId || ''), ...projectMeta(x.ProjectID) };
    } catch (e) { /* the picker stays open for a manual choice */ }
};
const loadToday = async () => {
    try {
        const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
        const body = ((await apiRequest('get', `${env.TIMESHEET_WEEK}?start=${todayIso.value}&end=${todayIso.value}&timeZone=${tz}`)) || {}).data || {};
        todayMinutes.value = body.status && body.data && body.data.totals ? body.data.totals.weekMinutes || 0 : 0;
    } catch (e) {
        todayMinutes.value = 0;
    }
};

const applyPrefill = () => {
    const p = props.prefill || {};
    if (p.task) task.value = toOption(p.task);
    if (p.minutes) setMinutes(Number(p.minutes));
    const date = p.date || route.query.date;
    if (date && date !== todayIso.value) {
        if (date === moment().subtract(1, 'day').format('YYYY-MM-DD')) whenChoice.value = 'yesterday';
        else { whenChoice.value = 'custom'; customDate.value = String(date); }
    } else {
        whenChoice.value = 'today';
    }
    if (route.query.minutes && !p.minutes) setMinutes(Number(route.query.minutes));
    if (!task.value && route.query.taskId) loadTaskById(String(route.query.taskId));
};

const trimSession = async (s) => {
    if (busy.value) return;
    busy.value = s.key;
    sessionErrors.value = { ...sessionErrors.value, [s.key]: '' };
    try {
        if (s.local) await timer.stop({ minutes: s.suggestedMinutes || 180 });
        else await timer.trim(s, s.suggestedMinutes || 180);
        success.value = t('TimeV2.trimmed');
        emit('logged', { message: success.value });
        loadToday();
    } catch (e) {
        sessionErrors.value = { ...sessionErrors.value, [s.key]: t('TimeV2.trim_failed') };
    } finally {
        busy.value = '';
    }
};
const editSession = (s) => {
    editing.value = s;
    task.value = toOption(s);
    setMinutes(Math.max(15, Math.round(s.recordedMinutes / 15) * 15));
    whenChoice.value = 'today';
    if (!moment(s.startedAt).isSame(moment(), 'day')) { whenChoice.value = 'custom'; customDate.value = moment(s.startedAt).format('YYYY-MM-DD'); }
    note.value = s.note || '';
};

const validate = () => {
    errors.value = { task: '', hours: '' };
    if (!task.value) errors.value.task = t('TimeV2.task_required');
    if (Number.isNaN(minutes.value) || minutes.value <= 0) errors.value.hours = t('TimeV2.hours_required');
    return !errors.value.task && !errors.value.hours;
};
const submit = async () => {
    if (busy.value || !validate()) return;
    busy.value = 'submit';
    error.value = '';
    success.value = '';
    try {
        const m = minutes.value;
        if (editing.value && editing.value.taskId === task.value.taskId) {
            if (editing.value.local) await timer.stop({ minutes: m });
            else await timer.trim(editing.value, m);
            editing.value = null;
        } else {
            await timer.logTime({ task: task.value, minutes: m, date: selectedDate.value, note: note.value.trim(), billable: billable.value });
        }
        success.value = t('TimeV2.logged_ok', { h: formatHm(m), task: task.value.taskName });
        emit('logged', { message: success.value });
        hoursText.value = '';
        note.value = '';
        loadToday();
    } catch (e) {
        error.value = t('TimeV2.log_failed');
    } finally {
        busy.value = '';
    }
};

watch(() => props.prefill, applyPrefill, { deep: true });
onMounted(() => {
    applyPrefill();
    loadToday();
    timer.reconcile();
});
defineExpose({ formatClock });
</script>

<style src="../Timesheet/timeV2.css"></style>
<style scoped>
.lt { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--canvas); color: var(--ink); font: var(--text-body); }
.lt--page { min-height: 100%; }
.lt__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 12px 16px; background: var(--surface); border-bottom: 1px solid var(--hairline); flex: none; }
.lt__title { font: 600 16px/1.2 var(--font-ui); }
.lt__sub { font: 500 9.5px/1.2 var(--font-mono); color: var(--ink-3); margin-top: 3px; text-transform: uppercase; }
.lt__close { padding: 0 8px; }
.lt__body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.lt__alert { background: var(--surface); border: 1.5px solid var(--warn); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; }
.lt__alert-title { font-weight: 600; color: var(--warn-ink); }
.lt__alert-body { color: var(--ink); line-height: 1.5; }
.lt__form { padding: 12px 14px; display: flex; flex-direction: column; gap: 11px; }
.lt__picker { position: relative; }
.lt__task-btn { width: 100%; min-height: 44px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--ink); padding: 0 12px; display: flex; align-items: center; gap: 8px; font: 400 13px/1.2 var(--font-ui); cursor: pointer; text-align: left; }
.lt__task-btn:focus-visible { outline: none; border-color: var(--brand); box-shadow: var(--focus); }
.lt__task-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lt__task-name.is-placeholder { color: var(--ink-3); }
.lt__pop { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 20; max-height: 320px; display: flex; flex-direction: column; }
.lt__search { margin-bottom: 4px; height: 34px; }
.lt__pop-list { overflow: auto; min-height: 0; }
.lt__opt { display: flex; flex-direction: column; min-width: 0; }
.lt__opt small { color: var(--ink-2); font-size: 11px; }
.lt__two { display: flex; gap: 8px; }
.lt__two .ah-field { flex: 1; min-width: 0; }
.lt__two .ah-input { min-height: 44px; }
.lt__hours { font: 600 16px/1 var(--font-mono); }
.lt__quick { display: flex; gap: 6px; flex-wrap: wrap; }
.lt__chip { min-height: 36px; padding: 8px 12px; border-radius: 8px; border: 0; background: var(--brand-tint); color: var(--brand); font: 600 12.5px/1 var(--font-ui); cursor: pointer; }
.lt__chip--grey { background: rgba(0, 0, 0, .06); color: var(--ink); font-weight: 500; }
:root[data-theme="dark"] .lt__chip--grey { background: rgba(255, 255, 255, .1); }
.lt__note { min-height: 44px; }
.lt__bill { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-label); cursor: pointer; }
.lt__hint { margin: auto 0 0; font-size: 11.5px; color: var(--ink-2); line-height: 1.45; text-align: center; }
.lt__foot { padding: 10px 14px 14px; background: var(--surface); border-top: 1px solid var(--hairline); flex: none; }
.lt__foot .ah-btn { min-height: 48px; border-radius: 10px; font-size: 14.5px; }
.ah-pop__item.is-disabled { color: var(--ink-2); cursor: default; }
</style>
