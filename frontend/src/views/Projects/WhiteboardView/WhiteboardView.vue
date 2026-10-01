<template>
  <div class="wb-view ah-page">
    <div class="wb-view__bar">
      <span class="wb-view__title">{{ $t('Views.whiteboard_title') }}</span>
      <span class="wb-view__count">{{ $t('Views.whiteboard_cards', { n: cards.length }) }}</span>
      <span class="wb-view__state" :class="`is-${indicator.state}`" role="status" aria-live="polite" :data-wb-state="indicator.state">{{ indicator.text }}</span>
      <div class="wb-view__actions">
        <button v-if="canWrite" class="wb-view__btn" type="button" data-wb-add-note :disabled="notesFull" :title="notesFull ? $t('Views.whiteboard_notes_full') : null" @click="addWritten('note')">{{ $t('Views.whiteboard_add_note') }}</button>
        <button v-if="canWrite" class="wb-view__btn" type="button" data-wb-add-text :disabled="notesFull" :title="notesFull ? $t('Views.whiteboard_notes_full') : null" @click="addWritten('text')">{{ $t('Views.whiteboard_add_text') }}</button>
        <button v-if="phase === 'ready' && !usesLocal" class="wb-view__btn" type="button" data-wb-history :aria-expanded="historyOpen" @click="toggleHistory">{{ $t('Views.whiteboard_history') }}</button>
        <button v-if="canMove" class="wb-view__btn" type="button" data-wb-arrange @click="autoArrange">{{ $t('Views.auto_arrange') }}</button>
      </div>
    </div>

    <div v-if="phase === 'ready' && usesLocal" class="wb-view__notice" data-wb-offer>
      <span>{{ $t(canEdit ? 'Views.whiteboard_local_offer' : 'Views.whiteboard_local_only') }}</span>
      <button v-if="canEdit" class="ah-btn ah-btn--primary ah-btn--sm" type="button" data-wb-upload @click="uploadLocal(cards.map((c) => c.id))">{{ $t('Views.whiteboard_upload') }}</button>
    </div>
    <div v-else-if="hasUnusedLocal" class="wb-view__notice" data-wb-unused>
      <span>{{ $t('Views.whiteboard_local_unused') }}</span>
      <button class="ah-btn ah-btn--secondary ah-btn--sm" type="button" data-wb-discard @click="discardLocal()">{{ $t('Views.whiteboard_local_remove') }}</button>
    </div>
    <div v-else-if="phase === 'unavailable'" class="wb-view__notice" data-wb-unavailable>
      <span>{{ $t('Views.whiteboard_load_failed') }}</span>
    </div>

    <div v-if="historyOpen" class="wb-view__history" data-wb-history-panel>
      <div class="wb-view__history-head">
        <span class="wb-view__title">{{ $t('Views.whiteboard_history') }}</span>
        <button class="wb-view__btn" type="button" @click="historyOpen = false">{{ $t('Views.whiteboard_history_close') }}</button>
      </div>
      <p v-if="historyFailed" class="wb-view__history-empty">{{ $t('Views.whiteboard_history_failed') }}</p>
      <p v-else-if="history && !history.length" class="wb-view__history-empty">{{ $t('Views.whiteboard_history_empty') }}</p>
      <ul v-else-if="history" class="wb-view__history-list">
        <li v-for="entry in history" :key="entry.revision" class="wb-view__history-row" :data-wb-history-row="entry.revision">
          <span class="wb-view__history-what">
            <span class="wb-view__history-who">{{ nameOf(entry.savedBy) }}</span>
            <span class="wb-view__history-when">{{ whenOf(entry.savedAt) }} · {{ $t('Views.whiteboard_items', { n: entry.cards }) }}</span>
          </span>
          <button v-if="canEdit" class="ah-btn ah-btn--secondary ah-btn--sm" type="button" :data-wb-restore="entry.revision" :disabled="restoring" @click="restore(entry.revision)">{{ $t('Views.whiteboard_restore') }}</button>
        </li>
      </ul>
      <p v-if="restoreFailed" class="wb-view__history-empty" role="alert">{{ $t('Views.whiteboard_restore_failed') }}</p>
    </div>

    <div ref="boardEl" class="wb-view__board" data-wb-board @pointerdown.self="pressBoard">
      <div v-if="!cards.length && !withheld.length && !written.length" class="wb-view__empty">{{ $t('Views.whiteboard_empty') }}</div>
      <div
        v-for="(c, i) in cards"
        :key="c.id"
        class="wb-view__card"
        :class="[c.kind, { dragging: dragRef === c.id, 'is-fixed': !canMove }]"
        :style="styleOf(c.id, i)"
        :data-wb-card="c.id"
        @pointerdown="pressCard(c.id, $event)"
      >
        <span v-if="c.key" class="wb-view__card-key">{{ c.key }}</span>
        <span class="wb-view__card-name">{{ c.name }}</span>
      </div>
      <div
        v-for="w in withheld"
        :key="w.id"
        class="wb-view__card is-withheld is-fixed"
        :style="{ left: w.x + 'px', top: w.y + 'px' }"
        :data-wb-withheld="w.id"
      >
        <span class="wb-view__card-name">{{ $t('Views.whiteboard_card_withheld') }}</span>
      </div>
      <WhiteboardNote
        v-for="n in written"
        :key="n.id"
        :note="n"
        :box="boxOf(n)"
        :selected="selectedId === n.id"
        :editing="editingId === n.id"
        :dragging="dragRef === n.id"
        :can-edit="canWrite"
        :text-limit="textLimit"
        @press="pressNote(n, $event)"
        @edit="edit(n)"
        @done="editingId = null"
        @retype="putElement({ ...n, text: $event })"
        @tone="putElement({ ...n, tone: $event })"
        @remove="removeWritten(n)"
        @resize="pressResize(n, $event)"
      />
    </div>
  </div>
