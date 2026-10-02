<template>
    <section v-if="pick" ref="root" class="ais" data-test="ai-selection" :aria-label="$t('AiSelection.panel_label')" @keydown.esc.stop.prevent="close">
        <p class="ais__quote"><span class="ais__label">{{ $t('AiSelection.selected') }}</span>{{ excerpt }}</p>

        <template v-if="pick.kind === 'improve'">
            <div v-if="!mode || askingLanguage" class="ais__modes" role="group" :aria-label="$t('AiSelection.modes_label')">
                <button
                    v-for="item in MODES"
                    :key="item"
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm"
                    :data-mode="item"
                    :aria-pressed="mode === item ? 'true' : 'false'"
                    @click="choose(item)"
                >{{ $t(`AiSelection.mode_${item}`) }}</button>
                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="ai-selection-cancel" @click="close">{{ $t('AiSelection.cancel') }}</button>
            </div>
            <form v-if="askingLanguage" class="ais__language" data-test="ai-translate-form" @submit.prevent="translate">
                <label class="ais__label" :for="languageId">{{ $t('AiSelection.language_label') }}</label>
                <input :id="languageId" ref="languageInput" v-model="language" class="ah-input ais__language-input" data-test="ai-language" maxlength="40" :placeholder="$t('AiSelection.language_placeholder')" />
                <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm">{{ $t('AiSelection.translate_submit') }}</button>
            </form>
            <AiResultPreview
                v-if="mode && !askingLanguage"
                :title="$t('AiSelection.improved_title')"
                :text="result"
                :busy="busy"
                :show-replace="Boolean(result)"
                :show-insert="Boolean(result)"
                :insert-label="$t('AiSelection.insert_below')"
                @replace="replace"
                @insert="insertBelow"
                @retry="improve"
                @cancel="close"
            >
                <p v-if="result" class="aip__text ais__result">{{ result }}</p>
            </AiResultPreview>
        </template>

        <AiResultPreview
            v-else
            :title="$t('AiSelection.tasks_title')"
            :text="checkedTitles.join('\n')"
            :busy="busy"
            :show-replace="titles.length > 0"
            :replace-label="$t('AiSelection.create_tasks', { n: checkedTitles.length })"
            @replace="createTasks"
            @retry="split"
            @cancel="close"
        >
            <template v-if="titles.length">
                <p class="ais__hint">{{ $t('AiSelection.tasks_hint') }}</p>
                <div v-if="lists.length > 1" class="ais__list">
                    <label class="ais__label" :for="listSelectId">{{ $t('AiSelection.list_label') }}</label>
                    <select :id="listSelectId" v-model="listId" class="ah-input ais__select" data-test="ai-task-list">
                        <option v-for="list in lists" :key="list.id" :value="list.id">{{ listLabel(list) }}</option>
                    </select>
                </div>
                <ul class="ais__titles">
                    <li v-for="(row, index) in titles" :key="index" data-test="ai-task-title">
                        <label class="ais__title"><input v-model="row.on" type="checkbox" /><span>{{ row.text }}</span></label>
                    </li>
                </ul>
            </template>
        </AiResultPreview>

        <p v-if="error" class="ais__error" role="alert">{{ error }}</p>
    </section>
</template>

