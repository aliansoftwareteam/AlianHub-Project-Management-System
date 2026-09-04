<template>
    <div v-if="selection.hasSelection.value" class="lv2-bulk" role="region" :aria-label="$t('ListV2.bulk_region')">
        <span class="lv2-bulk__count">{{ $t('ListV2.selected', { n: selection.count.value }) }}</span>

        <span v-for="menu in menus" :key="menu.key" class="lv2-bulk__menu-wrap">
            <button
                type="button"
                class="lv2-bulk__btn"
                :disabled="working || !menu.enabled"
                @click.stop="toggle(menu.key)"
            >{{ menu.label }} ▾</button>
            <div v-if="open === menu.key" class="lv2-bulk__menu" @click.stop>
                <button v-for="option in menu.options" :key="option.id" type="button" class="lv2-bulk__item" @click="menu.pick(option)">
                    <span v-if="option.color" class="lv2-bulk__dot" :style="{ background: option.color }"></span>
                    {{ option.label }}
                </button>
                <p v-if="!menu.options.length" class="lv2-bulk__note">{{ $t('ListV2.bulk_no_options') }}</p>
            </div>
        </span>

        <span class="lv2-bulk__menu-wrap">
            <button type="button" class="lv2-bulk__btn lv2-bulk__btn--ai" :disabled="working" @click.stop="toggle('ai')">✦ {{ $t('ListV2.ask_ai') }}</button>
            <div v-if="open === 'ai'" class="lv2-bulk__menu" @click.stop>
                <button type="button" class="lv2-bulk__item" @click="summarise">{{ $t('ListV2.ai_summarise') }}</button>
                <p class="lv2-bulk__note">{{ $t('ListV2.ai_scope_note') }}</p>
            </div>
        </span>

        <button v-if="canArchive" type="button" class="lv2-bulk__btn" :disabled="working" @click.stop="ask('bulkArchive')">{{ $t('ProjectsV2.bulk_archive') }}</button>
        <button v-if="canDelete" type="button" class="lv2-bulk__btn lv2-bulk__btn--danger" :disabled="working" @click.stop="ask('bulkTrash')">{{ $t('ProjectsV2.bulk_delete') }}</button>

        <span class="lv2-bulk__esc">{{ $t('ListV2.esc') }}</span>
    </div>
    <ConfirmationSidebar
        v-if="confirmOpen"
        v-model="confirmOpen"
        :title="pending === 'bulkTrash' ? $t('ProjectsV2.bulk_delete') : $t('ProjectsV2.bulk_archive')"
        :message="$t(pending === 'bulkTrash' ? 'ProjectsV2.bulk_delete_confirm' : 'ProjectsV2.bulk_archive_confirm', { n: selection.count.value })"
        :confirmationString="pending === 'bulkTrash' ? 'delete' : 'archive'"
        :acceptButtonClass="pending === 'bulkTrash' ? 'btn-danger' : 'btn-primary'"
        :acceptButton="pending === 'bulkTrash' ? $t('ProjectsV2.bulk_delete') : $t('ProjectsV2.bulk_archive')"
        :showSpinner="working"
        @confirm="runConfirmed"
    />
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useToast } from "vue-toast-notification";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useCustomComposable, useGetterFunctions } from "@/composable";
import { useTaskSelection } from "@/composable/useTaskSelection.js";
import { useTaskSummaries } from "@/views/Projects/TableView/useTaskSummaries.js";
import ConfirmationSidebar from "@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue";

defineOptions({ name: "ListBulkBar" });

const props = defineProps({
    project: { type: Object, required: true }
});

const { t } = useI18n();
const { getters } = useStore();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const { checkPermission } = useCustomComposable();
const selection = useTaskSelection();
const summaries = useTaskSummaries();
const userId = inject("$userId");

const open = ref("");
const working = ref(false);

const canStatus = computed(() => checkPermission("task.task_status", props.project?.isGlobalPermission) === true);
const canAssign = computed(() => checkPermission("task.task_assignee", props.project?.isGlobalPermission) === true);
const canArchive = computed(() => checkPermission("task.task_archive", props.project?.isGlobalPermission) === true);
const canDelete = computed(() => checkPermission("task.task_delete", props.project?.isGlobalPermission) === true);

const confirmOpen = ref(false);
const pending = ref("");
function ask(action) {
    open.value = "";
    pending.value = action;
    confirmOpen.value = true;
}
async function runConfirmed() {
    await run(pending.value, {});
    confirmOpen.value = false;
}

const statuses = computed(() => (props.project?.taskStatusData || []).map((status) => ({
    id: status.key, label: status.name, color: status.textColor, raw: status
})));

const people = computed(() => {
    const ids = props.project?.isPrivateSpace
        ? (props.project?.AssigneeUserId || [])
        : (getters["settings/companyUsers"] || []).filter((user) => user && user.isDelete === false).map((user) => user.userId);
    const seen = new Set();
    return ids.reduce((list, id) => {
        const key = String(id || "");
        if (!key || seen.has(key)) return list;
        seen.add(key);
        const user = getUser(key);
        if (!user || user.ghostUser) return list;
        list.push({ id: key, label: user.Employee_Name || key });
        return list;
    }, []);
});

const sprints = computed(() => {
    const direct = Object.values(props.project?.sprintsObj || {});
    const inFolders = Object.values(props.project?.sprintsfolders || {})
        .flatMap((folder) => Object.values(folder?.sprintsObj || {}));
    return [...direct, ...inFolders]
        .filter((sprint) => sprint && !sprint.deletedStatusKey)
        .map((sprint) => ({ id: sprint.id, label: sprint.name, raw: sprint }));
});