</template>

<script>
export default { name: 'WhiteboardView' };
</script>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, inject, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { taskListHelper } from '@/views/Projects/helper.js';
import { useGetterFunctions } from '@/composable';
import { useWhiteboardBoard, newElementId, NOTE_TONES, NOTE_BOUNDS } from './useWhiteboardBoard';
import WhiteboardNote from './WhiteboardNote.vue';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { t } = useI18n();
const { getters } = useStore();
const { groupBy } = taskListHelper();
const { getUser } = useGetterFunctions();
const selectedProject = inject('selectedProject', ref({}));
const socket = inject('$socket', ref(null));

const boardEl = ref(null);
const CARD_W = 180;
const GAP = 16;
const ROW_H = 92;
const NEW_SIZE = { note: { w: 180, h: 120 }, text: { w: 220, h: 40 } };
/* A press that travels less than this selects; it moves nothing and saves nothing. */
const DRAG_START = 3;

const projectId = computed(() => String(props.projectData?._id || ''));
const sprintId = computed(() => String(props.sprints?.[0]?.id || props.sprints?.[0]?._id || ''));
const {
    phase, canEdit, canMove, canWrite, saveState, usesLocal, hasUnusedLocal, withheld, elements, written, notesFull, textLimit, topLayer,
    history, historyFailed, placeOf, place, putElement, removeElement, uploadLocal, discardLocal, loadHistory, restore: restoreBoard,
} = useWhiteboardBoard({ projectId, sprintId, socket });

