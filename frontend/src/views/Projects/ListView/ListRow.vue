<template>
    <div
        ref="rowEl"
        class="lv2__row"
        role="row"
        v-bind="taskNavAttrs(data)"
        :class="{ 'is-selected': selected, 'is-sub': isSub, 'is-done': done, 'is-agent': !!run }"
        @click="open"
    >
        <span class="lv2__select lv2__c-select" role="cell" @click.stop>
            <input
                v-if="canSelect"
                type="checkbox"
                class="ah-check"
                :checked="selected"
                :aria-label="$t(isSub ? 'List.select_subtask' : 'List.select_task', { name: data.TaskName })"
                @click="onSelect($event)"
                @keydown.shift="onSelect($event)"
            />
        </span>

        <div class="lv2__title lv2__c-title" role="cell" :class="{ 'lv2__title--sub': isSub }" :style="isSub ? { '--lv2-depth': level } : null">
            <span v-if="!isSub" class="lv2__grip draggable_icon" aria-hidden="true"><ShellIcon name="grip" :size="12" /></span>
            <button
                v-if="canNest && subtaskCount"
                type="button"
                class="lv2__disclose"
                :aria-expanded="expanded"
                :aria-label="$t('List.toggle_subtasks')"
                @click.stop="$emit('toggle-subtasks')"
            >{{ expanded ? '▾' : '▸' }}</button>
            <span v-else-if="isSub" class="lv2__disclose lv2__disclose--none" aria-hidden="true"></span>
            <ListStatusCircle
                :task="data"
                :statuses="statuses"
                :editable="rights.status"
                @change="(status) => edit.setStatus(data, status, { row: rowEl })"
            />
            <input
                v-if="renaming"
                ref="renameInput"
                v-model="draft"
                type="text"
                class="lv2__rename"
                maxlength="250"
                :aria-label="$t('List.rename_label')"
                @click.stop
                @keydown.enter.prevent="saveRename"
                @keydown.esc.stop.prevent="cancelRename"
                @blur="saveRename"
            />
            <button v-else type="button" class="lv2__name" :title="data.TaskName" @click.stop="open">{{ data.TaskName }}</button>
            <span v-if="!renaming && metaText" class="lv2__key">{{ metaText }}</span>
            <TaskHomeMark v-if="!renaming && !isSub" :task="data" :list="viewedList" />
            <TaskUnreadMark v-if="!renaming" :task="data" @open="open" />
            <span v-if="tracking" class="lv2__timer" :title="$t('List.tracking_now')">● {{ timerText }}</span>
            <TaskAgentMark v-if="!renaming" :task-id="String(data._id)" />
            <button v-if="agentLine" type="button" class="lv2__agent-line" :title="agentLine" @click.stop="$emit('review-agent', proposal)">
                ✦ {{ agentLine }}
            </button>
            <ListRowActions
                v-if="edit && !renaming"
                :task="data"
                :href="edit.taskHref(data)"
                :items="menuItems"
                @choose="runMenu"
            />
        </div>

        <template v-for="column in columns" :key="column.id">
            <span v-if="column.id === 'tags'" class="lv2__c-tags" role="cell">
                <TaskTagCell :task="data" :limit="tagLimit" />
            </span>

            <span v-else-if="column.id === 'assignee'" class="lv2__c-assignee" role="cell">
                <ListAssigneeCell
                    :task="data"
                    :editable="rights.assignee"
                    :options="rights.assignee ? edit.assigneeOptions(data, parent) : []"
                    :multiple="Boolean(edit && edit.multipleAssignees.value)"
                    @change="(change) => edit.setAssignee(data, change, { row: rowEl })"
                />
            </span>

            <span v-else-if="column.id === 'due'" class="lv2__c-due" role="cell">
                <ListDueCell :task="data" :done="done" :editable="rights.due" @change="(date) => edit.setDue(data, date, { row: rowEl })" />
            </span>

            <span v-else-if="column.id === 'priority'" class="lv2__c-prio" role="cell">
                <ListPriorityCell
                    v-if="showPriority"
                    :task="data"
                    :editable="rights.priority"
                    @change="(option) => edit.setPriority(data, option, { row: rowEl })"
                />
            </span>

            <span v-else-if="column.id === 'estimate'" class="lv2__est lv2__c-est" role="cell">
                <EstimateCell
                    v-if="edit && rights.estimate"
                    :task="data"
                    editable
                    @change="(minutes, reason) => edit.setEstimate(data, minutes, { row: rowEl, reason })"
                />
                <template v-else>{{ estimate }}</template>
            </span>

            <span v-else-if="column.id === 'risk'" class="lv2__c-risk" role="cell">
                <span v-if="!isSub && risk.score" class="lv2__risk" :class="`lv2__risk--${risk.level}`" :title="riskTitle">
                    <span class="lv2__risk-dot"></span>{{ $t(`List.risk_${risk.level}`) }} · {{ risk.score }}
                </span>
            </span>

            <span v-else-if="column.id === 'doneBy'" class="lv2__c-done" role="cell">
                <ProvenanceBadge :task="data" />
            </span>

            <span v-else :class="listColumnClass(column)" role="cell">
                <TaskColumnCell :column="column" :task="data" :rowEl="rowEl" />
            </span>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { proposalTitle } from "@/views/Ai/plainLabels";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProvenanceBadge from "@/components/molecules/Provenance/ProvenanceBadge.vue";
