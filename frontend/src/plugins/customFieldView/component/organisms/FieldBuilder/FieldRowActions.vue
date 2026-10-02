<template>
    <div ref="root" class="fb-menu">
        <button
            type="button"
            class="fb-menu__more"
            aria-haspopup="menu"
            :aria-expanded="String(shown)"
            :aria-label="t('Fields.actions_for', { field: name })"
            :title="t('Fields.actions_for', { field: name })"
            @click="shown ? close() : open()"
        >
            <ShellIcon name="dots" :size="14" />
        </button>
        <div v-if="shown" ref="menu" class="ah-pop fb-menu__pop" :class="menuClass" :style="menuStyle" role="menu" :aria-label="t('Fields.actions_for', { field: name })" @keydown.stop="onMenuKeydown">
            <button v-for="entry in entries" :key="entry.kind" type="button" class="ah-pop__item" :class="{ 'fb-menu__danger': entry.kind === 'delete' }" role="menuitem" tabindex="-1" @click="start(entry.kind)">
                <ShellIcon :name="entry.icon" :size="14" />{{ entry.label }}
            </button>
        </div>

        <teleport to="body">
            <div v-if="mode === 'delete'" class="fb-menu__overlay" @click.self="mode = ''" @keydown.esc="mode = ''">
                <div class="fb-menu__card" role="alertdialog" aria-modal="true" :aria-label="t('Fields.delete_title', { field: name })">
                    <h3 class="ah-h3 fb-menu__title">{{ t('Fields.delete_title', { field: name }) }}</h3>
                    <p class="fb-menu__text">{{ deleteText }}</p>
                    <p v-if="usage && !usage.readBy.length" class="fb-menu__text">{{ t('Fields.delete_archive_hint') }}</p>
                    <div class="fb-menu__actions">
                        <button ref="cancelButton" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-action="cancel" @click="mode = ''">{{ usage?.readBy.length ? t('Fields.close') : t('Fields.cancel') }}</button>
                        <template v-if="usage && !usage.readBy.length">
                            <button v-if="!archived" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-action="archive" @click="archiveInstead">{{ t('Fields.archive_instead') }}</button>
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" data-action="confirm" @click="remove">{{ t('Fields.delete') }}</button>
                        </template>
                    </div>
                </div>
            </div>
            <div v-if="mode === 'projects'" class="fb-menu__overlay" @click.self="mode = ''" @keydown.esc="mode = ''">
                <div class="fb-menu__card" role="dialog" aria-modal="true" data-field-projects :aria-label="t('Fields.projects_title', { field: name })">
                    <h3 class="ah-h3 fb-menu__title">{{ t('Fields.projects_title', { field: name }) }}</h3>
                    <label class="fb-menu__choice"><input v-model="reach" type="radio" value="every" :name="`fb-reach-${field._id}`" /> {{ t('Fields.projects_every') }}</label>
                    <label class="fb-menu__choice"><input v-model="reach" type="radio" value="chosen" :name="`fb-reach-${field._id}`" /> {{ t('Fields.projects_chosen') }}</label>
                    <div v-if="reach === 'chosen'" class="fb-menu__projects">
                        <label v-for="project in projects" :key="project._id" class="fb-menu__choice">
                            <input v-model="chosen" type="checkbox" class="ah-check" :value="project._id" /> <span class="fb-menu__project">{{ project.ProjectName }}</span>
                        </label>
                        <p v-if="!projects.length" class="fb-menu__text">{{ t('Fields.projects_empty') }}</p>
                    </div>
                    <p v-if="reach === 'chosen' && !chosen.length" class="fb-menu__text">{{ t('Fields.projects_none') }}</p>
                    <div class="fb-menu__actions">
                        <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-action="cancel" @click="mode = ''">{{ t('Fields.cancel') }}</button>
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || (reach === 'chosen' && !chosen.length)" data-action="confirm" @click="saveProjects">{{ t('Fields.projects_save') }}</button>
                    </div>
                </div>
            </div>
        </teleport>
    </div>
</template>

<script setup>
/**
 * The actions of one field in the field manager: the projects it shows in, archive or restore, and delete.
 * An archived field is hidden from tasks and keeps every value. A delete asks first, says how many tasks hold a
 * value, and is not offered while a rollup or a formula reads the field.
 *
 * Props
 *   field   Object   the field definition
 *
 * Emits
 *   removed(fieldId)   the field is gone, so an editor open on it should close
 */
import { computed, nextTick, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useRowMenu } from "@/components/molecules/ProjectTree/useRowMenu";
import { fieldProjectIds } from "@/plugins/customFieldView/taskTypeOptions";
import { projectLinkRequest } from "@/plugins/customFieldView/fieldProjectLinks";

defineOptions({ name: "FieldRowActions" });

const props = defineProps({ field: { type: Object, required: true } });
const emit = defineEmits(["removed"]);

const { t } = useI18n();
const { getters, commit } = useStore();
const $toast = useToast();
const { shown, root, menu, menuClass, menuStyle, open, close, onMenuKeydown } = useRowMenu();

const mode = ref("");
const busy = ref(false);
const usage = ref(null);
const reach = ref("every");
const chosen = ref([]);
const cancelButton = ref(null);

const name = computed(() => props.field.fieldTitle || t("Fields.untitled"));
const archived = computed(() => props.field.isDelete === false);
const projects = computed(() => (getters["projectData/allProjects"]?.data || []).filter((project) => project && !project.isPersonal));

