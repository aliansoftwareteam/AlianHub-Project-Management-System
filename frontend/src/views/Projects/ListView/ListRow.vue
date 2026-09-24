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
                v-if="!isSub && canSelect"
                type="checkbox"
                class="ah-check"
                :checked="selected"
                :aria-label="data.TaskName"
                @click="onSelect($event)"
                @keydown.shift="onSelect($event)"
            />
        </span>

        <div class="lv2__title lv2__c-title" role="cell" :class="{ 'lv2__title--sub': isSub }">
            <span v-if="!isSub" class="lv2__grip draggable_icon" aria-hidden="true"><ShellIcon name="grip" :size="12" /></span>
            <button
                v-if="!isSub && data.isParentTask && subtaskCount"
                type="button"
                class="lv2__disclose"
                :aria-expanded="expanded"
                :aria-label="$t('List.toggle_subtasks')"
                @click.stop="$emit('toggle-subtasks')"
            >{{ expanded ? '▾' : '▸' }}</button>
            <input
                v-if="isSub"
                type="checkbox"
                class="ah-check"
                :checked="done"
                :disabled="!canSetStatus"
                :aria-label="data.TaskName"
                @click.stop
                @change="$emit('toggle-done', data, $event.target.checked)"
            />
            <ListStatusCircle
                v-else
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
            <span v-if="!isSub && !renaming" class="lv2__key">{{ metaText }}</span>
            <span v-if="tracking" class="lv2__timer" :title="$t('List.tracking_now')">● {{ timerText }}</span>
            <button v-if="agentLine" type="button" class="lv2__agent-line" :title="agentLine" @click.stop="$emit('review-agent', proposal)">
                ✦ {{ agentLine }}
            </button>
            <ListRowActions
                v-if="!isSub && edit && !renaming"
                :task="data"
                :href="edit.taskHref(data)"
                :can-rename="rights.rename"
                :can-subtask="rights.subtask"
                @rename="startRename"
                @add-subtask="$emit('add-subtask', data)"
                @copy-link="edit.copyLink(data)"
                @copy-key="edit.copyKey && edit.copyKey(data)"
                @open="open"
            />
        </div>

        <span class="lv2__c-assignee" role="cell">
            <ListAssigneeCell
                :task="data"
                :editable="!isSub && rights.assignee"
                :options="!isSub && rights.assignee ? edit.assigneeOptions(data) : []"
                :multiple="Boolean(edit && edit.multipleAssignees.value)"
                @change="(change) => edit.setAssignee(data, change, { row: rowEl })"
            />
        </span>

        <span class="lv2__c-due" role="cell">
            <ListDueCell :task="data" :done="done" :editable="!isSub && rights.due" @change="(date) => edit.setDue(data, date, { row: rowEl })" />
        </span>

        <span class="lv2__c-prio" role="cell">
            <ListPriorityCell
                v-if="!isSub && showPriority"
                :task="data"
                :editable="rights.priority"
                @change="(option) => edit.setPriority(data, option, { row: rowEl })"
            />
        </span>

        <span class="lv2__est lv2__c-est" role="cell">{{ estimate }}</span>

        <span class="lv2__c-risk" role="cell">
            <span v-if="!isSub && risk.score" class="lv2__risk" :class="`lv2__risk--${risk.level}`" :title="riskTitle">
                <span class="lv2__risk-dot"></span>{{ $t(`List.risk_${risk.level}`) }} · {{ risk.score }}
            </span>
        </span>

        <span class="lv2__c-done" role="cell">
            <ProvenanceBadge :task="data" />
        </span>
    </div>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProvenanceBadge from "@/components/molecules/Provenance/ProvenanceBadge.vue";
import { fmtEstimate } from "@/components/molecules/Home/homeFormat";
import ListStatusCircle from "./ListStatusCircle.vue";
import ListAssigneeCell from "./ListAssigneeCell.vue";
import ListDueCell from "./ListDueCell.vue";
import ListPriorityCell from "./ListPriorityCell.vue";
import ListRowActions from "./ListRowActions.vue";
import { timerState, isTimerFor, elapsedSeconds } from "@/components/organisms/TaskDetailOverlay/useTaskTimer";
import { taskRisk } from "@/views/Projects/composables/taskRisk";
import { isClosedTask, subtaskProgress, subtaskTotal } from "./subtaskProgress";
import { taskNavAttrs } from "@/components/organisms/TaskDetailOverlay/taskNavigation";

defineOptions({ name: "ListRow" });

const props = defineProps({
    data: { type: Object, required: true },
    isSub: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    expanded: { type: Boolean, default: false },
    canSelect: { type: Boolean, default: false },
    canSetStatus: { type: Boolean, default: false },
    run: { type: Object, default: null },
    proposal: { type: Object, default: null },
    progress: { type: Object, default: null }
});
const emit = defineEmits(["open", "select", "toggle-subtasks", "toggle-done", "review-agent", "add-subtask"]);

const { t } = useI18n();

const NO_RIGHTS = { status: false, assignee: false, due: false, priority: false, rename: false, subtask: false };
const edit = inject("listRowEdit", null);
const rights = computed(() => edit?.rights.value || NO_RIGHTS);
const statuses = computed(() => edit?.statuses.value || []);
const showPriority = computed(() => (edit ? edit.showPriority.value : true));
const rowEl = ref(null);

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
    })}`;
});

const tracking = computed(() => Boolean(timerState.entry) && isTimerFor(props.data._id));
const timerText = computed(() => {
    const total = elapsedSeconds.value;
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
});

const agentLine = computed(() => {
    if (props.proposal) return `${props.proposal.agentName}: ${props.proposal.what}`;
    if (props.run) return `${props.run.agentName}: ${t("List.agent_working")}`;
    return "";
});

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
</script>
