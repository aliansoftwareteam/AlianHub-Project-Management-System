<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div
                ref="dialog"
                class="ah-card aw ask-build"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ask-build-title"
                tabindex="-1"
                data-test="build-dialog"
                @keydown.esc.stop.prevent="$emit('close')"
                @keydown.tab="keepFocus"
            >
                <div class="aw__head">
                    <span id="ask-build-title" class="ah-h3">{{ $t('Ask.build_tasks_title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ask.build_close')" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p class="ah-small ask-build__lead">{{ $t('Ask.build_tasks_lead') }}</p>

                    <div class="ask-build__where">
                        <label class="ah-field">
                            <span class="ah-label">{{ $t('Ask.build_project') }}</span>
                            <select ref="projectSelect" v-model="projectId" class="ah-input" data-test="build-project" @change="loadTarget">
                                <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
                            </select>
                        </label>
                        <label v-if="target && target.lists.length > 1" class="ah-field">
                            <span class="ah-label">{{ $t('Ask.build_list') }}</span>
                            <select v-model="listId" class="ah-input" data-test="build-list">
                                <option v-for="list in target.lists" :key="list.id" :value="list.id">{{ list.name }}</option>
                            </select>
                        </label>
                    </div>

                    <p v-if="loading" class="ah-small">{{ $t('Parity.loading') }}</p>
                    <p v-else-if="target && !target.canCreate" class="ah-field__error" data-test="build-not-allowed">{{ $t('Ask.build_not_allowed') }}</p>

                    <ul class="ask-build__rows">
                        <li v-for="(row, index) in rows" :key="row.key" class="ask-build__row" :class="{ 'is-off': !row.checked }" data-test="build-row">
                            <input
                                v-model="row.checked"
                                class="ah-check"
                                type="checkbox"
                                :aria-label="$t('Ask.build_include', { title: row.title || $t('Ask.build_untitled') })"
                            />
                            <div class="ask-build__fields">
                                <input
                                    v-model="row.title"
                                    class="ah-input"
                                    type="text"
                                    maxlength="250"
                                    :aria-label="$t('Ask.build_title_label', { n: index + 1 })"
                                    :disabled="!row.checked"
                                />
                                <div class="ask-build__meta">
                                    <input
                                        v-model="row.due"
                                        class="ah-input"
                                        type="date"
                                        :aria-label="$t('Ask.build_due_label', { n: index + 1 })"
                                        :disabled="!row.checked"
                                    />
                                    <select v-model="row.assigneeId" class="ah-input" :aria-label="$t('Ask.build_assignee_label', { n: index + 1 })" :disabled="!row.checked">
                                        <option value="">{{ $t('Ask.build_unassigned') }}</option>
                                        <option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option>
                                    </select>
                                </div>
                                <p v-if="row.error" class="ah-field__error" data-test="build-row-error">{{ row.error }}</p>
                            </div>
                        </li>
                    </ul>
                    <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
                </div>

                <div class="aw__foot">
                    <span class="ah-small">{{ $t('Ask.build_undo_note') }}</span>
                    <span class="ah-toolbar__spacer"></span>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="$emit('close')">{{ $t('Ask.build_cancel') }}</button>
                    <button
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        data-test="build-create"
                        :disabled="!canSubmit"
                        @click="create"
                    >
                        {{ busy ? $t('Ask.build_creating') : $t('Ask.build_create_n', { n: ticked.length }, ticked.length) }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { showUndoToast } from "@/composable/useUndoToast";
import { wrapTab } from "@/composable/useFocusTrap";
import { endOfDayIso, matchMember } from "./askComposer";

defineOptions({ name: "AskBuildTasks" });

const props = defineProps({
    items: { type: Array, required: true },
    projects: { type: Array, default: () => [] },
    projectId: { type: String, default: "" }
});
const emit = defineEmits(["close", "created"]);

const ERROR_CODES = ["title_invalid", "due_invalid", "assignee_not_allowed", "plan_limit", "refused", "not_permitted", "project_not_found", "project_closed", "no_list", "list_not_found", "too_many_items"];
const TOAST = { position: "top-right" };

const { t } = useI18n();
const $toast = useToast();
const dialog = ref(null);
const projectSelect = ref(null);
const projectId = ref(props.projectId && props.projects.some((p) => p.id === props.projectId) ? props.projectId : (props.projects[0] || {}).id || "");
const target = ref(null);
const listId = ref("");
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const rows = ref(props.items.map((item, index) => ({ key: `row-${index}`, checked: true, title: item.title, due: item.due || "", who: item.who || "", assigneeId: "", error: "" })));

const members = computed(() => (target.value ? target.value.members : []));
const ticked = computed(() => rows.value.filter((row) => row.checked && row.title.trim()));
const canSubmit = computed(() => Boolean(target.value && target.value.canCreate && ticked.value.length && !busy.value && !loading.value));

const errorText = (code) => t(`Ask.build_error_${ERROR_CODES.includes(code) ? code : "create_failed"}`);

const loadTarget = async () => {
    target.value = null;
    error.value = "";
    if (!projectId.value) return;
    loading.value = true;
    try {
        const res = await apiRequest("get", `${env.AI_ASK_BUILD}/${encodeURIComponent(projectId.value)}`);
        if (!res?.data?.status) {
            error.value = errorText(res?.data?.code);
            return;
        }
        target.value = res.data.data;
        listId.value = (target.value.lists[0] || {}).id || "";
        rows.value.forEach((row) => { row.assigneeId = matchMember(row.who, target.value.members); });
    } catch {
        error.value = errorText("");
    } finally {
        loading.value = false;
    }
};

const itemOf = (row) => ({
    title: row.title.trim(),
    ...(row.due ? { dueDate: endOfDayIso(row.due) } : {}),
    ...(row.assigneeId ? { assigneeId: row.assigneeId } : {})
});

const offerUndo = (created) => {
    const taskIds = created.map((task) => task.taskId);
    showUndoToast({
        message: t("Ask.build_tasks_created", { n: taskIds.length }, taskIds.length),
        undo: async () => {
            try {
                const res = await apiRequest("post", env.V2_TASKS_BULK, { action: "bulkTrash", taskIds });
                if (res?.data?.status === false) throw new Error(res.data.statusText);
                $toast.success(t("Ask.build_tasks_undone"), TOAST);
            } catch {
                $toast.error(t("Ask.build_undo_failed"), TOAST);
            }
        }
    });
};

const create = async () => {
    if (!canSubmit.value) return;
    const sent = ticked.value;
    busy.value = true;
    error.value = "";
    sent.forEach((row) => { row.error = ""; });
    try {
        const res = await apiRequest("post", env.AI_ASK_CREATE_TASKS, { projectId: projectId.value, sprintId: listId.value, items: sent.map(itemOf) });
        const data = res?.data?.data || {};
        const created = Array.isArray(data.created) ? data.created : [];
        const failed = Array.isArray(data.failed) ? data.failed : [];
        if (!created.length && !failed.length) {
            error.value = errorText(res?.data?.code);
            return;
        }
        failed.forEach((f) => { if (sent[f.index]) sent[f.index].error = errorText(f.code); });
        if (created.length) {
            offerUndo(created);
            emit("created", created);
        }
        const createdRows = new Set(created.map((c) => sent[c.index]).filter(Boolean));
        rows.value = rows.value.filter((row) => !createdRows.has(row));
        if (!failed.length) emit("close");
    } catch {
        error.value = errorText("");
    } finally {
        busy.value = false;
    }
};

const keepFocus = (event) => wrapTab(event, dialog.value);

onMounted(() => {
    if (projectSelect.value) projectSelect.value.focus();
    loadTarget();
});
</script>

<style>
.ask-build { width: 680px; }
.ask-build__lead { margin: 0; }
.ask-build__where { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-3); }
.ask-build__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
.ask-build__row { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-3); border: 1px solid var(--hairline); border-radius: var(--r-input); background: var(--surface); }
.ask-build__row.is-off { background: var(--surface-2); }
.ask-build__row .ah-check { margin-top: 9px; flex: none; }
.ask-build__fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-build__meta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-2); }
.ask-build .aw__foot { flex-wrap: wrap; }
@media (max-width: 480px) {
    .ask-build__meta { grid-template-columns: minmax(0, 1fr); }
}
</style>
