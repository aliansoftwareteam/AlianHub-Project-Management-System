<template>
    <div v-if="open" class="ttd-layer">
        <div class="ttd-backdrop" aria-hidden="true" @click="close"></div>
        <div
            ref="dialogEl"
            class="ttd"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="ids.heading"
            tabindex="-1"
            @keydown="onKey"
        >
            <h2 :id="ids.heading" class="ttd__heading">{{ mode === 'save' ? $t('TaskTemplates.save_title') : $t('TaskTemplates.apply_title') }}</h2>

            <template v-if="mode === 'save'">
                <label class="ttd__field">
                    <span class="ttd__label">{{ $t('TaskTemplates.name') }}</span>
                    <input ref="firstEl" v-model="name" type="text" class="ttd__input" data-field="template-name" maxlength="120" autocomplete="off" />
                </label>
                <fieldset class="ttd__group">
                    <legend class="ttd__label">{{ $t('TaskTemplates.scope') }}</legend>
                    <label class="ttd__check">
                        <input v-model="scope" type="radio" value="project" data-scope="project" />
                        <span>{{ $t('TaskTemplates.scope_project', { project: project?.ProjectName || '' }) }}</span>
                    </label>
                    <label class="ttd__check" :class="{ 'is-disabled': !isAdmin }">
                        <input v-model="scope" type="radio" value="workspace" data-scope="workspace" :disabled="!isAdmin" :aria-describedby="isAdmin ? undefined : ids.scopeHint" />
                        <span>{{ $t('TaskTemplates.scope_workspace') }}</span>
                    </label>
                    <p v-if="!isAdmin" :id="ids.scopeHint" class="ttd__hint">{{ $t('TaskTemplates.scope_workspace_admin') }}</p>
                </fieldset>
                <label class="ttd__field">
                    <span class="ttd__label">{{ $t('TaskTemplates.title_pattern') }}</span>
                    <input v-model="titlePattern" type="text" class="ttd__input" data-field="template-title" maxlength="250" autocomplete="off" :aria-describedby="ids.titleHint" />
                    <span :id="ids.titleHint" class="ttd__hint">{{ patternHint }}</span>
                </label>
                <fieldset class="ttd__group ttd__group--grid">
                    <legend class="ttd__label">{{ $t('TaskTemplates.include') }}</legend>
                    <label v-for="part in INCLUDE_PARTS" :key="part" class="ttd__check">
                        <input v-model="include[part]" type="checkbox" :data-include="part" />
                        <span>{{ $t(`TaskTemplates.part_${part}`) }}</span>
                    </label>
                </fieldset>
                <p class="ttd__hint">{{ $t('TaskTemplates.dates_hint') }}</p>
            </template>

            <template v-else>
                <p v-if="loading" class="ttd__hint" role="status">{{ $t('TaskTemplates.loading') }}</p>
                <p v-else-if="!templates.length" class="ttd__hint">{{ $t('TaskTemplates.none') }}</p>
                <fieldset v-else class="ttd__group">
                    <legend class="ttd__label">{{ $t('TaskTemplates.choose') }}</legend>
                    <div v-for="template in templates" :key="template._id" class="ttd__option">
                        <template v-if="renamingId === template._id">
                            <input
                                v-model="renameValue"
                                type="text"
                                class="ttd__input"
                                maxlength="120"
                                data-rename
                                :aria-label="$t('TaskTemplates.rename_label', { name: template.name })"
                                @keydown.enter.prevent.stop="saveRename(template)"
                                @keydown.esc.prevent.stop="renamingId = ''"
                            />
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="saveRename(template)">{{ $t('TaskTemplates.save') }}</button>
                        </template>
                        <template v-else>
                            <label class="ttd__check ttd__check--grow">
                                <input v-model="selectedId" type="radio" :name="ids.radio" :value="template._id" :data-template="template._id" />
                                <span class="ttd__option-name">{{ template.name }}</span>
                                <span class="ttd__badge">{{ template.scope === 'workspace' ? $t('TaskTemplates.scope_workspace_short') : $t('TaskTemplates.scope_project_short') }}</span>
                            </label>
                            <template v-if="template.canManage">
                                <button v-if="deletingId !== template._id" type="button" class="ttd__link" :aria-label="$t('TaskTemplates.rename_label', { name: template.name })" @click="startRename(template)">{{ $t('TaskTemplates.rename') }}</button>
                                <button v-if="deletingId !== template._id" type="button" class="ttd__link ttd__link--danger" :aria-label="$t('TaskTemplates.delete_label', { name: template.name })" @click="deletingId = template._id">{{ $t('TaskTemplates.delete') }}</button>
                                <button v-else type="button" class="ttd__link ttd__link--danger" data-confirm-delete @click="removeTemplate(template)">{{ $t('TaskTemplates.delete_confirm') }}</button>
                            </template>
                        </template>
                    </div>
                </fieldset>

                <p v-if="previewing" class="ttd__hint" role="status">{{ $t('TaskTemplates.checking') }}</p>
                <fieldset v-else-if="conflicts.length" class="ttd__group">
                    <legend class="ttd__label">{{ $t('TaskTemplates.conflicts') }}</legend>
                    <label v-for="conflict in conflicts" :key="conflict.field" class="ttd__check">
                        <input v-model="overwrite" type="checkbox" :value="conflict.field" :data-overwrite="conflict.field" />
                        <span>{{ conflictLabel(conflict) }}</span>
                    </label>
                </fieldset>
                <p v-else-if="selectedId && !previewing" class="ttd__hint">{{ $t('TaskTemplates.no_conflicts') }}</p>
            </template>

            <p v-if="error" class="ttd__error" role="alert">{{ error }}</p>

            <div class="ttd__foot">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="close">{{ $t('TaskTemplates.cancel') }}</button>
                <button v-if="mode === 'save'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-action="save" :disabled="busy" @click="save">
                    {{ busy ? $t('TaskTemplates.saving') : $t('TaskTemplates.save') }}
                </button>
                <button v-else type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-action="apply" :disabled="busy || !selectedId" @click="apply">
                    {{ busy ? $t('TaskTemplates.applying') : $t('TaskTemplates.apply') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { useFocusTrap } from "@/composable/useFocusTrap";
import {
    INCLUDE_PARTS,
    applyContext,
    applyTemplate,
    deleteTemplate,
    errorText,
    listTemplates,
    renameTemplate,
    saveTemplate
} from "./taskTemplates";

defineOptions({ name: "TaskTemplateDialog" });

const props = defineProps({
    open: { type: Boolean, default: false },
    mode: { type: String, default: "apply" },
    task: { type: Object, default: null },
    project: { type: Object, default: null }
});
const emit = defineEmits(["close", "saved", "applied"]);

const { t } = useI18n();
const { getters } = useStore();
const $toast = useToast();

const uid = `ttd-${Math.random().toString(36).slice(2, 8)}`;
const ids = { heading: `${uid}-heading`, titleHint: `${uid}-title-hint`, scopeHint: `${uid}-scope-hint`, radio: `${uid}-template` };

const dialogEl = ref(null);
const firstEl = ref(null);
const busy = ref(false);
const error = ref("");

const patternHint = computed(() => t("TaskTemplates.title_pattern_hint", { title: "{title}", date: "{date}" }));
const isAdmin = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));

