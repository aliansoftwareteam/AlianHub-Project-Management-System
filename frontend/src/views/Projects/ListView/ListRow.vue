<template>
    <div
        class="lv2__row"
        :class="{ 'is-selected': selected, 'is-sub': isSub, 'is-done': done, 'is-agent': !!run }"
        @click="open"
    >
        <span class="lv2__select lv2__c-select" @click.stop>
            <input
                v-if="!isSub && canSelect"
                type="checkbox"
                class="ah-check"
                :checked="selected"
                :aria-label="data.TaskName"
                @click="onSelect($event)"
            />
        </span>

        <div class="lv2__title" :class="{ 'lv2__title--sub': isSub }">
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
            <button type="button" class="lv2__name" :title="data.TaskName" @click.stop="open">{{ data.TaskName }}</button>
            <span v-if="!isSub" class="lv2__key">{{ metaText }}</span>
            <span v-if="tracking" class="lv2__timer" :title="$t('List.tracking_now')">● {{ timerText }}</span>
            <button v-if="agentLine" type="button" class="lv2__agent-line" :title="agentLine" @click.stop="$emit('review-agent', proposal)">
                ✦ {{ agentLine }}
            </button>
        </div>

        <span class="lv2__c-assignee">
            <span v-if="assignee" class="ah-avatar" :title="assignee.Employee_Name">
                <img v-if="assignee.Employee_profileImageURL" :src="assignee.Employee_profileImageURL" :alt="assignee.Employee_Name" />
                <template v-else>{{ initial(assignee.Employee_Name) }}</template>
            </span>
        </span>

        <span class="lv2__due lv2__c-due" :class="{ 'lv2__due--overdue': overdue }">{{ dueText }}</span>

        <span class="lv2__c-prio">
            <span v-if="!isSub && data.Task_Priority" class="lv2__prio" :class="priorityClass">{{ $t(priority.label) }}</span>
        </span>

        <span class="lv2__est lv2__c-est">{{ estimate }}</span>

        <span class="lv2__c-risk">
            <span v-if="!isSub && risk.score" class="lv2__risk" :class="`lv2__risk--${risk.level}`" :title="riskTitle">
                <span class="lv2__risk-dot"></span>{{ risk.score }}
            </span>
        </span>

        <span class="lv2__c-done">
            <ProvenanceBadge :task="data" />
        </span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import ProvenanceBadge from "@/components/molecules/Provenance/ProvenanceBadge.vue";
import { useGetterFunctions } from "@/composable";
import { dueBucket, dueLabel, fmtEstimate, priorityMeta } from "@/components/molecules/Home/homeFormat";
import { timerState, isTimerFor, elapsedSeconds } from "@/components/organisms/TaskDetailOverlay/useTaskTimer";
import { taskRisk } from "@/views/Projects/composables/taskRisk";

defineOptions({ name: "ListRow" });

const props = defineProps({
    data: { type: Object, required: true },
    isSub: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    expanded: { type: Boolean, default: false },
    canSelect: { type: Boolean, default: false },
    canSetStatus: { type: Boolean, default: false },
    run: { type: Object, default: null },
    proposal: { type: Object, default: null }
});
const emit = defineEmits(["open", "select", "toggle-subtasks", "toggle-done", "review-agent"]);

const { t } = useI18n();
const { getUser } = useGetterFunctions();

const done = computed(() => (props.data.status?.type || props.data.statusType) === "close");
const subtaskCount = computed(() => (Array.isArray(props.data.subtaskArray) ? props.data.subtaskArray.length : 0) || Number(props.data.subTasks) || 0);
const subtaskDone = computed(() => (props.data.subtaskArray || []).filter((s) => (s?.status?.type || s?.statusType) === "close").length);

const metaText = computed(() => {
    const key = props.data.TaskKey && props.data.TaskKey !== "--" ? props.data.TaskKey : "";
    if (!subtaskCount.value) return key;
    const progress = `${subtaskDone.value}/${subtaskCount.value}`;
    return key ? `${key} · ${progress}` : progress;
});

const assignee = computed(() => {
    const id = props.data.AssigneeUserId?.[0];
    return id ? getUser(id) : null;
});
const initial = (name) => String(name || "?").trim().charAt(0).toUpperCase();

/* The mock reds "Today" as well as a past date: both are out of runway. */
const overdue = computed(() => {
    if (done.value) return false;
    const bucket = dueBucket(props.data);
    return bucket === "overdue" || bucket === "today";
});
const dueText = computed(() => (props.data.DueDate ? dueLabel(props.data.DueDate, t) : ""));

const priority = computed(() => priorityMeta(props.data.Task_Priority));
const priorityClass = computed(() => ({
    "lv2__prio--danger": priority.value.cls === "ah-chip--danger",
    "lv2__prio--warn": priority.value.cls === "ah-chip--warn"
}));

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
function onSelect(event) {
    emit("select", props.data, event);
}
</script>