<script setup>
import { computed, inject, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import AiResultPreview from "@/components/molecules/AiPreview/AiResultPreview.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { showUndoToast } from "@/composable/useUndoToast";
import { useGetterFunctions } from "@/composable";
import { sprintObjOf, userDataOf } from "@/utils/aiTargets";
import { listLabel } from "@/utils/folderTree";

defineOptions({ name: "AiSelectionPanel" });

const MODES = ["rewrite", "shorten", "expand", "grammar", "translate"];
const EXCERPT = 160;

const props = defineProps({
    editor: { type: Function, required: true },
    target: { type: Object, default: null }
});
const emit = defineEmits(["changed"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const companyId = inject("$companyId");
const userId = inject("$userId");

const uid = Math.random().toString(36).slice(2, 8);
const languageId = `ais-language-${uid}`;
const listSelectId = `ais-list-${uid}`;
const root = ref(null);
const languageInput = ref(null);
const pick = ref(null);
const mode = ref("");
const askingLanguage = ref(false);
const language = ref("");
const result = ref("");
const titles = ref([]);
const listId = ref("");
const busy = ref(false);
const error = ref("");

const idOf = (value) => (value && typeof value === "object" && "value" in value ? value.value : value);
const lists = computed(() => (props.target && Array.isArray(props.target.lists) ? props.target.lists : []));
const checkedTitles = computed(() => titles.value.filter((row) => row.on).map((row) => row.text));
const excerpt = computed(() => {
    const text = pick.value ? pick.value.text : "";
    return text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text;
});

function reset() {
    mode.value = "";
    askingLanguage.value = false;
    result.value = "";
    titles.value = [];
    busy.value = false;
    error.value = "";
}

function close() {
    pick.value = null;
    reset();
}

function reveal() {
    nextTick(() => {
        const node = root.value;
        if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest" });
        const first = node && node.querySelector("[data-mode]");
        if (first) first.focus();
    });
}

function open(next) {
    if (!next || !String(next.text || "").trim()) return;
    reset();
    pick.value = next;
    listId.value = (props.target && props.target.listId) || (lists.value[0] && lists.value[0].id) || "";
    reveal();
    if (next.kind === "tasks") split();
}

async function post(url, body, onData) {
    busy.value = true;
    error.value = "";
    try {
        const response = await apiRequest("post", url, body);
        const payload = response?.data || {};
        if (payload.status === true) onData(payload.data || {});
        else error.value = payload.statusText || t("AiSelection.failed");
    } catch (err) {
        error.value = err?.response?.data?.statusText || t("AiSelection.failed");
    } finally {
        busy.value = false;
    }
}

function improve() {
    result.value = "";
    const body = { mode: mode.value, text: pick.value.text };
    if (mode.value === "translate") body.language = language.value.trim();
    return post(env.AI_SELECTION_IMPROVE, body, (data) => { result.value = data.text || ""; });
}

function choose(next) {
    mode.value = next;
    if (next === "translate") {
        askingLanguage.value = true;
        nextTick(() => languageInput.value && languageInput.value.focus());
        return;
    }
    askingLanguage.value = false;
    improve();
}

function translate() {
    if (!language.value.trim()) return;
    askingLanguage.value = false;
    improve();
}

function split() {
    titles.value = [];
    return post(env.AI_SELECTION_TASKS, { text: pick.value.text }, (data) => {
        titles.value = (data.titles || []).map((text) => ({ text, on: true }));
    });
}

const rangeAlive = (range) => Boolean(range && range.startContainer && range.startContainer.isConnected && range.endContainer.isConnected);

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Editor.js keeps no undo history of its own, so the whole document is kept to put back. */
async function applied(message, editor, snapshot) {
    close();
    emit("changed");
    if (!editor || !snapshot) return;
    showUndoToast({
        message,
        undo: async () => {
            await editor.render(snapshot);
            emit("changed");
        }
    });
}

async function replace() {
    const { range } = pick.value;
    if (!rangeAlive(range)) {
        error.value = t("AiSelection.selection_gone");
        return;
    }
    const editor = props.editor();
    const snapshot = editor ? await editor.save() : null;
    range.deleteContents();
    range.insertNode(document.createTextNode(result.value));
    const selection = window.getSelection && window.getSelection();
    if (selection) selection.removeAllRanges();
    await applied(t("AiSelection.replaced"), editor, snapshot);
}

async function insertBelow() {
    const editor = props.editor();
    if (!editor) return;
    const snapshot = await editor.save();
    const index = Number.isInteger(pick.value.blockIndex) ? pick.value.blockIndex + 1 : undefined;
    editor.blocks.insert("paragraph", { text: escapeHtml(result.value).replace(/\n/g, "<br>") }, undefined, index, true);
    await applied(t("AiSelection.inserted"), editor, snapshot);
}

async function createTasks() {
    const chosen = checkedTitles.value;
    if (!chosen.length) {
        $toast.error(t("AiSelection.none_selected"), { position: "top-right" });
        return;
    }
    const list = lists.value.find((item) => item.id === listId.value) || lists.value[0];
    if (!props.target || !list) return;
    close();
    try {
        // Loaded on use: the task write path pulls in the whole store, which editors should not carry.
        const { createTasksFromTitles } = await import("@/utils/aiApply");
        const { created, undo } = await createTasksFromTitles({
            titles: chosen,
            type: "task",
            parentTask: { ProjectID: props.target.projectData._id },
            sprintObj: sprintObjOf(list),
            project: props.target.projectData,
            companyId: idOf(companyId),
            userId: idOf(userId),
            userData: userDataOf(getUser(idOf(userId)), getters["settings/companyOwnerDetail"]?.userId)
        });
        showUndoToast({ message: t("AiSelection.tasks_created", { n: created.length || chosen.length }), undo });
    } catch (err) {
        console.error("ERROR in creating tasks from a selection: ", err);
        $toast.error(t("AiSelection.failed"), { position: "top-right" });
    }
}

defineExpose({ open, close });
</script>

<style scoped>
.ais {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--ink);
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
}
.ais__quote {
    margin: 0;
    padding-left: 8px;
    border-left: 2px solid var(--brand);
    font: 400 12.5px/1.45 var(--font-ui);
    color: var(--ink-2);
    overflow-wrap: anywhere;
}
.ais__label { display: block; font: 600 11.5px/1.3 var(--font-ui); color: var(--ink-2); margin-bottom: 2px; }
.ais__modes { display: flex; flex-wrap: wrap; gap: 6px; }
.ais__modes .ah-btn { min-height: 32px; }
.ais__modes .ah-btn[aria-pressed="true"] { border-color: var(--brand); color: var(--brand); }
.ais__language { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-end; }
.ais__language .ais__label { flex: 1 1 100%; margin: 0; }
.ais__language-input { flex: 1 1 160px; min-width: 0; height: 32px; }
.ais__result { white-space: pre-wrap; }
.ais__hint { margin: 0 0 6px; font: 400 12px/1.4 var(--font-ui); color: var(--ink-2); }
.ais__list { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.ais__select { height: 32px; max-width: 100%; }
.ais__titles { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.ais__title { display: flex; gap: 8px; align-items: flex-start; font: 400 13px/1.45 var(--font-ui); color: var(--ink); cursor: pointer; }
.ais__title input { margin-top: 3px; flex: none; accent-color: var(--brand); }
.ais__error { margin: 0; font: 400 12.5px/1.4 var(--font-ui); color: var(--danger-ink); }
@media (max-width: 480px) {
    .ais__modes .ah-btn { flex: 1 1 auto; }
}
</style>
