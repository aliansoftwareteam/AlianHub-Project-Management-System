<template>
    <aside ref="panel" class="wcp" :class="{ 'is-dragging': dragging }" role="dialog" aria-modal="false" :aria-labelledby="titleId" tabindex="-1" data-test="workload-panel" @keydown.esc.stop="$emit('close')">
        <header class="wcp__head">
            <span class="ah-avatar" :style="{ background: color }">
                <AvatarImage :src="person.avatar" :alt="person.name">{{ initial }}</AvatarImage>
            </span>
            <div class="wcp__who">
                <h2 :id="titleId" class="wcp__name">{{ person.name }}</h2>
                <div class="wcp__period">{{ periodLabel }}</div>
            </div>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm wcp__close" :aria-label="$t('Time.close')" data-test="workload-panel-close" @click="$emit('close')">
                <ShellIcon name="x" :size="14" aria-hidden="true" />
            </button>
        </header>

        <dl class="wcp__facts">
            <div><dt>{{ $t('Time.legend_estimated') }}</dt><dd>{{ formatHm(cell.estimated) }}</dd></div>
            <div><dt>{{ $t('Time.legend_logged') }}</dt><dd>{{ formatHm(cell.logged) }}</dd></div>
            <div><dt>{{ $t('Time.capacity') }}</dt><dd :class="{ 'is-over': over }">{{ formatHm(cell.capacityMinutes) }}</dd></div>
        </dl>
        <p v-if="cell.pto || cell.unavailable" class="wcp__off">{{ cell.pto ? $t('Time.pto') : $t('Time.unavailable') }}</p>

        <div class="wcp__list ah-scroll">
            <h3 class="tv-section-label wcp__label">{{ $t('Time.scheduled_tasks', { n: tasks.length }) }}</h3>
            <p v-if="draggableRows && tasks.some(canDrag)" class="wcp__hint">{{ $t('Time.drag_to_move') }}</p>
            <ul v-if="tasks.length" class="wcp__rows">
                <li v-for="task in tasks" :key="task.taskId || task.name">
                    <button
                        type="button"
                        class="wcp__row"
                        :class="{ 'is-draggable': canDrag(task) }"
                        :disabled="!task.taskId || !task.projectId"
                        :draggable="canDrag(task)"
                        data-test="workload-panel-task"
                        @click="open(task)"
                        @dragstart="startDrag($event, task)"
                        @dragend="endDrag"
                    >
                        <ShellIcon v-if="draggableRows" name="grip" :size="13" class="wcp__grip" :class="{ 'is-off': !canDrag(task) }" aria-hidden="true" />
                        <span class="tv-sq" :style="{ background: task.projectColor || 'var(--brand)' }"></span>
                        <span class="wcp__task">
                            <span class="wcp__task-name">{{ task.name || $t('Time.task_not_open') }}</span>
                            <span class="wcp__task-sub">{{ task.projectName }}<template v-if="multiDay && task.dates.length"> · {{ datesLabel(task.dates) }}</template></span>
                        </span>
                        <span class="wcp__hours">{{ formatHm(task.minutes) }}</span>
                        <ShellIcon name="chevronRight" :size="13" class="wcp__go" aria-hidden="true" />
                    </button>
                </li>
            </ul>
            <div v-else class="ah-empty wcp__empty">{{ $t('Time.no_scheduled_tasks') }}</div>
        </div>
    </aside>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import moment from 'moment';
import AvatarImage from '@/components/atom/AvatarImage/AvatarImage.vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { formatHm } from '@/composable/useTimer';
import { tasksOf } from './workloadBuckets';

defineOptions({ name: 'WorkloadCellPanel' });

const props = defineProps({
    person: { type: Object, required: true },
    cell: { type: Object, required: true },
    color: { type: String, default: 'var(--brand)' },
    draggableRows: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'open-task', 'drag-start', 'drag-end']);