const name = ref("");
const scope = ref("project");
const titlePattern = ref("");
const include = reactive(Object.fromEntries(INCLUDE_PARTS.map((part) => [part, true])));

const templates = ref([]);
const loading = ref(false);
const selectedId = ref("");
const conflicts = ref([]);
const overwrite = ref([]);
const previewing = ref(false);
const renamingId = ref("");
const renameValue = ref("");
const deletingId = ref("");

useFocusTrap(dialogEl, computed(() => props.open));

const taskId = computed(() => String(props.task?._id || ""));
const projectId = computed(() => String(props.task?.ProjectID || props.project?._id || ""));

function reset() {
    error.value = "";
    busy.value = false;
    name.value = props.task?.TaskName || "";
    titlePattern.value = props.task?.TaskName || "";
    scope.value = "project";
    INCLUDE_PARTS.forEach((part) => { include[part] = true; });
    selectedId.value = "";
    conflicts.value = [];
    overwrite.value = [];
    renamingId.value = "";
    deletingId.value = "";
}

function loadTemplates() {
    loading.value = true;
    return listTemplates(projectId.value)
        .then((list) => { templates.value = list; })
        .catch((e) => { error.value = errorText(e, t("TaskTemplates.load_failed")); })
        .finally(() => { loading.value = false; });
}

watch(() => props.open, (on) => {
    if (!on) return;
    reset();
    if (props.mode === "apply") loadTemplates();
    nextTick(() => (firstEl.value || dialogEl.value)?.focus());
}, { immediate: true });

let previewSeq = 0;
watch(selectedId, (id) => {
    conflicts.value = [];
    overwrite.value = [];
    if (!id || !taskId.value) return;
    const seq = ++previewSeq;
    previewing.value = true;
    applyTemplate(id, { taskId: taskId.value, preview: true, ...applyContext() })
        .then((res) => {
            if (seq === previewSeq) conflicts.value = res?.data?.conflicts || [];
        })
        .catch((e) => { if (seq === previewSeq) error.value = errorText(e, t("TaskTemplates.apply_failed")); })
        .finally(() => { if (seq === previewSeq) previewing.value = false; });
});

