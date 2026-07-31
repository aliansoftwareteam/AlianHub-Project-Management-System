<template>
    <div class="convert__overlay" @click.self="close">
        <div class="convert__dialog">
            <div class="d-flex align-items-center justify-content-between convert__head">
                <span class="font-size-15 font-weight-700">{{ $t('Notepad.convert_title') }}</span>
                <span class="cursor-pointer font-size-16 convert__close" @click="close">&#10005;</span>
            </div>

            <label class="convert__label">{{ $t('Notepad.task_name') }}</label>
            <input
                v-model="taskName"
                class="convert__input"
                :maxlength="250"
                :placeholder="$t('PlaceHolder.Task_name')"
            />
            <div v-if="nameError" class="convert__error">{{ nameError }}</div>

            <label class="convert__label">{{ $t('Notepad.select_project') }}</label>
            <select v-model="selectedProjectId" class="convert__input" @change="onProjectChange">
                <option value="" disabled>{{ $t('Notepad.select_project_placeholder') }}</option>
                <option v-for="proj in projectOptions" :key="proj._id" :value="proj._id">{{ proj.ProjectName }}</option>
            </select>

            <label class="convert__label">{{ $t('Notepad.select_sprint') }}</label>
            <select v-model="selectedSprintId" class="convert__input" :disabled="!selectedProjectId || sprintLoading">
                <option value="" disabled>
                    {{ sprintLoading ? $t('Notepad.loading_sprints') : $t('Notepad.select_sprint_placeholder') }}
                </option>
                <option v-for="sprint in sprintOptions" :key="sprint.id" :value="sprint.id">{{ sprint.name }}</option>
            </select>

            <div class="d-flex align-items-center justify-content-end convert__actions">
                <button class="convert__btn-ghost" @click="close">{{ $t('Notepad.cancel') }}</button>
                <button class="convert__btn-primary" :disabled="isBusy" @click="convert">
                    {{ isBusy ? $t('Notepad.converting') : $t('Notepad.convert_action') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { computed, defineProps, defineEmits, inject, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";

// UTILS — reuse the EXISTING task-creation flow (same util CreateTask.vue and
// Comments.vue use; it wraps POST /api/v2/tasks). We never write a new task path.
import taskClass from "@/utils/TaskOperations";
import { useGetterFunctions } from "@/composable";
import { taskPlanPermission } from "@/composable/commonFunction";
import { deriveTaskName } from "@/utils/notepadConvert";

// Must match the editor the task description is rendered with
// (frontend/package.json → @editorjs/editorjs).
const EDITORJS_VERSION = "2.30.7";

const { t } = useI18n();
const $toast = useToast();
const { getters, dispatch } = useStore();
const { getUser } = useGetterFunctions();
const { checkTaskPerSprintPermisssion } = taskPlanPermission();

const companyId = inject("$companyId");
const userId = inject("$userId");

const props = defineProps({
    note: {
        type: Object,
        required: true,
    },
});

const emit = defineEmits(["close", "converted"]);

const taskName = ref(deriveTaskName(props.note));
const nameError = ref("");
const selectedProjectId = ref("");
const selectedSprintId = ref("");
const sprintOptions = ref([]);
const sprintLoading = ref(false);
const isBusy = ref(false);

const companyOwner = computed(() => getters["settings/companyOwnerDetail"]);

// Only active (non-closed) projects that carry the task metadata the create flow
// needs (taskStatusData + taskTypeCounts). Mirrors the data CreateTask.vue reads.
const projectOptions = computed(() => {
    const list = getters["projectData/onlyActiveProjects"];
    const data = (list && list.data) ? list.data : [];
    return data.filter((p) => Array.isArray(p.taskStatusData) && Array.isArray(p.taskTypeCounts) && p.taskTypeCounts.length);
});

function close() {
    emit("close");
}

onMounted(() => {
    // Pre-select if there is exactly one eligible project.
    if (projectOptions.value.length === 1) {
        selectedProjectId.value = projectOptions.value[0]._id;
        onProjectChange();
    }
});

// Fetch the chosen project's sprints through the EXISTING store action
// (projectData/setSprints → GET /api/v1/project/sprintFolder/:id?collection=sprints).
function onProjectChange() {
    selectedSprintId.value = "";
    sprintOptions.value = [];
    if (!selectedProjectId.value) return;
    sprintLoading.value = true;
    dispatch("projectData/setSprints", { projectId: selectedProjectId.value })
        .then((sprints) => {
            const list = Array.isArray(sprints) ? sprints : [];
            sprintOptions.value = list
                .filter((s) => Number(s.deletedStatusKey || 0) === 0)
                .map((s) => ({
                    id: s._id || s.id,
                    name: s.name,
                    value: s.value,
                    folderId: s.folderId || null,
                    folderName: s.folderName || "",
                }));
            if (sprintOptions.value.length === 1) {
                selectedSprintId.value = sprintOptions.value[0].id;
            }
        })
        .catch((error) => console.error("ERROR in fetch sprints for convert: ", error))
        .finally(() => { sprintLoading.value = false; });
}

// Build the SAME payload shape CreateTask.vue builds (TaskName, TaskKey, status
// from default_active, first task type, sprintArray, etc.) and hand it to the
// existing taskClass.create(). No task-write logic is reimplemented here.
function convert() {
    const name = (taskName.value || "").trim();
    if (name.length < 3 || name.length > 250) {
        nameError.value = t("Notepad.name_length_error");
        return;
    }
    if (!selectedProjectId.value) {
        $toast.error(t("Notepad.select_project_required"), { position: "top-right" });
        return;
    }
    if (!selectedSprintId.value) {
        $toast.error(t("Notepad.select_sprint_required"), { position: "top-right" });
        return;
    }

    const project = projectOptions.value.find((p) => p._id === selectedProjectId.value);
    const sprint = sprintOptions.value.find((s) => s.id === selectedSprintId.value);
    if (!project || !sprint) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
        return;
    }

    const status = (project.taskStatusData || []).find((x) => x.type === "default_active");
    const taskType = (project.taskTypeCounts || [])[0];
    if (!status || !taskType) {
        $toast.error(t("Notepad.project_not_ready"), { position: "top-right" });
        return;
    }

    isBusy.value = true;
    checkTaskPerSprintPermisssion(sprint.id)
        .then((allowed) => {
            if (!allowed) {
                isBusy.value = false;
                $toast.error(t("Toast.create_task_plan_limit_message").replace("TASK_SPRINT", sprint.name), { position: "top-right" });
                return;
            }

            const user = getUser(userId.value);
            const userData = {
                id: user.id,
                Employee_Name: user.Employee_Name,
                companyOwnerId: companyOwner.value && companyOwner.value.userId,
            };

            const sprintObj = { id: sprint.id, name: sprint.name, value: sprint.value };
            if (sprint.folderId) {
                sprintObj.folderId = sprint.folderId;
                sprintObj.folderName = sprint.folderName;
            }

            const obj = {
                TaskName: name,
                TaskKey: "--",
                AssigneeUserId: [],
                watchers: [userId.value],
                DueDate: "",
                dueDateDeadLine: [],
                TaskType: taskType.value,
                TaskTypeKey: taskType.key,
                ParentTaskId: "",
                ProjectID: project._id,
                CompanyId: companyId.value,
                status: { text: status.name, key: status.key, value: status.value, type: status.type },
                isParentTask: true,
                Task_Leader: userId.value,
                sprintArray: sprintObj,
                Task_Priority: "MEDIUM",
                deletedStatusKey: 0,
                sprintId: sprint.id,
                statusType: status.type,
                statusKey: status.key,
            };
            if (sprint.folderId) {
                obj.folderObjId = sprint.folderId;
            }

            // Carry the note's body across as the task description. Editor.js is
            // the task description format (descriptionBlock), with rawDescription
            // as the plain-text mirror used by search and previews — same shape
            // the AI generator writes (Modules/AIProjectGenerator/orchestrator.js).
            const noteBody = props.note && typeof props.note.content === "string" ? props.note.content : "";
            const bodyLines = noteBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (bodyLines.length) {
                obj.descriptionBlock = {
                    time: Date.now(),
                    version: EDITORJS_VERSION,
                    blocks: bodyLines.map((text) => ({ type: "paragraph", data: { text } })),
                };
                obj.rawDescription = bodyLines.join("\n");
            }

            const projectData = {
                _id: project._id,
                CompanyId: project.CompanyId,
                lastTaskId: project.lastTaskId || 0,
                ProjectName: project.ProjectName,
                ProjectCode: project.ProjectCode || "",
            };
            const indexObj = { indexName: "groupByStatusIndex", searchKey: "statusKey", searchValue: 1 };

            taskClass.create({ data: obj, user: userData, projectData, indexObj })
                .then((res) => {
                    if (res.status) {
                        $toast.success(t("Toast.task_created_successfully"), { position: "top-right" });
                        emit("converted", { taskId: res.id, projectName: project.ProjectName });
                    } else if (res.isUpgrade) {
                        $toast.error(t("Toast.create_task_plan_limit_message").replace("TASK_SPRINT", sprint.name), { position: "top-right" });
                    } else {
                        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
                    }
                })
                .catch((error) => {
                    console.error("ERROR in convert note to task: ", error);
                    $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
                })
                .finally(() => { isBusy.value = false; });
        })
        .catch((error) => {
            console.error("ERROR in convert permission check: ", error);
            isBusy.value = false;
        });
}
</script>

<style scoped>
.convert__overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
}
.convert__dialog {
    background: #fff;
    width: min(440px, 92vw);
    border-radius: 10px;
    padding: 18px 20px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
    display: flex;
    flex-direction: column;
}
.convert__head { margin-bottom: 12px; }
.convert__close { color: #9a9a9a; }
.convert__close:hover { color: #e84a4a; }
.convert__label {
    font-size: 12px;
    font-weight: 600;
    color: #5b5b6b;
    margin: 10px 0 4px;
}
.convert__input {
    width: 100%;
    border: 1px solid #e0e0e6;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: #2b2b2b;
    outline: none;
    background: #fff;
}
.convert__input:focus { border-color: #5b5b6b; }
.convert__error {
    color: #e84a4a;
    font-size: 11px;
    margin-top: 4px;
}
.convert__actions { margin-top: 18px; gap: 10px; }
.convert__btn-ghost {
    background: #f0f0f3;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    color: #3a3a3a;
    cursor: pointer;
}
.convert__btn-primary {
    background: #1b1b38;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
}
.convert__btn-primary:disabled { opacity: 0.6; cursor: default; }
</style>