import { fmtEstimate } from "@/components/molecules/Home/homeFormat";
import ListStatusCircle from "./ListStatusCircle.vue";
import ListAssigneeCell from "./ListAssigneeCell.vue";
import ListDueCell from "./ListDueCell.vue";
import ListPriorityCell from "./ListPriorityCell.vue";
import ListRowActions from "./ListRowActions.vue";
import { openTemplateDialog } from "@/components/molecules/TaskTemplates/taskTemplates";
import TaskTagCell from "@/components/molecules/TagList/TaskTagCell.vue";
import { timerState, isTimerFor, elapsedSeconds } from "@/components/organisms/TaskDetailOverlay/useTaskTimer";
import { taskRisk } from "@/views/Projects/composables/taskRisk";
import { isClosedTask, subtaskProgress, subtaskTotal } from "./subtaskProgress";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";
import EstimateCell from "@/views/Projects/components/columns/EstimateCell.vue";
import TaskColumnCell from "@/views/Projects/components/columns/TaskColumnCell.vue";
import { defaultColumns, listColumnClass } from "@/views/Projects/composables/viewColumns";
import { taskMenuItems } from "@/views/Projects/composables/taskMenu";
import TaskHomeMark from "@/views/Projects/components/TaskHomeMark.vue";
import TaskAgentMark from "@/views/Projects/components/TaskAgentMark.vue";
import TaskUnreadMark from "@/views/Projects/components/TaskUnreadMark.vue";
import { MAX_DEPTH } from "@taskTreeRules";

defineOptions({ name: "ListRow" });

const props = defineProps({
    data: { type: Object, required: true },
    isSub: { type: Boolean, default: false },
    depth: { type: Number, default: 0 },
    parent: { type: Object, default: null },
    selected: { type: Boolean, default: false },
    expanded: { type: Boolean, default: false },
    canSelect: { type: Boolean, default: false },
    run: { type: Object, default: null },
    proposal: { type: Object, default: null },
    progress: { type: Object, default: null }
});
const emit = defineEmits(["open", "select", "toggle-subtasks", "review-agent", "add-subtask"]);

const { t } = useI18n();

