<template>
    <div v-if="shown" class="task-ai" data-test="task-ai-row">
        <div class="task-ai__row" role="group" :aria-label="$t('TaskAi.row_label')">
            <span class="task-ai__mark" aria-hidden="true">✦</span>
            <button type="button" class="task-ai__btn" data-action="ask" :aria-expanded="askOpen ? 'true' : 'false'" @click="askOpen = !askOpen">{{ $t('TaskAi.ask') }}</button>
            <button type="button" class="task-ai__btn" data-action="steps" :disabled="busy === 'steps'" @click="loadSteps">{{ $t('TaskAi.next_steps') }}</button>
            <button v-if="capabilities.research" type="button" class="task-ai__btn" data-action="research" :disabled="busy === 'research'" @click="loadResearch">{{ $t('TaskAi.research') }}</button>
        </div>

        <TaskAskPanel v-if="askOpen" :taskId="task._id" @close="askOpen = false" />

        <p v-if="error" class="task-ai__error" role="alert">{{ error }}</p>

        <AiResultPreview
            v-if="preview === 'steps'"
            :title="$t('TaskAi.steps_title')"
            :text="stepsText"
            :busy="busy === 'steps'"
            :show-replace="canChecklist && steps.length > 0"
            :show-insert="canSubtasks && steps.length > 0"
            :show-copy="steps.length > 0"
            :replace-label="$t('TaskAi.add_checklist')"
            :insert-label="$t('TaskAi.add_subtasks')"
            @replace="applyChecklist"
            @insert="applySubtasks"
            @retry="loadSteps"
            @cancel="closePreview"
        >
            <template v-if="steps.length">
                <p class="task-ai__hint">{{ $t('TaskAi.steps_hint') }}</p>
                <ul class="task-ai__steps">
                    <li v-for="(step, index) in steps" :key="index" data-test="ai-step">
                        <label class="task-ai__step"><input v-model="step.on" type="checkbox" /><span>{{ step.text }}</span></label>
                    </li>
                </ul>
            </template>
        </AiResultPreview>

        <AiResultPreview
            v-if="preview === 'research'"
            :title="$t('TaskAi.research_title')"
            :text="researchText"
            :busy="busy === 'research'"
            :show-replace="canComment && Boolean(research.summary)"
            :show-copy="Boolean(research.summary)"
            :replace-label="$t('TaskAi.add_comment')"
            @replace="applyComment"
            @retry="loadResearch"
            @cancel="closePreview"
        >
            <template v-if="research.summary">
                <p class="task-ai__summary">{{ research.summary }}</p>
                <p class="task-ai__hint">{{ $t('TaskAi.research_sources') }}</p>
                <ol class="task-ai__sources">
                    <li v-for="source in research.sources" :key="source.n">
                        <a data-test="research-source" :href="source.url" target="_blank" rel="noopener noreferrer nofollow">[{{ source.n }}] {{ source.title }}</a>
                    </li>
                </ol>
            </template>
        </AiResultPreview>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import AiResultPreview from "@/components/molecules/AiPreview/AiResultPreview.vue";
import TaskAskPanel from "./TaskAskPanel.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { canUseAi } from "@/composable/aiAvailability";
import { showUndoToast } from "@/composable/useUndoToast";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { addStepsAsChecklist, createTasksFromTitles, postTaskComment } from "@/utils/aiApply";
import { sprintObjOf, userDataOf } from "@/utils/aiTargets";
import { loadTaskAiCapabilities, taskAiCapabilities } from "./taskAiCapabilities";
import { aiErrorKey, payloadOf } from "./aiErrors";

defineOptions({ name: "TaskAiRow" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, required: true },
    canComment: { type: Boolean, default: false }
});

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { checkPermission } = useCustomComposable();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");
const userId = inject("$userId");

const capabilities = taskAiCapabilities;
const askOpen = ref(false);
const preview = ref("");
const busy = ref("");
const error = ref("");
const steps = ref([]);
const research = ref({ summary: "", sources: [] });

const shown = computed(() => canUseAi({ project: props.project }));
const canChecklist = computed(() => checkPermission("task.task_checklist", props.project?.isGlobalPermission) === true);
const canSubtasks = computed(() => checkPermission("task.sub_task_create", props.project?.isGlobalPermission) === true);
const chosenSteps = computed(() => steps.value.filter((step) => step.on).map((step) => step.text));
const stepsText = computed(() => chosenSteps.value.map((step) => `- ${step}`).join("\n"));
const researchText = computed(() => [research.value.summary, ...research.value.sources.map((s) => `[${s.n}] ${s.title} ${s.url}`)].filter(Boolean).join("\n"));

const idOf = (value) => (value && typeof value === "object" && "value" in value ? value.value : value);
const userData = () => userDataOf(getUser(idOf(userId)), getters["settings/companyOwnerDetail"]?.userId);

function closePreview() {
    preview.value = "";
    busy.value = "";
}

