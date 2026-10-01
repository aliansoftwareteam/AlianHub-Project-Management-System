<template>
    <div v-if="shown" class="ah-detail__prop ah-detail__prop--lists" data-task-lists>
        <span class="ah-detail__prop-label">{{ $t('TaskLists.label') }}</span>
        <div class="ah-detail__lists">
            <span class="ah-detail__list-chip ah-detail__list-chip--home" data-list="home" :title="$t('TaskLists.home_hint')">
                <span class="ah-detail__list-name">{{ homeName || '—' }}</span>
                <span class="ah-detail__list-mark">{{ $t('TaskLists.home') }}</span>
            </span>
            <span
                v-for="entry in entries"
                :key="entry.sprintId"
                class="ah-detail__list-chip"
                :class="{ 'ah-detail__list-chip--closed': !isNamed(entry) }"
                :data-list="entry.sprintId"
            >
                <template v-if="isNamed(entry)">
                    <span class="ah-detail__list-name">{{ entry.name }}</span>
                    <span v-if="isElsewhere(entry)" class="ah-detail__list-mark">{{ entry.projectName }}</span>
                </template>
                <span v-else class="ah-detail__list-name">{{ $t('TaskLists.cannot_open') }}</span>
                <button
                    v-if="isRemovable(entry)"
                    type="button"
                    class="ah-detail__list-remove"
                    :disabled="busy"
                    :aria-label="$t('TaskLists.remove', { list: entry.name })"
                    :title="$t('TaskLists.remove', { list: entry.name })"
                    @click="remove(entry)"
                ><ShellIcon name="x" :size="11" /></button>
            </span>
            <button v-if="canAdd" type="button" class="ah-detail__list-add" data-list-add :disabled="busy" @click="openPicker">
                <ShellIcon name="plus" :size="12" />{{ $t('TaskLists.add') }}
            </button>
        </div>
        <ConvertToSubTaskSidebar
            v-if="picking"
            :closeSideBar="true"
            :isMoveTask="true"
            :isBulkMove="true"
            :task="task"
            :selectedProjectObject="pickerStart"
            :projectOptions="pickerProjects"
            :listPicker="listPicker"
            @isConvertSubtaskOPen="picking = false"
            @bulkMoveConfirm="add"
        />
    </div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useOtherProjectRules } from "@/composable/otherProjectRules";
import { MAX_EXTRA_LISTS, STALE_CODES, addTargets, canAddLists, canRemoveEntry, offersList, refusalCodeOf, refusalKey, signatureOf, storedEntries } from "./taskLists";

const ConvertToSubTaskSidebar = defineAsyncComponent(() => import("@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue"));

defineOptions({ name: "TaskListsRow" });

const props = defineProps({
    task: { type: Object, required: true },
    project: { type: Object, required: true },
    homeName: { type: String, default: "" }
});
const emit = defineEmits(["changed"]);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const otherRules = useOtherProjectRules();

const entries = ref([]);
const busy = ref(false);
const picking = ref(false);
let shownFor = "";
let reading = 0;

const stored = computed(() => storedEntries(props.task));
const signature = computed(() => signatureOf(props.task?._id, stored.value));
const activeProjects = computed(() => getters["projectData/onlyActiveProjects"]?.data || []);

const canAdd = computed(() => canAddLists(props.task, props.project, entries.value, otherRules.check));
const shown = computed(() => !props.task?.ParentTaskId && (entries.value.length > 0 || canAdd.value));

/* Copies: the picker writes the lists it offers onto the project it is browsing, and here those are not all of the project's lists. */
const pickerProjects = computed(() => addTargets(activeProjects.value, otherRules.check).map((project) => ({ ...project })));
const pickerStart = computed(() => ({ ...props.project, sprintsObj: {}, sprintsfolders: {} }));
const listPicker = computed(() => ({
    title: t("TaskLists.add"),
    confirm: t("TaskLists.add_confirm"),
    note: t("TaskLists.add_note", { project: props.project?.ProjectName || "" }),
    offers: offersList(props.task, entries.value)
}));

const isNamed = (entry) => entry.name !== undefined;
const isElsewhere = (entry) => String(entry.projectId) !== String(props.task?.ProjectID || props.project?._id);
const isRemovable = (entry) => canRemoveEntry(entry, { home: props.project, projects: activeProjects.value, check: otherRules.check });

function loadRules() {
    const theirs = new Set(entries.value.map((entry) => String(entry.projectId)));
    otherRules.loadAll([props.project, ...activeProjects.value.filter((project) => theirs.has(String(project._id)))]);
}

function show(list) {
    entries.value = list;
    shownFor = signatureOf(props.task?._id, list);
    loadRules();
}

async function read() {
    const mine = ++reading;
    try {
        const res = await apiRequest("get", `${env.V2_TASKS}/${props.task._id}/lists`);
        if (mine === reading) show(res?.data?.data?.extraLists || []);
    } catch (error) {
        console.error("ERROR in reading the lists of a task", error);
    }
}

function sync() {
    if (signature.value === shownFor) return;
    if (!stored.value.length) {
        reading += 1;
        show([]);
        return;
    }
    read();
}

function openPicker() {
    otherRules.loadAll(activeProjects.value);
    picking.value = true;
}

async function write(action, sprintId, doneKey, listName) {
    if (busy.value) return;
    busy.value = true;
    try {
        const res = await apiRequest("patch", env.V2_TASKS, { action, taskId: props.task._id, sprintId });
        if (res?.data?.status !== true) throw res;
        const lists = res.data.data?.extraLists || [];
        reading += 1;
        show(lists);
        emit("changed", lists.map((entry) => ({ projectId: entry.projectId, sprintId: entry.sprintId, addedBy: entry.addedBy, addedAt: entry.addedAt })));
        $toast.success(t(doneKey, { list: listName }), { position: "top-right" });
    } catch (error) {
        const code = refusalCodeOf(error);
        $toast.error(t(refusalKey(code), { max: MAX_EXTRA_LISTS }), { position: "top-right" });
        if (STALE_CODES.includes(code)) read();
    } finally {
        busy.value = false;
    }
}

function add({ sprint } = {}) {
    const sprintId = sprint && (sprint._id || sprint.id);
    if (sprintId) write("addToList", String(sprintId), "TaskLists.added", sprint.name || "");
}

function remove(entry) {
    write("removeFromList", entry.sprintId, "TaskLists.removed", entry.name || "");
}

watch(signature, sync, { immediate: true });
watch(() => props.project?._id, loadRules);
</script>