const entries = computed(() => [
    { kind: "projects", icon: "layout", label: t("Fields.choose_projects") },
    archived.value ? { kind: "restore", icon: "arrowRight", label: t("Fields.restore") } : { kind: "archive", icon: "book", label: t("Fields.archive") },
    { kind: "delete", icon: "trash", label: t("Fields.delete") }
]);

const deleteText = computed(() => {
    if (!usage.value) return t("Fields.delete_counting");
    const { tasks, readBy } = usage.value;
    if (readBy.length) return t("Fields.delete_read_by", { fields: readBy.join(", ") }, readBy.length);
    return tasks ? t("Fields.delete_with_values", { n: tasks }, tasks) : t("Fields.delete_no_values");
});

watch(mode, (now) => { if (now === "delete") nextTick(() => cancelButton.value?.focus()); });

const complain = (error) => $toast.error(error?.response?.data?.message || error?.message || t("Toast.something_went_wrong"), { position: "top-right" });
const say = (key) => $toast.success(t(key, { field: name.value }), { position: "top-right" });

async function update(request, changed) {
    const response = await apiRequest("put", env.CUSTOM_FIELD, { type: "updateOne", key: "$set", id: props.field._id, ...request });
    if (response?.status !== 200) throw new Error(response?.data?.message || t("Toast.something_went_wrong"));
    commit("settings/mutateFinalCustomFields", { data: { ...props.field, ...changed }, op: "modified" });
}

async function setArchived(off) {
    busy.value = true;
    try {
        await update({ updateObject: { isDelete: !off } }, { isDelete: !off });
        say(off ? "Fields.archived_toast" : "Fields.restored_toast");
    } catch (error) {
        complain(error);
    } finally {
        busy.value = false;
    }
}

async function askDelete() {
    usage.value = null;
    mode.value = "delete";
    try {
        const response = await apiRequest("get", `${env.CUSTOM_FIELDS_V2}/${props.field._id}/usage`);
        const data = response?.data?.data || {};
        usage.value = { tasks: Number(data.tasks) || 0, readBy: Array.isArray(data.readBy) ? data.readBy : [] };
    } catch (error) {
        mode.value = "";
        complain(error);
    }
}

async function remove() {
    busy.value = true;
    try {
        const response = await apiRequest("post", `${env.CUSTOM_FIELDS_V2}/${props.field._id}/delete`);
        if (response?.data?.status !== true) throw new Error(response?.data?.message || t("Toast.something_went_wrong"));
        const gone = { _id: props.field._id };
        say("Fields.deleted_toast");
        mode.value = "";
        emit("removed", gone._id);
        commit("settings/mutateFinalCustomFields", { data: gone, op: "removed" });
    } catch (error) {
        complain(error);
    } finally {
        busy.value = false;
    }
}

async function archiveInstead() {
    mode.value = "";
    await setArchived(true);
}

function askProjects() {
    const linked = fieldProjectIds(props.field);
    reach.value = props.field.global === true || !linked.length ? "every" : "chosen";
    chosen.value = linked;
    mode.value = "projects";
}

async function saveProjects() {
    const after = reach.value === "every" ? { global: true, projectId: [] } : { global: false, projectId: [...chosen.value] };
    busy.value = true;
    try {
        await update(projectLinkRequest(props.field, after), after);
        say("Fields.projects_saved");
        mode.value = "";
    } catch (error) {
        complain(error);
    } finally {
        busy.value = false;
    }
}

function start(kind) {
    close();
    if (kind === "archive") setArchived(true);
    else if (kind === "restore") setArchived(false);
    else if (kind === "delete") askDelete();
    else askProjects();
}
</script>

<style>
.fb-menu { position: relative; display: inline-flex; }
.fb-menu__more {
    min-width: var(--hit-min); min-height: var(--hit-min); display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: var(--ink-2); padding: 0; cursor: pointer; border-radius: var(--r-sm, 4px);
}
.fb-menu__more:hover, .fb-menu__more[aria-expanded="true"] { color: var(--ink); background: var(--fill); }
.fb-menu__more:focus-visible { outline: none; box-shadow: var(--focus); }
.fb-menu__pop { position: absolute; top: calc(100% + var(--sp-1)); right: 0; z-index: 40; min-width: 190px; overflow-y: auto; overscroll-behavior: contain; }
.fb-menu__pop.pt-menu__pop--up { top: auto; bottom: calc(100% + var(--sp-1)); }
.fb-menu__danger, .fb-menu__danger:hover { color: var(--danger); }
.fb-menu__overlay { position: fixed; inset: 0; background: var(--scrim); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--sp-7); }
.fb-menu__card { background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: var(--r-card); width: min(440px, 100%); max-height: 100%; overflow-y: auto; padding: 18px var(--sp-8) 22px; box-shadow: var(--shadow-pop); font-family: var(--font-ui); }
.fb-menu__title { margin: 0 0 var(--sp-5); overflow-wrap: anywhere; }
.fb-menu__text { margin: 0 0 var(--sp-5); font-size: var(--fs-md, 13px); line-height: var(--lh-body, 1.5); color: var(--ink-2); overflow-wrap: anywhere; }
.fb-menu__choice { display: flex; align-items: center; gap: var(--sp-3); min-height: 32px; font: var(--text-body); color: var(--ink); cursor: pointer; }
.fb-menu__projects { max-height: 240px; overflow-y: auto; margin: var(--sp-3) 0 var(--sp-5); padding: var(--sp-3) var(--sp-5); border: 1px solid var(--border); border-radius: var(--r-md, 8px); }
.fb-menu__project { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-menu__actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: var(--sp-4); margin-top: var(--sp-7); }
</style>