const tags = computed(() => (props.project?.tagsArray || []).map((tag) => ({
    id: tag.uid || tag._id || tag.id, label: tag.tagName || tag.name, raw: tag
})));

const menus = computed(() => [
    { key: "status", label: t("ListV2.status"), enabled: canStatus.value, options: statuses.value, pick: pickStatus },
    { key: "assignee", label: t("ListV2.assignee"), enabled: canAssign.value, options: people.value, pick: pickAssignee },
    { key: "sprint", label: t("ListV2.sprint"), enabled: canStatus.value, options: sprints.value, pick: pickSprint },
    { key: "tags", label: t("ListV2.tags"), enabled: canStatus.value, options: tags.value, pick: pickTag }
]);

function toggle(key) {
    open.value = open.value === key ? "" : key;
}

function userData() {
    const me = getUser(userId?.value);
    return {
        id: me?.id || String(userId?.value || ""),
        Employee_Name: me?.Employee_Name || "",
        companyOwnerId: getters["settings/companyOwnerDetail"]?.userId || ""
    };
}

async function run(action, payload) {
    if (working.value) return;
    working.value = true;
    open.value = "";
    try {
        const response = await apiRequest("post", env.V2_TASKS_BULK, {
            action,
            taskIds: [...selection.selectedTaskIds.value],
            userData: userData(),
            ...payload
        });
        if (response?.data?.status === false) {
            $toast.error(response.data.statusText || t("ListV2.bulk_failed"));
            return;
        }
        const totals = response?.data?.data?.totals || {};
        $toast.success(t("ListV2.bulk_done", { n: totals.updated ?? selection.count.value }));
        selection.clear();
    } catch (error) {
        $toast.error(error?.message || t("ListV2.bulk_failed"));
    } finally {
        working.value = false;
    }
}

function pickStatus(option) {
    const status = option.raw;
    run("bulkUpdateStatus", {
        newStatus: {
            status: { key: status.key, value: "", text: status.name, type: status.type, bgColor: status.bgColor, textColor: status.textColor },
            statusKey: status.key,
            statusType: status.type
        }
    });
}

function pickAssignee(option) {
    run("bulkUpdateAssignee", { type: "assigneeAdd", employeeId: [String(option.id)], employeeName: option.label });
}

function pickSprint(option) {
    run("bulkMove", {
        sprintObj: option.raw,
        projectData: { id: props.project._id, ProjectCode: props.project.ProjectCode, ProjectName: props.project.ProjectName }
    });
}

function pickTag(option) {
    if (!option.id) return;
    run("bulkUpdateTags", { tagId: option.id, operation: "add" });
}

async function summarise() {
    open.value = "";
    const ids = [...selection.selectedTaskIds.value];
    const result = await summaries.generateMany(ids);
    if (result.failed && !result.done) $toast.error(t("ListV2.ai_unavailable"));
    else $toast.success(t("ListV2.ai_summarised", { n: result.done }));
}

function onKey(event) {
    if (event.key !== "Escape") return;
    if (open.value) { open.value = ""; return; }
    if (selection.hasSelection.value) selection.clear();
}
function onClick() {
    open.value = "";
}

onMounted(() => {
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
});
onBeforeUnmount(() => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onClick);
});
</script>

<style>
/* Bulk bar (14a) */
.lv2-bulk {
    height: 40px;
    flex: none;
    background: var(--rail);
    color: #fff;
    display: flex;
    align-items: center;
    padding: 0 20px;
    gap: 14px;
    font-size: 12.5px;
    position: relative;
    z-index: 4;
}
.lv2-bulk__count { font-weight: 600; }
.lv2-bulk__btn {
    background: none; border: 0; padding: 0;
    color: rgba(255, 255, 255, .7);
    font: 400 12.5px/1 var(--font-ui);
    cursor: pointer;
}
.lv2-bulk__btn:hover:not(:disabled) { color: #fff; }
.lv2-bulk__btn:disabled { opacity: .4; cursor: not-allowed; }
.lv2-bulk__btn--ai { color: #a892ff; font-weight: 600; }
.lv2-bulk__btn--danger { color: #ff9b9b; }
.lv2-bulk__btn--danger:hover:not(:disabled) { color: #ffc2c2; }
.lv2-bulk__esc { margin-left: auto; color: rgba(255, 255, 255, .5); }
.lv2-bulk__menu-wrap { position: relative; }
.lv2-bulk__menu {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    min-width: 200px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
    box-shadow: var(--shadow-pop);
    padding: 6px;
    z-index: 40;
}
.lv2-bulk__item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; text-align: left;
    background: none; border: 0;
    padding: 7px 8px; border-radius: 6px;
    font: var(--text-small);
    color: var(--ink);
    cursor: pointer;
}
.lv2-bulk__item:hover { background: var(--surface-hover); }
.lv2-bulk__note { padding: 7px 8px; color: var(--ink-2); font: var(--text-small); }

.lv2-bulk__dot { width: 8px; height: 8px; border-radius: 2px; flex: none; background: var(--ink-3); }

@media (max-width: 767px) {
    .lv2-bulk { padding: 0 16px; gap: 10px; overflow-x: auto; }
}

/* Projects.vue mounts the legacy floating bulk bar for every view; the
   redesigned views carry this one instead. */
</style>
