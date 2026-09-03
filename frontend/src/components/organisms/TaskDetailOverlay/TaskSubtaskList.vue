<template>
    <section class="ah-subtasks">
        <header class="ah-subtasks__head">
            <span class="ah-subtasks__title">{{ $t('ProjectDetails.subtask') }}</span>
            <span class="ah-subtasks__rollup ah-mono">{{ rollupText }}</span>
            <div class="ah-subtasks__bar" v-if="rollup.total"><div class="ah-subtasks__bar-fill" :style="{ width: `${rollup.percent}%` }"></div></div>
            <button v-if="canCreate" type="button" class="ah-subtasks__add" @click="creating = !creating">
                {{ creating ? $t('Projects.cancel') : `+ ${$t('Projects.add_subtask')}` }}
            </button>
        </header>

        <template v-if="isMainSpinner">
            <Skelaton v-for="i in 3" :key="i" class="ah-subtasks__skeleton" />
        </template>
        <template v-else>
            <div v-for="sub in subtasks" :key="sub._id" class="ah-subtasks__row" :class="{ 'is-done': isDone(sub), 'is-pending': pending[sub._id] }">
                <input
                    type="checkbox"
                    class="ah-check"
                    :checked="isDone(sub)"
                    :disabled="!canSetStatus || pending[sub._id]"
                    :aria-label="sub.TaskName"
                    @change="toggle(sub, $event.target.checked)"
                />
                <span class="ah-subtasks__key ah-mono">{{ sub.TaskKey }}</span>
                <button type="button" class="ah-subtasks__name" :title="sub.TaskName" @click="$emit('open', sub)">{{ sub.TaskName }}</button>
                <span v-if="assignee(sub)" class="ah-avatar ah-avatar--sm" :title="assignee(sub).Employee_Name">
                    <img v-if="assignee(sub).Employee_profileImageURL" :src="assignee(sub).Employee_profileImageURL" :alt="assignee(sub).Employee_Name" />
                    <template v-else>{{ initials(assignee(sub).Employee_Name) }}</template>
                </span>
                <span class="ah-subtasks__hours ah-mono">{{ hours(sub.totalEstimatedTime) }}</span>
            </div>
            <div v-if="!subtasks.length && !creating" class="ah-empty ah-subtasks__empty">
                {{ canCreate ? $t('TaskPanel.no_subtasks_hint') : $t('Projects.no_sub_tasks_found') }}
            </div>
        </template>

        <div v-if="creating" class="ah-subtasks__create">
            <CreateTask
                :sprint="{ ...task.sprintArray, id: task.sprintId, folderId: task.folderObjId }"
                :taskId="task._id"
                :project="project"
                :assigneeOptions="task.AssigneeUserId"
                :considerWidth="false"
                @cancel="creating = false"
            />
        </div>
        <p v-if="canCreate" class="ah-subtasks__hint ah-small">
            {{ $t('TaskPanel.subtask_keys_hint') }}
        </p>
    </section>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import CreateTask from "@/components/atom/CreateTask/CreateTask.vue";
import taskClass from "@/utils/TaskOperations";
import { useCustomComposable, useGetterFunctions } from "@/composable";

defineOptions({ name: "TaskSubtaskList" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, required: true },
    subtasks: { type: Array, default: () => [] },
    isMainSpinner: { type: Boolean, default: false }
});
const emit = defineEmits(["open", "rollup"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const { checkPermission } = useCustomComposable();
const userId = inject("$userId");

const creating = ref(false);
const pending = reactive({});
const optimistic = reactive({});

const canCreate = computed(() => checkPermission("task.sub_task_create", props.project?.isGlobalPermission) === true);
const canSetStatus = computed(() => checkPermission("task.task_status", props.project?.isGlobalPermission) === true);

function statusType(sub) {
    if (optimistic[sub._id]) return optimistic[sub._id];
    return sub?.status?.type || sub?.statusType || "";
}
function isDone(sub) {
    return statusType(sub) === "close";
}

const rollup = computed(() => {
    const list = props.subtasks.filter((s) => s && (s.deletedStatusKey === 0 || s.deletedStatusKey === undefined));
    const total = list.length;
    const done = list.filter(isDone).length;
    const minutes = list.reduce((acc, s) => acc + (Number(s.totalEstimatedTime) || 0), 0);
    const doneMinutes = list.filter(isDone).reduce((acc, s) => acc + (Number(s.totalEstimatedTime) || 0), 0);
    return { total, done, minutes, doneMinutes, percent: total ? Math.round((done / total) * 100) : 0 };
});
watch(rollup, (value) => emit("rollup", value), { immediate: true });

const rollupText = computed(() => {
    if (!rollup.value.total) return "";
    const base = t("TaskPanel.subtasks_rollup", { done: rollup.value.done, total: rollup.value.total });
    if (!rollup.value.minutes) return base;
    return `${base} · ${t("TaskPanel.subtasks_hours_rollup", { done: hours(rollup.value.doneMinutes), total: hours(rollup.value.minutes) })}`;
});

function hours(minutes) {
    const total = Number(minutes) || 0;
    if (!total) return "—";
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}
function assignee(sub) {
    const id = sub?.AssigneeUserId?.[0];
    return id ? getUser(id) : null;
}
function initials(name) {
    return String(name || "?").trim().charAt(0).toUpperCase();
}

function pickStatus(done) {
    const statuses = props.project?.taskStatusData || [];
    if (done) return statuses.find((s) => s.type === "close");
    return statuses.find((s) => s.type === "open") || statuses.find((s) => s.type !== "close");
}

function toggle(sub, done) {
    const next = pickStatus(done);
    if (!next) return;
    const previousType = statusType(sub);
    optimistic[sub._id] = next.type;
    pending[sub._id] = true;
    const user = getUser(userId.value);
    const current = props.project?.taskStatusData?.find((s) => s.key === sub.statusKey) || {};
    taskClass.updateStatus({
        newStatus: {
            status: { text: next.name, key: next.key, type: next.type, value: next.value },
            statusType: next.type,
            statusKey: next.key
        },
        prevStatus: {
            backColor: current.bgColor,
            color: current.textColor,
            statusName: current.name,
            taskName: sub.TaskName,
            bgColor: next.bgColor,
            textColor: next.textColor,
            taskId: sub._id,
            updatedTaskName: next.name
        },
        projectData: {
            _id: props.project._id,
            CompanyId: props.project.CompanyId,
            lastTaskId: props.project.lastTaskId,
            ProjectName: props.project.ProjectName,
            ProjectCode: props.project.ProjectCode
        },
        task: sub,
        userData: { id: user.id, Employee_Name: user.Employee_Name, companyOwnerId: getters["settings/companyOwnerDetail"]?.userId }
    }).catch((error) => {
        console.error("ERROR in subtask status: ", error);
        optimistic[sub._id] = previousType;
        $toast.error(t("Toast.Status_not_updated"), { position: "top-right" });
    }).finally(() => {
        delete pending[sub._id];
    });
}

watch(() => props.subtasks.map((s) => `${s._id}:${s?.status?.type || s?.statusType || ""}`).join("|"), () => {
    props.subtasks.forEach((s) => {
        if (optimistic[s._id] && optimistic[s._id] === (s?.status?.type || s?.statusType)) delete optimistic[s._id];
    });
});
</script>