function pickTasks(map) {
    const pid = props.projectData?._id;
    const sid = sprintId.value;
    if (!pid || !sid || !map || !map[pid] || !map[pid][sid]) return null;
    const node = map[pid][sid];
    return Array.isArray(node.tasks) ? node.tasks : null;
}
const tasks = computed(() => pickTasks(getters['projectData/tasks']) || pickTasks(getters['projectData/tableTasks']) || []);
const activeTasks = computed(() => tasks.value.filter((task) => task && [0, 2, undefined, null].includes(task.deletedStatusKey)));
const kindOf = (task) => { const type = task?.status?.type || task?.statusType; return type === 'close' ? 'is-done' : type === 'inprogress' ? 'is-progress' : 'is-todo'; };
const loadedCards = computed(() => activeTasks.value.map((task) => ({ id: String(task._id), key: task.TaskKey, name: task.TaskName || t('Views.whiteboard_untitled'), kind: kindOf(task) })));
/* A card the saved board holds for a task this list has not loaded yet is drawn from what the server sent. */
const cards = computed(() => {
    const loaded = new Set(tasks.value.filter(Boolean).map((task) => String(task._id)));
    const others = usesLocal.value ? [] : elements.value
        .filter((element) => element.taskId && !loaded.has(element.taskId))
        .map((element) => ({ id: element.taskId, key: element.taskKey, name: element.title || t('Views.whiteboard_untitled'), kind: 'is-todo' }));
    return [...loadedCards.value, ...others];
});

const perRow = () => Math.max(1, Math.floor(((boardEl.value && boardEl.value.clientWidth) || 900) / (CARD_W + GAP)));
function gridPos(i) { const n = perRow(); return { x: (i % n) * (CARD_W + GAP) + GAP, y: Math.floor(i / n) * ROW_H + GAP }; }
function autoArrange() { place(Object.fromEntries(cards.value.map((c, i) => [c.id, gridPos(i)]))); }

const selectedId = ref(null);
const editingId = ref(null);
const dragRef = ref(null);
const dragAt = ref(null);
const sizeAt = ref(null);
/* One pointer at a time: a second finger, or a pen while a button is down, is ignored until the first lifts. */
let gesture = null;

function styleOf(id, i) {
    const at = (dragRef.value === id && dragAt.value) || placeOf(id) || gridPos(i);
    return { left: `${at.x}px`, top: `${at.y}px` };
}
function boxOf(n) {
    const at = (dragRef.value === n.id && dragAt.value) || n;
    const size = sizeAt.value && sizeAt.value.id === n.id ? sizeAt.value : n;
    return { x: at.x, y: at.y, w: size.w, h: size.h };
}
const currentOf = (id) => written.value.find((n) => n.id === id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

function endGesture() {
    gesture = null;
    dragRef.value = null;
    dragAt.value = null;
    sizeAt.value = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
}
function begin(e, state) {
    if (gesture || (e.pointerType === 'mouse' && e.button !== 0)) return;
    gesture = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ...state };
    try {
        e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch (error) {
        /* Without capture the drag still works; it only stops following a mouse that leaves the window. */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
}
const grabbedAt = (e) => { const r = e.currentTarget.getBoundingClientRect(); return { offX: e.clientX - r.left, offY: e.clientY - r.top }; };

function pressCard(id, e) {
    if (canMove.value) begin(e, { kind: 'card', id, ...grabbedAt(e) });
}
function pressNote(n, e) {
    selectedId.value = n.id;
    if (canWrite.value && editingId.value !== n.id) begin(e, { kind: 'note', id: n.id, ...grabbedAt(e) });
}
function pressResize(n, e) {
    if (canWrite.value) begin(e, { kind: 'resize', id: n.id, w0: n.w, h0: n.h });
}
/* A finger on empty space is left to the browser, which scrolls the board with its own momentum. A mouse or a
   pen has no such gesture, so its drag is turned into a pan here. */
function pressBoard(e) {
    selectedId.value = null;
    const el = boardEl.value;
    if (!el || e.pointerType === 'touch') return;
    const onScrollbar = e.offsetX >= el.clientWidth || e.offsetY >= el.clientHeight;
    if (!onScrollbar) begin(e, { kind: 'pan', left: el.scrollLeft, top: el.scrollTop });
}

function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId || !boardEl.value) return;
    /* A mouse button let go where no pointerup reached this page would otherwise leave the drag stuck to the cursor. */
    if (e.pointerType === 'mouse' && e.buttons === 0) { endGesture(); return; }
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_START) return;
    gesture.moved = true;
    if (gesture.kind === 'pan') {
        boardEl.value.scrollLeft = gesture.left - dx;
        boardEl.value.scrollTop = gesture.top - dy;
    } else if (gesture.kind === 'resize') {
        sizeAt.value = { id: gesture.id, w: clamp(gesture.w0 + dx, NOTE_BOUNDS.minW, NOTE_BOUNDS.maxW), h: clamp(gesture.h0 + dy, NOTE_BOUNDS.minH, NOTE_BOUNDS.maxH) };
    } else {
        const b = boardEl.value.getBoundingClientRect();
        dragRef.value = gesture.id;
        dragAt.value = {
            x: Math.max(0, e.clientX - b.left - gesture.offX + boardEl.value.scrollLeft),
            y: Math.max(0, e.clientY - b.top - gesture.offY + boardEl.value.scrollTop),
        };
    }
}
function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const { kind, id } = gesture;
    const note = kind === 'card' ? null : currentOf(id);
    if (kind === 'card' && dragAt.value) place({ [id]: dragAt.value });
    if (kind === 'note' && dragAt.value && note) putElement({ ...note, ...dragAt.value });
    if (kind === 'resize' && sizeAt.value && note) putElement({ ...note, w: sizeAt.value.w, h: sizeAt.value.h });
    endGesture();
}
function onPointerCancel(e) {
    if (gesture && e.pointerId === gesture.pointerId) endGesture();
}