async function fetchAssist(kind, url, onData) {
    preview.value = kind;
    busy.value = kind;
    error.value = "";
    try {
        const response = await apiRequest("post", url, { taskId: props.task._id });
        const payload = response?.data || {};
        if (payload.status === true) onData(payload.data || {});
        else {
            error.value = t(aiErrorKey(payload));
            preview.value = "";
        }
    } catch (err) {
        error.value = t(aiErrorKey(payloadOf(err)));
        preview.value = "";
    } finally {
        if (busy.value === kind) busy.value = "";
    }
}

function loadSteps() {
    steps.value = [];
    return fetchAssist("steps", env.AI_TASK_NEXT_STEPS, (data) => {
        steps.value = (data.steps || []).map((text) => ({ text, on: true }));
    });
}

function loadResearch() {
    research.value = { summary: "", sources: [] };
    return fetchAssist("research", env.AI_TASK_RESEARCH, (data) => {
        research.value = { summary: data.summary || "", sources: data.sources || [] };
    });
}

function pickedSteps() {
    const picked = chosenSteps.value;
    if (!picked.length) $toast.error(t("TaskAi.none_selected"), { position: "top-right" });
    return picked;
}

async function applyChecklist() {
    const picked = pickedSteps();
    if (!picked.length) return;
    closePreview();
    try {
        const undo = await addStepsAsChecklist({
            taskOf: () => props.task,
            steps: picked,
            heading: t("TaskAi.checklist_name"),
            companyId: idOf(companyId),
            userData: userData(),
            projectName: props.project?.ProjectName || ""
        });
        showUndoToast({ message: t("TaskAi.checklist_added", { n: picked.length }), undo });
    } catch (err) {
        console.error("ERROR in adding next steps as a checklist: ", err);
        $toast.error(t("TaskAi.failed"), { position: "top-right" });
    }
}

async function applySubtasks() {
    const picked = pickedSteps();
    if (!picked.length) return;
    closePreview();
    try {
        const { created, undo } = await createTasksFromTitles({
            titles: picked,
            type: "subTask",
            parentTask: { id: props.task._id, ProjectID: props.task.ProjectID },
            sprintObj: sprintObjOf(props.task.sprintArray),
            project: props.project,
            companyId: idOf(companyId),
            userId: idOf(userId),
            userData: userData()
        });
        showUndoToast({ message: t("TaskAi.subtasks_added", { n: created.length || picked.length }), undo });
    } catch (err) {
        console.error("ERROR in adding next steps as subtasks: ", err);
        $toast.error(t("TaskAi.failed"), { position: "top-right" });
    }
}

async function applyComment() {
    const text = researchText.value;
    closePreview();
    try {
        await postTaskComment(props.task, text);
        $toast.success(t("TaskAi.comment_added"), { position: "top-right" });
    } catch (err) {
        console.error("ERROR in adding research as a comment: ", err);
        $toast.error(t("TaskAi.failed"), { position: "top-right" });
    }
}

watch(() => props.task?._id, () => {
    askOpen.value = false;
    error.value = "";
    closePreview();
});

onMounted(() => {
    if (shown.value) loadTaskAiCapabilities();
});
</script>

<style scoped>
.task-ai { display: flex; flex-direction: column; gap: 8px; margin: 2px 0 10px; min-width: 0; }
.task-ai__row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; }
.task-ai__mark { color: var(--brand); font-size: 11px; margin-right: 2px; }
.task-ai__btn {
    border: 0;
    background: transparent;
    padding: 4px 6px;
    min-height: 28px;
    border-radius: 6px;
    font: 500 12.5px/1.2 var(--font-ui);
    color: var(--ink-2);
    cursor: pointer;
}
.task-ai__btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
.task-ai__btn:focus-visible { outline: none; box-shadow: var(--focus, 0 0 0 3px var(--brand-ring)); }
.task-ai__btn:disabled { opacity: .6; cursor: default; }
.task-ai__btn[aria-expanded="true"] { color: var(--brand); }
.task-ai__error { margin: 0; font: 400 12.5px/1.4 var(--font-ui); color: var(--danger-ink); }
.task-ai__hint { margin: 0 0 6px; font: 400 12px/1.4 var(--font-ui); color: var(--ink-2); }
.task-ai__steps, .task-ai__sources { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.task-ai__step { display: flex; gap: 8px; align-items: flex-start; font: 400 13px/1.45 var(--font-ui); color: var(--ink); cursor: pointer; }
.task-ai__step input { margin-top: 3px; flex: none; accent-color: var(--brand); }
.task-ai__summary { margin: 0 0 8px; font: 400 13px/1.55 var(--font-ui); color: var(--ink); white-space: pre-wrap; }
.task-ai__sources a { font: 400 12.5px/1.4 var(--font-ui); color: var(--brand); overflow-wrap: anywhere; }
@media (max-width: 480px) {
    .task-ai__btn { min-height: 32px; }
}
</style>