const titleId = `wcp-${Math.random().toString(36).slice(2, 8)}`;
const initial = computed(() => (props.person.name || '?').trim().charAt(0).toUpperCase());
const tasks = computed(() => tasksOf(props.cell.chips));
const multiDay = computed(() => props.cell.start !== props.cell.end);
const over = computed(() => props.cell.capacityMinutes > 0 && props.cell.estimated > props.cell.capacityMinutes);
const periodLabel = computed(() => {
    const start = moment(props.cell.start);
    const end = moment(props.cell.end);
    return multiDay.value ? `${start.format('ddd, MMM D')} – ${end.format('ddd, MMM D YYYY')}` : start.format('dddd, MMM D YYYY');
});
const datesLabel = (dates) => dates.map((date) => moment(date).format('ddd D')).join(', ');

const open = (task) => emit('open-task', task);

const canDrag = (task) => props.draggableRows && Boolean(task.name) && task.chips.length > 0;
const dragging = ref(false);
function startDrag(event, task) {
    if (!canDrag(task)) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.taskId);
    emit('drag-start', task);
    /* Stepping aside in the same tick as dragstart cancels the drag in Chromium. */
    requestAnimationFrame(() => { dragging.value = true; });
}
function endDrag() {
    dragging.value = false;
    emit('drag-end');
}

const panel = ref(null);
onMounted(() => nextTick(() => panel.value && panel.value.focus()));
</script>

<style scoped>
.wcp {
    position: fixed; top: 0; inset-inline-end: 0; bottom: 0; z-index: 45;
    width: var(--panel-w, 420px); max-width: 100%;
    display: flex; flex-direction: column; outline: none;
    background: var(--surface); border-inline-start: 1px solid var(--hairline); box-shadow: var(--shadow-pop);
}
.wcp__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.wcp__head .ah-avatar { width: 30px; height: 30px; font-size: 11px; }
.wcp__who { min-width: 0; flex: 1; }
.wcp__name { margin: 0; font: 600 14px/1.25 var(--font-ui); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcp__period { font: var(--text-small); color: var(--ink-2); }
.wcp__close { width: 30px; padding: 0; }
.wcp__facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--hairline); }
.wcp__facts div { display: flex; flex-direction: column; gap: 2px; }
.wcp__facts dt { font: var(--text-label); letter-spacing: .06em; color: var(--ink-2); text-transform: uppercase; }
.wcp__facts dd { margin: 0; font: 600 14px/1.2 var(--font-mono); color: var(--ink); }
.wcp__facts dd.is-over { color: var(--danger-ink); }
.wcp__off { margin: 0; padding: 8px 16px; color: var(--ink-2); background: var(--surface-2); border-bottom: 1px solid var(--hairline); }
.wcp__list { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 8px 16px; }
.wcp.is-dragging { opacity: .3; pointer-events: none; transition: opacity var(--t-state) var(--ease); }
.wcp__label { margin: 0 8px 6px; }
.wcp__hint { margin: 0 8px 8px; font: var(--text-small); color: var(--ink-2); }
.wcp__row.is-draggable { cursor: grab; }
.wcp__row.is-draggable:active { cursor: grabbing; }
.wcp__grip { flex: none; color: var(--ink-2); }
.wcp__grip.is-off { visibility: hidden; }
.wcp__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wcp__row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); text-align: start; cursor: pointer; }
.wcp__row:hover:not(:disabled) { background: var(--surface-hover); }
.wcp__row:disabled { cursor: default; }
.wcp__task { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wcp__task-name { font: 500 13px/1.3 var(--font-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcp__task-sub { font: var(--text-small); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wcp__hours { font: 600 12px/1 var(--font-mono); flex: none; }
.wcp__go { color: var(--ink-2); flex: none; }
.wcp__empty { margin: 0 8px; }
@media (max-width: 767px) {
    .wcp { width: 100%; }
    .wcp__row { min-height: 44px; }
}
</style>