function addWritten(type) {
    if (!canWrite.value || notesFull.value) return;
    const step = (written.value.length % 8) * GAP;
    const id = newElementId();
    const size = NEW_SIZE[type];
    const board = boardEl.value;
    putElement({
        id,
        type,
        text: '',
        ...(type === 'note' ? { tone: NOTE_TONES[0] } : {}),
        x: Math.max(0, (board?.scrollLeft || 0) + ((board?.clientWidth || 0) - size.w) / 2) + step,
        y: Math.max(0, (board?.scrollTop || 0) + ((board?.clientHeight || 0) - size.h) / 2) + step,
        ...size,
        z: topLayer.value + 1,
    });
    selectedId.value = id;
    editingId.value = id;
}
function edit(n) {
    if (!canWrite.value) return;
    selectedId.value = n.id;
    editingId.value = n.id;
}
function removeWritten(n) {
    if (!canWrite.value) return;
    removeElement(n.id);
    if (selectedId.value === n.id) selectedId.value = null;
    if (editingId.value === n.id) editingId.value = null;
}

const indicator = computed(() => {
    if (phase.value !== 'ready') return { state: phase.value, text: phase.value === 'loading' ? t('Views.whiteboard_loading') : '' };
    if (usesLocal.value) return { state: 'local', text: t('Views.whiteboard_local_state') };
    if (!canEdit.value) return { state: 'readonly', text: t('Views.view_only') };
    const texts = { saved: 'Views.whiteboard_saved', saving: 'Views.whiteboard_saving', offline: 'Views.whiteboard_offline', failed: 'Views.whiteboard_not_saved' };
    return { state: saveState.value, text: t(texts[saveState.value]) };
});

const historyOpen = ref(false);
const restoring = ref(false);
const restoreFailed = ref(false);
function toggleHistory() {
    historyOpen.value = !historyOpen.value;
    restoreFailed.value = false;
    if (historyOpen.value) loadHistory();
}
async function restore(revision) {
    restoring.value = true;
    restoreFailed.value = !(await restoreBoard(revision));
    restoring.value = false;
    if (!restoreFailed.value) loadHistory();
}
const nameOf = (userId) => getUser(userId)?.Employee_Name || '';
const whenOf = (savedAt) => { const date = savedAt ? new Date(savedAt) : null; return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ''; };

