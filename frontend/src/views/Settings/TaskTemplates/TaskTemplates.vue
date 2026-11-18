<template>
    <section class="stt" :aria-labelledby="ids.heading">
        <h2 :id="ids.heading" class="stt__title">{{ $t('TaskTemplates.settings_title') }}</h2>
        <p class="stt__hint">{{ $t('TaskTemplates.settings_hint') }}</p>
        <p v-if="error" class="stt__error" role="alert">{{ error }}</p>
        <p v-if="loading" class="stt__hint" role="status">{{ $t('TaskTemplates.loading') }}</p>
        <EmptyState v-else-if="!templates.length" compact illustration="tasks" data-test="task-templates-empty" :title="$t('TaskTemplates.settings_empty')" />
        <ul v-else class="stt__list">
            <li v-for="template in templates" :key="template._id" class="stt__row" :data-template-row="template._id">
                <div class="stt__main">
                    <input
                        v-if="renamingId === template._id"
                        v-model="renameValue"
                        type="text"
                        class="stt__input"
                        maxlength="120"
                        data-rename
                        :aria-label="$t('TaskTemplates.rename_label', { name: template.name })"
                        @keydown.enter.prevent="saveRename(template)"
                        @keydown.esc.prevent="renamingId = ''"
                    />
                    <span v-else class="stt__name">{{ template.name }}</span>
                    <span class="stt__meta">
                        <span class="stt__badge">{{ template.scope === 'workspace' ? $t('TaskTemplates.scope_workspace_short') : (template.projectName || $t('TaskTemplates.scope_project_short')) }}</span>
                        <span>{{ $t('TaskTemplates.summary', { checklist: template.summary.checklist, subtasks: template.summary.subtasks }) }}</span>
                    </span>
                </div>
                <div v-if="template.canManage" class="stt__actions">
                    <template v-if="renamingId === template._id">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="saveRename(template)">{{ $t('TaskTemplates.save') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="renamingId = ''">{{ $t('TaskTemplates.cancel') }}</button>
                    </template>
                    <template v-else-if="deletingId === template._id">
                        <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" data-confirm-delete @click="removeTemplate(template)">{{ $t('TaskTemplates.delete_confirm') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="deletingId = ''">{{ $t('TaskTemplates.cancel') }}</button>
                    </template>
                    <template v-else>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :aria-label="$t('TaskTemplates.rename_label', { name: template.name })" @click="startRename(template)">{{ $t('TaskTemplates.rename') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :aria-label="$t('TaskTemplates.delete_label', { name: template.name })" @click="deletingId = template._id">{{ $t('TaskTemplates.delete') }}</button>
                    </template>
                </div>
            </li>
        </ul>
    </section>
</template>

<script setup>
import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import { deleteTemplate, errorText, listTemplates, renameTemplate } from "@/components/molecules/TaskTemplates/taskTemplates";

defineOptions({ name: "TaskTemplatesSettings" });

const { t } = useI18n();
const ids = { heading: `stt-${Math.random().toString(36).slice(2, 8)}-heading` };

const templates = ref([]);
const loading = ref(false);
const error = ref("");
const renamingId = ref("");
const renameValue = ref("");
const deletingId = ref("");

function load() {
    loading.value = true;
    listTemplates()
        .then((list) => { templates.value = list; })
        .catch((e) => { error.value = errorText(e, t("TaskTemplates.load_failed")); })
        .finally(() => { loading.value = false; });
}

onMounted(load);

function startRename(template) {
    renamingId.value = template._id;
    renameValue.value = template.name;
    nextTick(() => document.querySelector(`[data-template-row="${template._id}"] [data-rename]`)?.focus());
}

async function saveRename(template) {
    const next = renameValue.value.trim();
    if (!next || next === template.name) {
        renamingId.value = "";
        return;
    }
    try {
        await renameTemplate(template._id, next);
        template.name = next;
        renamingId.value = "";
        error.value = "";
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.rename_failed"));
    }
}

async function removeTemplate(template) {
    try {
        await deleteTemplate(template._id);
        templates.value = templates.value.filter((x) => x._id !== template._id);
        error.value = "";
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.delete_failed"));
    } finally {
        deletingId.value = "";
    }
}
</script>

<style scoped>
.stt { display: flex; flex-direction: column; gap: 10px; padding: 20px 16px; max-width: 760px; color: var(--ink); font-family: var(--font-ui); }
.stt__title { margin: 0; font: 600 18px/1.3 var(--font-ui); }
.stt__hint { margin: 0; color: var(--ink-2); font-size: 12.5px; }
.stt__error { margin: 0; color: var(--danger); font-size: 12.5px; }
.stt__list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.stt__row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid var(--hairline); }
.stt__row:last-child { border-bottom: 0; }
.stt__main { display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; min-width: 0; }
.stt__name { font: 500 13px/1.3 var(--font-ui); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stt__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--ink-2); font-size: 11.5px; }
.stt__badge { border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
.stt__actions { display: flex; gap: 6px; flex-wrap: wrap; }
.stt__input {
    box-sizing: border-box; width: 100%; border: 1px solid var(--border); border-radius: var(--r-input, 8px);
    padding: 6px 8px; background: var(--surface); color: var(--ink); font: 400 12.5px/1.3 var(--font-ui);
}
.stt__input:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
</style>