const NO_RIGHTS = { status: false, assignee: false, due: false, priority: false, rename: false, subtask: false, estimate: false, points: false, customField: false, template: false };
const edit = inject("listRowEdit", null);
const rights = computed(() => edit?.rights.value || NO_RIGHTS);
const menu = inject("listRowMenu", null);
const menuRights = computed(() => ({ rename: rights.value.rename, subtask: rights.value.subtask, template: rights.value.template, ...menu?.rights.value }));
/* How many levels down the row sits. A row on the last level takes no subtasks. */
const level = computed(() => props.depth || (props.isSub ? 1 : 0));
const canNest = computed(() => level.value < MAX_DEPTH);
const viewedList = inject("viewedList", ref(null));
const menuItems = computed(() => taskMenuItems(props.data, menuRights.value, { isSub: props.isSub, canNest: canNest.value, listId: viewedList.value?.sprintId }));
const statuses = computed(() => edit?.statuses.value || []);
const showPriority = computed(() => (edit ? edit.showPriority.value : true));
const rowEl = ref(null);
const injectedColumns = inject("listColumns", null);
const columns = computed(() => injectedColumns?.value || defaultColumns("list"));
const clientWidth = inject("$clientWidth", ref(1280));
const tagLimit = computed(() => (clientWidth.value < 768 ? 2 : 3));

const done = computed(() => isClosedTask(props.data));
const subtaskCount = computed(() => subtaskTotal(props.data, props.progress));
const progress = computed(() => subtaskProgress(props.data, props.progress));

const metaText = computed(() => {
    const key = props.data.TaskKey && props.data.TaskKey !== "--" ? props.data.TaskKey : "";
    if (!progress.value) return key;
    const text = `${progress.value.done}/${progress.value.total}`;
    return key ? `${key} · ${text}` : text;
});

const estimate = computed(() => fmtEstimate(props.data.totalEstimatedTime));

const risk = computed(() => taskRisk(props.data));
const riskTitle = computed(() => {
    const top = risk.value.top;
    if (!top) return "";
    return `${t("List.risk_score", { score: risk.value.score })} — ${t(`List.risk_factor_${top.key}`, {
        days: top.days || 0,
        pct: top.overPct || 0,
        done: top.done || 0,
        total: top.total || 0
    }, top.total || 0)}`;
});

const tracking = computed(() => Boolean(timerState.entry) && isTimerFor(props.data._id));
const timerText = computed(() => {
    const total = elapsedSeconds.value;
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
});

const agentLine = computed(() => (props.proposal ? `${props.proposal.agentName}: ${proposalTitle(t, props.proposal)}` : ""));

function open() {
    emit("open", props.data);
}

const renaming = ref(false);
const draft = ref("");
const renameInput = ref(null);

function startRename() {
    draft.value = props.data.TaskName || "";
    renaming.value = true;
    nextTick(() => {
        renameInput.value?.focus();
        renameInput.value?.select();
    });
}

function saveRename() {
    if (!renaming.value) return;
    renaming.value = false;
    edit.rename(props.data, draft.value, { row: rowEl.value });
    nextTick(() => rowEl.value?.querySelector(".lv2__name")?.focus());
}

function cancelRename() {
    renaming.value = false;
    nextTick(() => rowEl.value?.querySelector(".lv2__name")?.focus());
}

function onSelect(event) {
    emit("select", props.data, event);
}

/* A subtask moves and duplicates through the sidebars the Board uses: the List's own
 * move and duplicate are bulk calls that place whole tasks. */
function runMenu(id) {
    const task = props.data;
    const viaSidebar = () => menu.openSidebar(id, task);
    const actions = {
        rename: startRename,
        subtask: () => emit("add-subtask", task),
        "copy-link": () => edit.copyLink(task),
        "copy-key": () => edit.copyKey?.(task),
        open,
        "save-template": () => openTemplateDialog({ mode: "save", task }),
        "convert-subtask": viaSidebar,
        "convert-list": viaSidebar,
        move: props.isSub ? viaSidebar : () => menu.startMove(task),
        "remove-from-list": () => menu.removeFromList(task, viewedList.value?.sprintId),
        duplicate: props.isSub ? viaSidebar : () => menu.duplicate(task),
        "duplicate-subtasks": () => menu.duplicate(task, { withSubtasks: true }),
        merge: viaSidebar,
        archive: () => menu.archive(task),
        restore: () => menu.restore(task),
        delete: () => menu.remove(task)
    };
    actions[id]?.();
}
</script>