function conflictLabel(conflict) {
    const field = t(`TaskTemplates.field_${conflict.field}`);
    if (conflict.field === "customFields") return t("TaskTemplates.replace_custom_fields", { n: conflict.current });
    const shown = (value) => {
        if (value === null || value === undefined || value === "") return t("TaskTemplates.empty");
        const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
        return date ? date.toLocaleDateString() : String(value);
    };
    return t("TaskTemplates.replace_field", { field, from: shown(conflict.current), to: shown(conflict.template) });
}

function close() {
    emit("close");
}

async function save() {
    if (busy.value) return;
    if (!name.value.trim()) {
        error.value = t("TaskTemplates.name_required");
        firstEl.value?.focus();
        return;
    }
    busy.value = true;
    error.value = "";
    try {
        const res = await saveTemplate({
            taskId: taskId.value,
            name: name.value.trim(),
            scope: scope.value,
            titlePattern: titlePattern.value,
            include: { ...include },
            tzOffsetMinutes: new Date().getTimezoneOffset()
        });
        if (!res.status) {
            error.value = res.statusText || t("TaskTemplates.save_failed");
            return;
        }
        $toast.success(t("TaskTemplates.saved", { name: name.value.trim() }), { position: "top-right" });
        emit("saved", res.data);
        close();
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.save_failed"));
    } finally {
        busy.value = false;
    }
}

async function apply() {
    if (busy.value || !selectedId.value) return;
    busy.value = true;
    error.value = "";
    try {
        const res = await applyTemplate(selectedId.value, { taskId: taskId.value, overwrite: [...overwrite.value], ...applyContext() });
        if (!res.status) {
            error.value = res.statusText || t("TaskTemplates.apply_failed");
            return;
        }
        const skipped = res.data?.skipped || [];
        if (skipped.length) {
            $toast.warning(t("TaskTemplates.applied_skipped", { fields: skipped.map((field) => t(`TaskTemplates.field_${field}`)).join(", ") }), { position: "top-right" });
        } else {
            $toast.success(t("TaskTemplates.applied"), { position: "top-right" });
        }
        emit("applied", res.data);
        close();
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.apply_failed"));
    } finally {
        busy.value = false;
    }
}

function startRename(template) {
    renamingId.value = template._id;
    renameValue.value = template.name;
    nextTick(() => dialogEl.value?.querySelector("[data-rename]")?.focus());
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
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.rename_failed"));
    }
}

async function removeTemplate(template) {
    try {
        await deleteTemplate(template._id);
        templates.value = templates.value.filter((x) => x._id !== template._id);
        if (selectedId.value === template._id) selectedId.value = "";
    } catch (e) {
        error.value = errorText(e, t("TaskTemplates.delete_failed"));
    } finally {
        deletingId.value = "";
    }
}

function onKey(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
}
</script>

<style scoped>
.ttd-layer { position: fixed; inset: 0; z-index: 1000; }
.ttd-backdrop { position: absolute; inset: 0; background: var(--scrim); }
.ttd {
    position: absolute; top: 10vh; left: 50%; transform: translateX(-50%);
    box-sizing: border-box; width: 520px; max-width: calc(100vw - 32px); max-height: 80dvh; overflow: auto;
    display: flex; flex-direction: column; gap: 12px; padding: 16px;
    border-radius: var(--r-modal, 16px); background: var(--surface); color: var(--ink);
    box-shadow: var(--shadow-modal); font-family: var(--font-ui); font-size: 12.5px;
}
.ttd:focus { outline: none; }
.ttd__heading { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.ttd__field { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.ttd__label { font: 500 11px/1.2 var(--font-ui); color: var(--ink-label); padding: 0; }
.ttd__input {
    box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--r-input, 8px);
    padding: 7px 8px; background: var(--surface); color: var(--ink); font: 400 12.5px/1.3 var(--font-ui);
}
.ttd__input:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ttd__group { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
.ttd__group--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 12px; }
.ttd__group--grid > legend { grid-column: 1 / -1; margin-bottom: 2px; }
.ttd__check { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--ink); cursor: pointer; min-width: 0; }
.ttd__check input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ttd__check.is-disabled { color: var(--ink-2); cursor: not-allowed; }
.ttd__check--grow { flex: 1 1 auto; }
.ttd__option { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--hairline); }
.ttd__option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ttd__badge { font: 500 10.5px/1 var(--font-ui); color: var(--ink-2); border: 1px solid var(--border); border-radius: 999px; padding: 3px 6px; white-space: nowrap; }
.ttd__link { border: 0; background: transparent; color: var(--brand); font: 500 12px/1 var(--font-ui); padding: 4px; cursor: pointer; }
.ttd__link--danger { color: var(--danger); }
.ttd__link:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.ttd__hint { margin: 0; color: var(--ink-2); font-size: 11.5px; }
.ttd__error { margin: 0; color: var(--danger); font-size: 12px; }
.ttd__foot { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--hairline); padding-top: 12px; }
@media (max-width: 767px) {
    .ttd { top: 6dvh; }
}
</style>