function ensureTasksLoaded() {
    if (tasks.value.length) return;
    const proj = (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData;
    if (!proj || !proj._id || !Array.isArray(props.sprints) || !props.sprints.length) return;
    try { groupBy(0, true, proj, props.sprints, ref([]), false, 'list', false, true, () => {}); } catch (e) { console.error('ERROR in loading the whiteboard tasks: ', e); }
}
onMounted(() => ensureTasksLoaded());
watch(() => props.sprints, () => ensureTasksLoaded(), { deep: true });
watch(sprintId, () => { historyOpen.value = false; selectedId.value = null; editingId.value = null; });
onBeforeUnmount(endGesture);
</script>

<style scoped>
.wb-view { display: flex; flex-direction: column; width: 100%; height: 100%; background: var(--surface); color: var(--ink); }
.wb-view__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 14px; border-bottom: 1px solid var(--hairline); flex: 0 0 auto; }
.wb-view__title { font-size: 14px; font-weight: 700; color: var(--ink); }
.wb-view__count { font-size: 12px; color: var(--ink-2); }
.wb-view__state { font-size: 12px; color: var(--ink-2); }
.wb-view__state.is-offline, .wb-view__state.is-failed { color: var(--warn-ink); }
.wb-view__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.wb-view__btn { border: 1px solid var(--border); background: var(--surface); color: var(--ink); border-radius: var(--r-chip); padding: 5px 12px; font-size: 12px; cursor: pointer; }
.wb-view__btn:hover:not(:disabled) { background: var(--surface-hover); }
.wb-view__btn:disabled { opacity: .55; cursor: not-allowed; }
.wb-view__btn:focus-visible { outline: none; box-shadow: var(--focus); }
.wb-view__notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 14px; background: var(--brand-tint); color: var(--ink); font-size: 13px; border-bottom: 1px solid var(--hairline); flex: 0 0 auto; }
.wb-view__notice > span { flex: 1 1 220px; min-width: 0; }
.wb-view__history { flex: 0 0 auto; max-height: 40%; overflow: auto; padding: 8px 14px; border-bottom: 1px solid var(--hairline); background: var(--canvas); }
.wb-view__history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.wb-view__history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wb-view__history-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 6px 10px; background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--r-input); }
.wb-view__history-what { display: flex; flex-direction: column; min-width: 0; }
.wb-view__history-who { font-size: 13px; color: var(--ink); }
.wb-view__history-when, .wb-view__history-empty { font-size: 12px; color: var(--ink-2); margin: 0; }
.wb-view__board { position: relative; flex: 1 1 auto; min-height: 360px; overflow: auto; touch-action: pan-x pan-y; background:
    linear-gradient(var(--hairline) 1px, transparent 1px) 0 0 / 24px 24px,
    linear-gradient(90deg, var(--hairline) 1px, transparent 1px) 0 0 / 24px 24px, var(--surface); }
.wb-view__empty { position: absolute; top: 48px; left: 0; right: 0; text-align: center; color: var(--ink-2); font-size: 14px; pointer-events: none; }
.wb-view__card { position: absolute; width: 180px; min-height: 64px; box-sizing: border-box; background: var(--surface); border: 1px solid var(--hairline); border-left: 4px solid var(--ink-3); border-radius: var(--r-input); padding: 8px 10px; box-shadow: var(--shadow-card); cursor: grab; user-select: none; touch-action: none; }
.wb-view__card.dragging { cursor: grabbing; box-shadow: var(--shadow-pop); z-index: 1000; }
.wb-view__card.is-fixed { cursor: default; touch-action: pan-x pan-y; }
.wb-view__card.is-progress { border-left-color: var(--warn); }
.wb-view__card.is-done { border-left-color: var(--ok); }
.wb-view__card.is-withheld { border-style: dashed; background: var(--fill); box-shadow: none; }
.wb-view__card.is-withheld .wb-view__card-name { color: var(--ink-2); }
.wb-view__card-key { display: block; font-size: 11px; font-weight: 600; color: var(--brand); margin-bottom: 3px; }
.wb-view__card-name { font-size: 13px; color: var(--ink); overflow-wrap: anywhere; }
</style>
