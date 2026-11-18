<template>
    <span ref="root" class="ftf" :class="{ 'ftf--compact': compact }">
        <button
            v-if="compact && (files.length || editable)"
            ref="chip"
            type="button"
            class="ftf__chip"
            data-files-chip
            data-cell-edit
            aria-haspopup="dialog"
            :aria-expanded="open ? 'true' : 'false'"
            :aria-label="chipLabel"
            :title="names || null"
            @click.stop="toggle"
        >
            <ShellIcon :name="files.length ? 'paperclip' : 'plus'" :size="12" />
            <span v-if="files.length">{{ files.length }}</span>
        </button>
        <div
            v-if="!compact || open"
            class="ftf__list"
            :class="{ 'ftf__list--pop': compact, 'is-over': over }"
            :style="compact ? popStyle : null"
            :role="compact ? 'dialog' : null"
            :aria-label="compact ? label : null"
            data-files-list
            :data-files-drop="editable ? '' : null"
            @keydown.esc.stop="close({ focus: true })"
            @click.stop
            @dragover.prevent="over = editable"
            @dragleave="over = false"
            @drop.prevent="onDrop"
        >
            <div v-for="file in files" :key="file.key" class="ftf__row" data-file>
                <img v-if="thumbs[file.key]" class="ftf__thumb" :src="thumbs[file.key]" alt="" />
                <ShellIcon v-else name="file" :size="16" class="ftf__icon" />
                <button type="button" class="ftf__name" data-file-open :title="$t('FieldTypes.files_open', { name: file.name })" @click="openFile(file)">{{ file.name }}</button>
                <span class="ftf__size">{{ sizeText(file.size) }}</span>
                <template v-if="editable">
                    <span v-if="confirming === file.key" class="ftf__confirm">
                        <span>{{ $t('FieldTypes.files_remove_confirm') }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-file-remove-cancel @click="confirming = ''">{{ $t('FieldTypes.files_remove_no') }}</button>
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-file-remove-confirm :disabled="busy" @click="removeFile(file)">{{ $t('FieldTypes.files_remove_yes') }}</button>
                    </span>
                    <button
                        v-else
                        type="button"
                        class="ftf__remove"
                        data-file-remove
                        :aria-label="$t('FieldTypes.files_remove', { name: file.name })"
                        :title="$t('FieldTypes.files_remove', { name: file.name })"
                        @click="confirming = file.key"
                    >
                        <ShellIcon name="x" :size="12" />
                    </button>
                </template>
            </div>
            <template v-if="editable">
                <p v-if="full" class="ftf__note">{{ $t('FieldTypes.files_full', { max }) }}</p>
                <label v-else class="ftf__add" :class="{ 'is-busy': busy }">
                    <input type="file" class="ah-sr-only" multiple :accept="accept || null" :disabled="busy" @change="onPick" />
                    <ShellIcon name="plus" :size="12" />
                    <span>{{ busy ? $t('FieldTypes.files_uploading') : $t('FieldTypes.files_add') }}</span>
                </label>
            </template>
        </div>
    </span>
</template>

<script setup>
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import { useCustomComposable } from "@/composable";
import { storageHelper } from "@/composable/commonFunction";
import { generateFileName, storageQueryBuilder } from "@/utils/storageQueryBuild.js";
import { EXTENSIONS, fieldFileKey, fieldFilePath, filesOf, kindOf, kindsOf, maxOf } from "@fieldTypes/files";

defineOptions({ name: "FilesFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Array, String, Number, Object], default: () => [] },
    task: { type: Object, default: () => ({}) },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const TOAST = { position: "top-right" };
const KB = 1024;
const POP_WIDTH = 280;
const GUTTER = 16;

const { t } = useI18n();
const { getters } = useStore();
const $toast = useToast();
const { checkBucketStorage } = useCustomComposable();
const { handleStorageImageRequest } = storageHelper();
const companyId = inject("$companyId", ref(""));

const root = ref(null);
const chip = ref(null);
const open = ref(false);
const over = ref(false);
const busy = ref(false);
const confirming = ref("");
const popStyle = ref({});
const thumbs = reactive({});

const files = computed(() => filesOf(props.value));
const names = computed(() => files.value.map((file) => file.name).join(", "));
const max = computed(() => maxOf(props.def));
const kind = computed(() => kindsOf(props.def));
const full = computed(() => files.value.length >= max.value);
const accept = computed(() => (kind.value === "any" ? "" : EXTENSIONS[kind.value].map((extension) => `.${extension}`).join(",")));
const listShown = computed(() => !props.compact || open.value);

const chipLabel = computed(() => {
    if (!files.value.length) return t("List.cell_set", { field: props.label });
    const value = t("FieldTypes.files_count", { n: files.value.length }, files.value.length);
    return t(props.editable ? "List.cell_change" : "List.cell_value", { field: props.label, value });
});

function sizeText(bytes) {
    const size = Number(bytes) || 0;
    if (size < KB) return t("FieldTypes.size_b", { n: size });
    if (size < KB * KB) return t("FieldTypes.size_kb", { n: Math.round(size / KB) });
    return t("FieldTypes.size_mb", { n: Math.round((size / (KB * KB)) * 10) / 10 });
}

const reasonOf = (error, fallback) => error?.response?.data?.statusText || error?.response?.data?.message || t(fallback);

const signedUrlOf = (file) => handleStorageImageRequest({ companyId: companyId.value, data: { url: file.key } });

/* A thumbnail is asked for only while its list is on screen, so a Table of chips costs no signed links. */
watch([files, listShown], () => {
    if (!listShown.value) return;
    files.value
        .filter((file) => kindOf(fieldFileKey(file.key).name) === "images" && !thumbs[file.key])
        .forEach((file) => signedUrlOf(file).then((result) => { thumbs[file.key] = result?.url || ""; }).catch(() => {}));
}, { immediate: true });

async function openFile(file) {
    try {
        const result = await signedUrlOf(file);
        if (result?.url) window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
        $toast.error(reasonOf(error, "Toast.something_went_wrong"), TOAST);
    }
}

async function upload(file) {
    const form = new FormData();
    form.append("companyId", companyId.value);
    form.append("path", fieldFilePath({ projectId: props.task.ProjectID, taskId: props.task._id, fieldId: props.def._id, name: generateFileName(file.name, env.STORAGE_TYPE) }));
    form.append("file", file);
    const response = await apiRequestWithoutCompnay("post", storageQueryBuilder("upload").route, form, "form");
    const key = [].concat(response?.data?.statusText || [])[0];
    if (response?.data?.status !== true || !fieldFileKey(key)) throw Object.assign(new Error("upload refused"), { response });
    return { key, name: file.name, size: file.size, type: file.type || "" };
}

async function addFiles(picked) {
    const list = Array.from(picked || []);
    if (!props.editable || busy.value || !list.length) return;
    if (kind.value !== "any" && list.some((file) => kindOf(file.name) !== kind.value)) {
        $toast.error(t(`FieldTypes.files_kind_refused_${kind.value}`), TOAST);
        return;
    }
    if (files.value.length + list.length > max.value) {
        $toast.error(t("FieldTypes.files_full", { max: max.value }), TOAST);
        return;
    }
    if (checkBucketStorage(list.map((file) => file.size), { gettersVal: getters }) !== true) return;
    busy.value = true;
    const added = [];
    for (const file of list) {
        try {
            added.push(await upload(file));
        } catch (error) {
            $toast.error(reasonOf(error, "FieldTypes.files_upload_failed"), TOAST);
        }
    }
    busy.value = false;
    if (added.length) emit("change", [...files.value, ...added]);
}

function onPick(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    addFiles(picked);
}

function onDrop(event) {
    over.value = false;
    addFiles(event.dataTransfer?.files);
}

/* As a task attachment is removed: the stored file is deleted first, and the value drops it only once that worked. */
async function removeFile(file) {
    busy.value = true;
    try {
        const request = storageQueryBuilder("delete", companyId.value, file.key);
        const response = await apiRequest(request.method, request.route, request.data);
        if (response?.data?.status !== true) throw Object.assign(new Error("removal refused"), { response });
        confirming.value = "";
        emit("change", files.value.filter((entry) => entry.key !== file.key));
    } catch (error) {
        $toast.error(reasonOf(error, "Toast.something_went_wrong"), TOAST);
    } finally {
        busy.value = false;
    }
}

function onOutside(event) {
    if (root.value && !root.value.contains(event.target)) close();
}

/* A cell clips what overflows it, so the list is placed on the viewport under its chip. */
function place() {
    const rect = chip.value.getBoundingClientRect();
    const width = Math.min(POP_WIDTH, window.innerWidth - GUTTER * 2);
    const left = Math.max(GUTTER, Math.min(rect.left, window.innerWidth - width - GUTTER));
    popStyle.value = { top: `${rect.bottom + 4}px`, left: `${left}px`, width: `${width}px` };
}

function close({ focus = false } = {}) {
    if (!props.compact || !open.value) return;
    open.value = false;
    confirming.value = "";
    document.removeEventListener("mousedown", onOutside);
    if (focus) nextTick(() => chip.value?.focus());
}

function toggle() {
    if (open.value) return close();
    place();
    open.value = true;
    document.addEventListener("mousedown", onOutside);
    return nextTick(() => root.value?.querySelector("[data-file-open], .ftf__add input")?.focus());
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside));
</script>

<style>
.ftf { display: inline-flex; min-width: 0; max-width: 100%; }
.ftf:not(.ftf--compact) { display: flex; width: 100%; }
.ftf__chip {
    display: inline-flex; align-items: center; gap: 4px;
    min-width: 24px; min-height: 24px; padding: 0 6px;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink); font: var(--text-data); cursor: pointer;
}
.ftf__chip:hover { background: var(--surface-hover); }
.ftf__chip:focus-visible, .ftf__name:focus-visible, .ftf__remove:focus-visible, .ftf__add:focus-within { outline: none; box-shadow: var(--focus); }
.ftf__list { display: flex; flex-direction: column; gap: 4px; width: 100%; min-width: 0; border-radius: 8px; }
.ftf__list.is-over { box-shadow: var(--focus); }
.ftf__list--pop {
    position: fixed; z-index: 40;
    max-height: min(320px, 60vh); overflow-y: auto; padding: 8px;
    border: 1px solid var(--border);
    background: var(--surface); box-shadow: var(--shadow-pop, var(--shadow-modal));
}
.ftf__row { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 28px; }
.ftf__thumb { flex: none; width: 28px; height: 28px; border-radius: 6px; object-fit: cover; background: var(--fill); }
.ftf__icon { flex: none; margin: 0 6px; color: var(--ink-2); }
.ftf__name {
    flex: 1 1 auto; min-width: 0; padding: 0;
    border: 0; border-radius: 4px;
    background: none; color: var(--brand); font: var(--text-body); text-align: left; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ftf__name:hover { text-decoration: underline; }
.ftf__size { flex: none; color: var(--ink-2); font: var(--text-data); }
.ftf__remove {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 6px;
    background: none; color: var(--ink-2); cursor: pointer;
}
.ftf__remove:hover { background: var(--surface-hover); color: var(--ink); }
.ftf__confirm { flex: none; display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); font: var(--text-small); }
.ftf__add {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
    margin: 0; padding: 4px 8px;
    border: 1px dashed var(--border); border-radius: 6px;
    color: var(--ink-2); font: var(--text-small); cursor: pointer;
}
.ftf__add:hover { border-color: var(--brand); color: var(--ink); }
.ftf__add.is-busy { cursor: progress; }
.ftf__note { margin: 0; color: var(--ink-2); font: var(--text-small); }
@media (max-width: 767px) {
    .ftf__row { flex-wrap: wrap; }
    .ftf__confirm { flex: 1 1 100%; justify-content: flex-end; }
}
</style>
