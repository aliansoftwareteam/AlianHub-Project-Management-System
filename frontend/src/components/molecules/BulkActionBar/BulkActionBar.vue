<template>
    <Transition name="bulk-bar-fade">
        <div
            v-if="selection.hasSelection.value"
            class="bulk-action-bar"
            :class="{ 'bulk-action-bar--compact': clientWidth <= 767 }"
            role="region"
            aria-label="Bulk task actions"
            ref="barRef"
        >
            <div class="bulk-action-bar__count">
                <span class="bulk-action-bar__count-number">{{ selection.count.value }}</span>
                <span class="bulk-action-bar__count-label">{{ selection.count.value === 1 ? 'task' : 'tasks' }} selected</span>
            </div>

            <div class="bulk-action-bar__divider"></div>

            <!-- STATUS -->
            <BulkMenu
                label="Status"
                :open="openMenu === 'status'"
                :disabled="!canChangeStatus"
                @toggle="toggleMenu('status')"
            >
                <div class="bulk-menu__search">
                    <input
                        ref="statusSearchRef"
                        v-model="menuSearch"
                        type="text"
                        placeholder="Search status"
                        class="bulk-menu__search-input"
                        @click.stop
                    />
                </div>
                <div class="bulk-menu__scroll">
                    <button v-for="status in filteredStatuses" :key="status.key" class="bulk-menu__item" @click="onStatusPick(status)">
                        <span
                            class="bulk-status-option"
                            :style="`background-color: ${status.bgColor || '#f5f5f5'}; color: ${status.textColor || '#3a3a3a'}`"
                        >{{ status.name }}</span>
                    </button>
                    <div v-if="!filteredStatuses.length" class="bulk-menu__empty">No matches</div>
                </div>
            </BulkMenu>

            <!-- PRIORITY -->
            <BulkMenu
                label="Priority"
                :open="openMenu === 'priority'"
                :disabled="!canChangePriority || !availablePriorities.length"
                @toggle="toggleMenu('priority')"
            >
                <div class="bulk-menu__search">
                    <input
                        v-model="menuSearch"
                        type="text"
                        placeholder="Search priority"
                        class="bulk-menu__search-input"
                        @click.stop
                    />
                </div>
                <div class="bulk-menu__scroll">
                    <button v-for="p in filteredPriorities" :key="p.value" class="bulk-menu__item" @click="onPriorityPick(p)">
                        <span class="bulk-status-option" style="background-color: #f5f5f5; color: #3a3a3a">{{ p.name }}</span>
                    </button>
                    <div v-if="!filteredPriorities.length" class="bulk-menu__empty">No matches</div>
                </div>
            </BulkMenu>

            <!-- ASSIGNEES -->
            <BulkMenu
                label="Assignees"
                :open="openMenu === 'assignees'"
                :disabled="!canChangeAssignees || !assigneeUserList.length"
                @toggle="toggleMenu('assignees')"
                width="300px"
            >
                <div class="bulk-menu__search">
                    <input
                        v-model="menuSearch"
                        type="text"
                        placeholder="Search people"
                        class="bulk-menu__search-input"
                        @click.stop
                    />
                </div>
                <div class="bulk-menu__scroll">
                    <button
                        v-for="user in filteredAssignees"
                        :key="user.id"
                        type="button"
                        class="bulk-menu__row bulk-menu__row--user bulk-menu__row--clickable"
                        :class="{ 'bulk-menu__row--selected': assigneeState(user.id) !== 'none' }"
                        @click="onAssigneeRowClick(user)"
                    >
                        <span class="bulk-menu__user-info">
                            <UserProfile
                                class="bulk-menu__avatar-wrap"
                                :data="{ title: user.label, image: user.image, type: 'user' }"
                                :showDot="false"
                                width="26px"
                                thumbnail="30x30"
                            />
                            <span class="bulk-menu__row-label">{{ user.label }}</span>
                            <span v-if="assigneeState(user.id) === 'some'" class="bulk-menu__partial-pill">partial</span>
                        </span>
                        <span
                            v-if="assigneeState(user.id) !== 'none'"
                            class="bulk-menu__remove"
                            title="Remove"
                            @click.stop="onAssigneeAct('remove', user)"
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="6" y1="6" x2="18" y2="18"/>
                                <line x1="18" y1="6" x2="6" y2="18"/>
                            </svg>
                        </span>
                    </button>
                    <div v-if="!filteredAssignees.length" class="bulk-menu__empty">No matches</div>
                </div>
            </BulkMenu>

            <!-- DUE DATE — DueDateCompo opens the same calendar used in list/table. -->
            <BulkMenu
                label="Due date"
                :open="openMenu === 'due'"
                :disabled="!canChangeDates"
                @toggle="toggleMenu('due')"
                width="300px"
            >
                <div class="bulk-menu__hint">Set a new due date for all selected tasks</div>
                <div class="bulk-due-content">
                    <div class="bulk-due-input-wrap">
                        <svg class="bulk-due-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <DueDateCompo
                            id="bulk-due-date"
                            :displyDate="''"
                            :overdue="false"
                            :isShowDateAndicon="true"
                            @SelectedDate="onDueDateSelected"
                        />
                    </div>
                </div>
                <button class="bulk-due-clear" @click="onDueClear">Clear due date</button>
            </BulkMenu>

            <!-- TAGS -->
            <BulkMenu
                label="Tags"
                :open="openMenu === 'tags'"
                :disabled="!canChangeTags || !availableTags.length"
                @toggle="toggleMenu('tags')"
                width="280px"
            >
                <div class="bulk-menu__search">
                    <input
                        v-model="menuSearch"
                        type="text"
                        placeholder="Search tags"
                        class="bulk-menu__search-input"
                        @click.stop
                    />
                </div>
                <div class="bulk-menu__scroll">
                    <button
                        v-for="tag in filteredTags"
                        :key="tag.uid || tag._id || tag.id"
                        type="button"
                        class="bulk-menu__row bulk-menu__row--clickable"
                        :class="{ 'bulk-menu__row--selected': tagState(tag) !== 'none' }"
                        @click="onTagRowClick(tag)"
                    >
                        <span class="bulk-menu__row-label">
                            <span class="bulk-tag-chip" :style="`background:${tag.tagBgColor || '#f4f5f7'}; color:${tag.tagColor || '#3a3a3a'}`">
                                {{ tag.tagName || tag.name }}
                            </span>
                            <span v-if="tagState(tag) === 'some'" class="bulk-menu__partial-pill">partial</span>
                        </span>
                        <span
                            v-if="tagState(tag) !== 'none'"
                            class="bulk-menu__remove"
                            title="Remove"
                            @click.stop="onTagAct('remove', tag)"
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="6" y1="6" x2="18" y2="18"/>
                                <line x1="18" y1="6" x2="6" y2="18"/>
                            </svg>
                        </span>
                    </button>
                    <div v-if="!filteredTags.length" class="bulk-menu__empty">No matches</div>
                </div>
            </BulkMenu>

            <!-- MOVE — opens the shared move sidebar (project + sprint/folder
                 picker) in bulk mode; backend auto-maps status/type. -->
            <button
                class="bulk-action-bar__btn"
                :class="{ 'bulk-action-bar__btn--disabled': !canMove }"
                :title="canMove ? 'Move selected tasks' : 'No permission to move'"
                :disabled="!canMove"
                @click="canMove && (showMove = true, closeMenu())"
            >
                <span>Move</span>
            </button>

            <!-- DELETE -->
            <button
                class="bulk-action-bar__btn bulk-action-bar__btn--danger"
                :class="{ 'bulk-action-bar__btn--disabled': !canDelete }"
                :title="canDelete ? 'Delete selected tasks' : 'No permission to delete'"
                :disabled="!canDelete"
                @click="canDelete && (showDeleteConfirm = true, closeMenu())"
            >
                <span>Delete</span>
            </button>

            <!-- ARCHIVE -->
            <button
                class="bulk-action-bar__btn"
                :class="{ 'bulk-action-bar__btn--disabled': !canArchive }"
                :title="canArchive ? 'Archive selected tasks' : 'No permission to archive'"
                :disabled="!canArchive"
                @click="canArchive && (showArchiveConfirm = true, closeMenu())"
            >
                <span>Archive</span>
            </button>

            <div class="bulk-action-bar__divider"></div>

            <button class="bulk-action-bar__close" @click="selection.clear()" title="Clear selection" aria-label="Clear selection">
                ✕
            </button>
        </div>
    </Transition>

    <ConfirmationSidebar
        v-model="showDeleteConfirm"
        :title="`Delete ${selection.count.value} ${selection.count.value === 1 ? 'task' : 'tasks'}`"
        :message="`This will delete ${selection.count.value} ${selection.count.value === 1 ? 'task' : 'tasks'}. Subtasks will be deleted too.`"
        :confirmationString="`delete ${selection.count.value} ${selection.count.value === 1 ? 'task' : 'tasks'}`"
        acceptButtonClass="archive-delete-btn-bg-red"
        acceptButton="Delete"
        :showSpinner="isWorking"
        @confirm="performDelete"
    />

    <ConfirmationSidebar
        v-model="showArchiveConfirm"
        :title="`Archive ${selection.count.value} ${selection.count.value === 1 ? 'task' : 'tasks'}`"
        :message="`Archived tasks can be restored later from the archive view.`"
        :confirmationString="`archive ${selection.count.value} ${selection.count.value === 1 ? 'task' : 'tasks'}`"
        acceptButtonClass="archive-confirm-btn"
        acceptButton="Archive"
        :showSpinner="isWorking"
        @confirm="performArchive"
    />

    <!-- Bulk move: reuse the single-task move sidebar (project + sprint/folder
         picker) in bulk mode. It emits the chosen destination; we fire the
         bulkMove request. -->
    <ConvertToSubTaskSidebar
        v-if="showMove"
        :closeSideBar="showMove"
        :isMoveTask="true"
        :isBulkMove="true"
        :task="{}"
        @isConvertSubtaskOPen="showMove = false"
        @bulkMoveConfirm="onBulkMoveConfirm"
    />
</template>

<script setup>
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';

import ConfirmationSidebar from '@/components/molecules/ConfirmationSidebar/ConfirmationSidebar.vue';
import ConvertToSubTaskSidebar from '@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import BulkMenu from './BulkMenu.vue';

import { useTaskSelection } from '@/composable/useTaskSelection.js';
import { useCustomComposable, useGetterFunctions } from '@/composable';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const store = useStore();
const { getters, commit } = store;
const { getUser } = useGetterFunctions();
const selection = useTaskSelection();
const $toast = useToast();
const { checkPermission, checkApps } = useCustomComposable();
const projectData = inject('selectedProject', null);
const clientWidthInj = inject('$clientWidth', null);
const clientWidth = computed(() => clientWidthInj?.value ?? window.innerWidth);
const userId = inject('$userId', null);

const showDeleteConfirm = ref(false);
const showArchiveConfirm = ref(false);
const showMove = ref(false);
const isWorking = ref(false);
const barRef = ref(null);

// ----- Single-open menu state. Replaces the per-button DropDown so only
// one menu can be open at a time and a click outside the bar closes it. -----
const openMenu = ref(null);
const menuSearch = ref('');
function toggleMenu(name) {
    menuSearch.value = '';
    openMenu.value = openMenu.value === name ? null : name;
}
function closeMenu() {
    openMenu.value = null;
    menuSearch.value = '';
}

// CSS selectors for teleported popups that we must NOT treat as
// "outside" clicks — closing the bar menu when the user is picking a
// date / assignee / dropdown option from one of these would tear down
// the picker before the value lands.
const TELEPORT_POPUP_SELECTORS = [
    '.dp__main',           // VueDatePicker root
    '.dp__outer_menu_wrap',
    '.dp__menu',
    '.dp__menu_inner',
    '.dp__overlay',
    '#my-sidebar',         // Sidebar teleport target
    '#my-dropdown',        // DropDown teleport target
    '.drop-down-menu',
    '.bulk-menu__panel',   // BulkMenu's own panel teleported to <body>
];
function isInsideTeleportPopup(target) {
    if (!target || !target.closest) return false;
    return TELEPORT_POPUP_SELECTORS.some((sel) => target.closest(sel));
}
function onDocumentClick(evt) {
    if (!openMenu.value) return;
    const bar = barRef.value;
    if (bar && bar.contains(evt.target)) return; // click inside bar
    if (isInsideTeleportPopup(evt.target)) return; // click inside a teleported picker
    closeMenu();
}
// Use capture so .stop on inner elements doesn't swallow the event.
document.addEventListener('click', onDocumentClick, true);
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick, true));

// Close any open menu whenever selection clears.
watch(() => selection.hasSelection.value, (now) => { if (!now) closeMenu(); });

// ---------- Permissions (Layer 2 — see plan) ----------
const canChangeStatus = computed(() => checkPermission('task.task_status', projectData?.value?.isGlobalPermission) === true);
const canChangePriority = computed(() => checkPermission('task.task_priority', projectData?.value?.isGlobalPermission) === true);
const canChangeAssignees = computed(() => checkPermission('task.task_assignee', projectData?.value?.isGlobalPermission) === true);
const canChangeDates = computed(() => checkPermission('task.task_due_date', projectData?.value?.isGlobalPermission) === true);
const canChangeTags = computed(() => checkPermission('task.task_tag', projectData?.value?.isGlobalPermission) === true);
const canDelete = computed(() => checkPermission('task.task_delete', projectData?.value?.isGlobalPermission) === true);
const canArchive = computed(() => checkPermission('task.task_archive', projectData?.value?.isGlobalPermission) === true);
const canMove = computed(() => checkPermission('task.task_move', projectData?.value?.isGlobalPermission) === true);

const availableStatuses = computed(() => {
    const data = projectData?.value?.taskStatusData;
    return Array.isArray(data) ? data : [];
});
const availablePriorities = computed(() => {
    const data = getters['settings/companyPriority'];
    return Array.isArray(data) ? data : [];
});
// Build a clean { id, label, image } list of users available to assign.
// Private-space projects restrict to the project's member list; public
// projects allow any active company user — matches the per-task assignee
// picker in TaskDetailRightSide. Backend re-validates permission per task.
const assigneeUserList = computed(() => {
    const isPrivateSpace = !!projectData?.value?.isPrivateSpace;
    const projectIds = Array.isArray(projectData?.value?.AssigneeUserId)
        ? projectData.value.AssigneeUserId
        : [];
    const companyUsers = getters['settings/companyUsers'] || [];
    const sourceIds = isPrivateSpace
        ? projectIds
        : companyUsers.filter((u) => u && u.isDelete === false).map((u) => u.userId);

    const seen = new Set();
    const out = [];
    for (const id of sourceIds) {
        const sid = String(id || '').trim();
        if (!sid || seen.has(sid)) continue;
        seen.add(sid);
        const u = getUser ? getUser(sid) : null;
        if (!u || u.ghostUser) continue;
        out.push({
            id: sid,
            label: u.Employee_Name || u.name || sid,
            image: u.Employee_profileImageURL || u.Employee_profileImage || '',
        });
    }
    out.sort((a, b) => (a.label || '').toLowerCase().localeCompare((b.label || '').toLowerCase()));
    return out;
});

const availableTags = computed(() => {
    const tags = projectData?.value?.tagsArray;
    return Array.isArray(tags) ? tags : [];
});

// ---- Search filters ----------------------------------------------------
function matchesSearch(text) {
    const q = (menuSearch.value || '').trim().toLowerCase();
    if (!q) return true;
    return String(text || '').toLowerCase().includes(q);
}
const filteredStatuses = computed(() => availableStatuses.value.filter((s) => matchesSearch(s.name)));
const filteredPriorities = computed(() => availablePriorities.value.filter((p) => matchesSearch(p.name)));
const filteredAssignees = computed(() => assigneeUserList.value.filter((u) => matchesSearch(u.label)));
const filteredTags = computed(() => availableTags.value.filter((t) => matchesSearch(t.tagName || t.name)));

// ---- Per-row state (none / some / all) --------------------------------
// For a given user/tag, count how many of the currently-selected tasks
// already have it. This drives the "added vs not-added" UI: selected rows
// get the highlight + remove icon; unselected rows act as add buttons.
function assigneeState(userId) {
    const ids = selection.selectedTaskIds.value;
    if (!ids.length || !userId) return 'none';
    const target = String(userId);
    let hits = 0;
    for (const id of ids) {
        const found = findTaskInStore(id);
        const list = found?.task?.AssigneeUserId;
        if (Array.isArray(list) && list.map(String).includes(target)) hits += 1;
    }
    if (hits === 0) return 'none';
    if (hits === ids.length) return 'all';
    return 'some';
}
function tagState(tag) {
    const ids = selection.selectedTaskIds.value;
    if (!ids.length) return 'none';
    const target = String(tag?.uid || tag?._id || tag?.id || '');
    if (!target) return 'none';
    let hits = 0;
    for (const id of ids) {
        const found = findTaskInStore(id);
        const list = found?.task?.tagsArray;
        if (Array.isArray(list) && list.map(String).includes(target)) hits += 1;
    }
    if (hits === 0) return 'none';
    if (hits === ids.length) return 'all';
    return 'some';
}

// Row-click behavior — purely a UI affordance. Clicking the row body
// adds when not present; the remove icon is the only way out once added.
function onAssigneeRowClick(user) {
    if (assigneeState(user.id) !== 'none') return; // already in some/all — only remove via the X
    onAssigneeAct('add', user);
}
function onTagRowClick(tag) {
    if (tagState(tag) !== 'none') return;
    onTagAct('add', tag);
}

// userData shape must match what the per-task helpers expect:
//   `{ id, Employee_Name, companyOwnerId }`
// HandleHistory writes UserId from `userData.id` — passing _id/userId instead
// produces history entries with empty UserId, which is why activity logs
// looked "broken" before this fix.
function buildUserData() {
    const me = getUser ? getUser(userId?.value) : null;
    const owner = getters['settings/companyOwnerDetail'] || {};
    return {
        id: me?.id || (userId?.value ? String(userId.value) : '') || localStorage.getItem('userId') || '',
        Employee_Name: me?.Employee_Name || localStorage.getItem('userName') || '',
        companyOwnerId: owner.userId || '',
    };
}

// --------------------------------------------------------------------------
// Optimistic store helpers — mirror the single-task pattern so the UI
// updates immediately (matching single-task delete/archive). The MongoDB
// change stream then provides eventual consistency from the server.
// --------------------------------------------------------------------------
function findTaskInStore(taskId) {
    const tasksState = store.state.projectData?.tasks || {};
    const targetId = String(taskId);
    for (const pid of Object.keys(tasksState)) {
        const project = tasksState[pid];
        const sprintIds = Array.isArray(project?.sprints) ? project.sprints : [];
        for (const sid of sprintIds) {
            const sprintData = project[sid];
            if (!sprintData?.tasks) continue;
            for (const t of sprintData.tasks) {
                if (String(t?._id) === targetId) return { task: t, pid, sprintId: sid };
                if (Array.isArray(t?.subtaskArray)) {
                    const sub = t.subtaskArray.find((s) => String(s?._id) === targetId);
                    if (sub) return { task: sub, pid, sprintId: sid };
                }
            }
        }
    }
    return null;
}

// Apply `deletedStatusKey` change to every selected task in the store,
// plus decrement sprint task counts (matches TaskDetailAction.vue:417-425
// flow). Called BEFORE the API request so the UI updates instantly.
function applyOptimisticDeletedStatus(taskIds, newDeletedStatusKey) {
    const affectedTaskRefs = [];
    for (const id of taskIds) {
        const found = findTaskInStore(id);
        if (!found) continue;
        affectedTaskRefs.push(found);
        commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null,
            op: 'modified',
            pid: found.pid,
            sprintId: found.sprintId,
            data: { ...found.task, deletedStatusKey: newDeletedStatusKey },
            updatedFields: { deletedStatusKey: newDeletedStatusKey },
        });
    }
    updateSprintCounts(affectedTaskRefs, newDeletedStatusKey);
}

// Generic optimistic field update — used by status / priority / due date.
// `fieldsFor(task)` returns the partial doc to merge; this matches the
// pattern in TaskOperations/index.js where the store is updated before the
// API call so the user sees the change immediately.
function applyOptimisticFields(taskIds, fieldsFor) {
    for (const id of taskIds) {
        const found = findTaskInStore(id);
        if (!found) continue;
        const updatedFields = fieldsFor(found.task) || {};
        if (!Object.keys(updatedFields).length) continue;
        commit('projectData/mutateUpdateFirebaseTasks', {
            snap: null,
            op: 'modified',
            pid: found.pid,
            sprintId: found.sprintId,
            data: { ...found.task, ...updatedFields },
            updatedFields,
        });
    }
}

// Mirrors single-task structural.js sprint count logic per task,
// then writes the sprints back via mutateSprints so the sidebar updates.
function updateSprintCounts(refs, newDeletedStatusKey) {
    const project = projectData?.value;
    if (!project) return;
    const touchedSprints = new Map(); // key -> sprint obj reference

    for (const { task } of refs) {
        if (!task) continue;
        const folderId = task.folderObjId || '';
        const sid = String(task.sprintId);
        const sprint = folderId
            ? project.sprintsfolders?.[folderId]?.sprintsObj?.[sid]
            : project.sprintsObj?.[sid];
        if (!sprint) continue;

        const taskUnits = task.isParentTask ? ((task.subTasks || 0) + 1) : 1;
        const prevDsk = task.deletedStatusKey || 0;

        // Adjust tasks / archiveTaskCount per the structural.js rules.
        if (newDeletedStatusKey === 2 && prevDsk === 0) {
            sprint.tasks = (sprint.tasks || 0) - taskUnits;
            sprint.archiveTaskCount = (sprint.archiveTaskCount || 0) + taskUnits;
        } else if (newDeletedStatusKey === 1 && prevDsk === 2) {
            sprint.archiveTaskCount = (sprint.archiveTaskCount || 0) - taskUnits;
        } else if (newDeletedStatusKey === 1 && prevDsk !== 2) {
            sprint.tasks = (sprint.tasks || 0) - taskUnits;
        } else if (newDeletedStatusKey === 0 && prevDsk === 2) {
            sprint.tasks = (sprint.tasks || 0) + taskUnits;
            sprint.archiveTaskCount = (sprint.archiveTaskCount || 0) - taskUnits;
        }

        touchedSprints.set(`${folderId}::${sid}`, sprint);
    }

    for (const sprint of touchedSprints.values()) {
        commit('projectData/mutateSprints', { op: 'modified', data: { ...sprint } });
    }
}

// --------------------------------------------------------------------------
// Toast / response handling.
// --------------------------------------------------------------------------
function reportResult(action, response) {
    const data = response?.data?.data || response?.data || {};
    const totals = data?.totals || {};
    const updated = totals.updated ?? (Array.isArray(data?.updated) ? data.updated.length : 0);
    const skipped = totals.skipped ?? (Array.isArray(data?.skipped) ? data.skipped.length : 0);
    const errors = totals.errors ?? (Array.isArray(data?.errors) ? data.errors.length : 0);

    let msg = `Updated ${updated} ${updated === 1 ? 'task' : 'tasks'}`;
    if (skipped) {
        const reasons = Array.isArray(data?.skipped) ? data.skipped.map((s) => s?.reason).filter(Boolean) : [];
        const reasonCount = reasons.reduce((acc, r) => { acc[r] = (acc[r] || 0) + 1; return acc; }, {});
        const topReason = Object.entries(reasonCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        const reasonLabel = ({
            permission: 'insufficient permission',
            'not-found-or-cross-tenant': 'not found or access denied',
            'project-not-found': 'project not found',
            'invalid-id': 'invalid id',
            'invalid-type': 'invalid operation',
        })[topReason] || topReason || 'skipped';
        msg += ` — ${skipped} skipped (${reasonLabel})`;
    }
    if (errors) msg += ` — ${errors} failed`;
    if (errors || skipped) $toast.warning(msg);
    else $toast.success(msg);
}

async function runBulk(action, payload, { optimisticDeletedStatus, optimisticFields, onSuccess } = {}) {
    if (isWorking.value) return;
    closeMenu();
    isWorking.value = true;
    const ids = [...selection.selectedTaskIds.value];

    // Optimistic UI updates BEFORE the API call so rows disappear / counts
    // drop / values change instantly — same pattern as single-task flow.
    if (typeof optimisticDeletedStatus === 'number') {
        applyOptimisticDeletedStatus(ids, optimisticDeletedStatus);
    }
    if (typeof optimisticFields === 'function') {
        applyOptimisticFields(ids, optimisticFields);
    }

    try {
        const body = {
            action,
            taskIds: ids,
            userData: buildUserData(),
            ...payload,
        };
        const response = await apiRequest('post', env.V2_TASKS_BULK, body);
        if (response?.data?.status === false) {
            $toast.error(response?.data?.statusText || `Bulk ${action} failed`);
            return;
        }
        reportResult(action, response);
        if (typeof onSuccess === 'function') { try { onSuccess(response); } catch (e) { /* post-success hook is best-effort */ } }
        selection.clear();
    } catch (error) {
        $toast.error(error?.message || `Bulk ${action} failed`);
    } finally {
        isWorking.value = false;
        showDeleteConfirm.value = false;
        showArchiveConfirm.value = false;
    }
}

function onStatusPick(status) {
    if (!status?.key) return;
    const newStatus = {
        status: { key: status.key, value: '', text: status.name, type: status.type, bgColor: status.bgColor, textColor: status.textColor },
        statusKey: status.key,
        statusType: status.type,
    };
    runBulk('bulkUpdateStatus', { newStatus }, {
        optimisticFields: () => newStatus,
    });
}

function performDelete() {
    runBulk('bulkDelete', {}, { optimisticDeletedStatus: 1 });
}

function performArchive() {
    runBulk('bulkArchive', {}, { optimisticDeletedStatus: 2 });
}

// Bulk move — the sidebar hands back the destination project + sprint. We only
// send the destination; the backend derives each task's source sprint, preserves
// assignees/watchers, and auto-maps status/type for cross-project moves.
//
// Real-time counts, mirroring single-move (ConvertToSubTaskSidebar.moveTask):
//   • Board task cards + per-status counts reconcile through the per-task socket
//     `update` events the backend emits — same as single-move, whose
//     taskClass.moveTask is API-only and relies on the socket too.
//   • Sidebar sprint-count badges are NOT socket-driven, so — exactly like
//     single-move — adjust them by hand: decrement each source sprint and
//     increment the destination via mutateSprints. A bulk selection can span
//     several source sprints, so snapshot each task's source sprint BEFORE the
//     move and group the units (parent task counts itself + its subtasks).
function onBulkMoveConfirm({ project, sprint } = {}) {
    if (!project || !sprint || !sprint.id) return;
    showMove.value = false;

    const proj = projectData?.value;
    const sourceGroups = new Map(); // `${folderId}::${sprintId}` -> { ref, units }
    let totalUnits = 0;
    for (const id of selection.selectedTaskIds.value) {
        const t = findTaskInStore(id)?.task;
        if (!t) continue;
        const folderId = t.folderObjId || '';
        const sid = String(t.sprintId);
        const ref = folderId
            ? proj?.sprintsfolders?.[folderId]?.sprintsObj?.[sid]
            : proj?.sprintsObj?.[sid];
        if (!ref) continue;
        const units = t.isParentTask ? ((t.subTasks || 0) + 1) : 1;
        const key = `${folderId}::${sid}`;
        const g = sourceGroups.get(key) || { ref, units: 0 };
        g.units += units;
        sourceGroups.set(key, g);
        totalUnits += units;
    }

    runBulk('bulkMove', {
        projectData: {
            id: project._id,
            ProjectCode: project.ProjectCode,
            ProjectName: project.ProjectName,
        },
        sprintObj: sprint,
        isSubTask: false,
    }, {
        onSuccess: () => {
            // Decrement each source sprint badge (mirrors single-move's
            // moveTaskSprint.tasks -= sprintCount).
            for (const { ref, units } of sourceGroups.values()) {
                ref.tasks = (ref.tasks || 0) - units;
                commit('projectData/mutateSprints', { op: 'modified', data: { ...ref } });
            }
            // Increment the destination sprint badge (mirrors
            // selectedSprint.tasks + sprintCount).
            const destFolderId = sprint.folderId || '';
            const destSid = String(sprint.id);
            const destRef = destFolderId
                ? proj?.sprintsfolders?.[destFolderId]?.sprintsObj?.[destSid]
                : proj?.sprintsObj?.[destSid];
            if (destRef && totalUnits) {
                destRef.tasks = (destRef.tasks || 0) + totalUnits;
                commit('projectData/mutateSprints', { op: 'modified', data: { ...destRef } });
            }
        },
    });
}

function onPriorityPick(priority) {
    if (!priority || priority.value === undefined || priority.value === null) return;
    runBulk(
        'bulkUpdatePriority',
        {
            firebaseObj: { Task_Priority: priority.value },
            priorityObj: { priorityName: priority.name, newPriorityName: priority.name },
        },
        { optimisticFields: () => ({ Task_Priority: priority.value }) }
    );
}

// Add or remove a single assignee across the whole selection. We honor
// the MultipleAssignees app flag the same way single-task does: when the
// app is enabled, "add" appends; otherwise it replaces.
function onAssigneeAct(action, user) {
    if (!user?.id) return;
    const multi = checkApps ? checkApps('MultipleAssignees', projectData?.value) : true;
    const type = action === 'add' ? (multi ? 'assigneeAdd' : 'replace') : 'assigneRemove';
    const uid = String(user.id);
    runBulk(
        'bulkUpdateAssignee',
        { type, employeeId: [uid], employeeName: user.label || '' },
        {
            // Optimistic per-task assignee update mirroring the backend
            // $addToSet / $pull / $set semantics.
            optimisticFields: (task) => {
                const current = Array.isArray(task.AssigneeUserId)
                    ? task.AssigneeUserId.map(String)
                    : [];
                if (type === 'assigneeAdd') {
                    if (current.includes(uid)) return {};
                    return { AssigneeUserId: [...current, uid] };
                }
                if (type === 'assigneRemove') {
                    if (!current.includes(uid)) return {};
                    return { AssigneeUserId: current.filter((x) => x !== uid) };
                }
                return { AssigneeUserId: [uid] };
            },
        }
    );
}

// DueDateCompo emits `{ dateVal, id }` from CalenderCompo when the user
// picks a date in the calendar popup.
function onDueDateSelected(event) {
    const date = event?.dateVal;
    if (!date) return;
    runBulk('bulkUpdateDueDate', { DueDate: date }, {
        optimisticFields: (task) => {
            const existing = Array.isArray(task.dueDateDeadLine) ? task.dueDateDeadLine : [];
            return {
                DueDate: new Date(date),
                dueDateDeadLine: [...existing, { date: new Date(date) }],
            };
        },
    });
}
function onDueClear() {
    runBulk('bulkUpdateDueDate', { DueDate: null }, {
        optimisticFields: () => ({ DueDate: null }),
    });
}

function onTagAct(operation, tag) {
    const tagId = tag?.uid || tag?._id || tag?.id;
    if (!tagId) return;
    runBulk('bulkUpdateTags', { tagId, operation }, {
        // Single-task does the same store update inside taskClass.updateTags
        // before sending the request (see TaskOperations/index.js:424).
        optimisticFields: (task) => {
            const current = Array.isArray(task.tagsArray) ? task.tagsArray.map(String) : [];
            if (operation === 'add') {
                if (current.includes(String(tagId))) return {};
                return { tagsArray: Array.from(new Set([...current, String(tagId)])) };
            }
            if (!current.includes(String(tagId))) return {};
            return { tagsArray: current.filter((id) => id !== String(tagId)) };
        },
    });
}
</script>

<style scoped>
.bulk-action-bar {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    background: #2b2b35;
    color: #fff;
    padding: 10px 18px;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    z-index: 1000;
    min-width: 760px;
    max-width: calc(100vw - 32px);
    font-size: 13px;
}

.bulk-action-bar--compact {
    bottom: 0;
    left: 0;
    right: 0;
    transform: none;
    width: 100%;
    min-width: 0;
    max-width: none;
    border-radius: 14px 14px 0 0;
    padding: 10px 12px;
    overflow-x: auto;
    flex-wrap: nowrap;
    gap: 8px;
}
.bulk-action-bar--compact .bulk-action-bar__btn {
    padding: 6px 10px;
    font-size: 12px;
    white-space: nowrap;
}

@media (max-width: 1024px) and (min-width: 768px) {
    .bulk-action-bar { min-width: 0; }
    /* Hide the three lowest-priority menus on tablet width
       (Assignees, Due date, Tags). Status / Priority / Delete / Archive
       remain visible. */
    .bulk-action-bar > .bulk-menu:nth-of-type(3),
    .bulk-action-bar > .bulk-menu:nth-of-type(4),
    .bulk-action-bar > .bulk-menu:nth-of-type(5) {
        display: none;
    }
}

.bulk-action-bar__count {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    padding: 0 4px;
}
.bulk-action-bar__count-number {
    font-size: 16px;
    font-weight: 700;
}
.bulk-action-bar__count-label {
    font-size: 11px;
    color: #b9b9c5;
}

.bulk-action-bar__divider {
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 2px;
}

.bulk-action-bar__btn {
    appearance: none;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #fff;
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
    white-space: nowrap;
}
.bulk-action-bar__btn:hover:not(.bulk-action-bar__btn--disabled):not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.22);
}
.bulk-action-bar__btn--danger:hover:not(.bulk-action-bar__btn--disabled):not(:disabled) {
    background: #c5343a;
    border-color: #c5343a;
}
.bulk-action-bar__btn--disabled,
.bulk-action-bar__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.bulk-action-bar__btn--inline {
    border-color: #d6d6d6;
    color: #444;
}
.bulk-action-bar__btn--inline:hover:not(:disabled) {
    background: #f4f5f7;
    border-color: #c8c8c8;
}

.bulk-action-bar__close {
    appearance: none;
    background: transparent;
    border: none;
    color: #b9b9c5;
    cursor: pointer;
    padding: 4px 8px;
    font-size: 14px;
    line-height: 1;
}
.bulk-action-bar__close:hover {
    color: #fff;
}

.bulk-status-option {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
}
/* Status/priority list item: pill on a flat button, hover lifts the bg. */
.bulk-menu__scroll .bulk-menu__item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 6px 8px;
    margin: 2px 0;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s ease;
}
.bulk-menu__scroll .bulk-menu__item:hover {
    background: #f4f5f7;
}
/* ---------- Modern menu surfaces (search, rows, icons) ---------- */

/* Search at the top of every list-based menu. */
.bulk-menu__search {
    padding: 10px 12px 6px;
    flex-shrink: 0;
}
.bulk-menu__search-input {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 13px;
    color: #2b2b35;
    background: #f8f9fb;
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}
.bulk-menu__search-input:focus {
    border-color: #8591F9;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(133, 145, 249, 0.18);
}
.bulk-menu__search-input::placeholder { color: #9aa0a6; }

/* Scrollable list container. */
.bulk-menu__scroll {
    overflow-y: auto;
    max-height: 280px;
    padding: 4px 6px 6px;
}
.bulk-menu__empty {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #9aa0a6;
}

/* Generic row + clickable variant. */
.bulk-menu__row {
    border-radius: 8px;
}
.bulk-menu__row--clickable {
    width: 100%;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.bulk-menu__row--clickable:hover {
    background: #f4f5f7;
}
.bulk-menu__row--selected {
    background: #eef0ff;
}
.bulk-menu__row--selected:hover {
    background: #e3e6ff;
    cursor: default;
}

/* User row */
.bulk-menu__user-info {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
}
.bulk-menu__avatar-wrap {
    flex-shrink: 0;
}
.bulk-menu__avatar-wrap :deep(.profile-image) {
    border-radius: 50%;
    object-fit: cover;
}

/* Selected row's remove (×) icon. Renders only when row is in some/all. */
.bulk-menu__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: #6b7280;
    background: transparent;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
    flex-shrink: 0;
}
.bulk-menu__remove:hover {
    background: #fde4e6;
    color: #c5343a;
}

/* "partial" pill for tri-state — shown when only some selected tasks have it. */
.bulk-menu__partial-pill {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 500;
    background: #fff3d6;
    color: #b07000;
    letter-spacing: 0.2px;
}

/* Tag chip inside the tags menu — small colored pill matching the row look. */
.bulk-tag-chip {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
}

/* Subtle hint shown above options inside menus. */
.bulk-menu__hint {
    font-size: 11px;
    color: #888;
    padding: 10px 14px 4px;
}

/* ---------- Due date picker ---------- */
.bulk-due-content {
    padding: 6px 12px 8px;
}
.bulk-due-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #f8f9fb;
    transition: border-color 0.15s ease, background-color 0.15s ease;
    padding: 0 10px;
    height: 38px;
}
.bulk-due-input-wrap:focus-within {
    border-color: #8591F9;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(133, 145, 249, 0.18);
}
.bulk-due-icon {
    color: #6b7280;
    flex-shrink: 0;
    margin-right: 8px;
}
/* Strip the underlying DueDateCompo's default input styling so it
   inherits the wrapper's look — and let it own the full width.
   Center-align both the input text and its placeholder. */
.bulk-due-input-wrap :deep(.due-date),
.bulk-due-input-wrap :deep(.calendar-comp),
.bulk-due-input-wrap :deep(input.date_format_cal),
.bulk-due-input-wrap :deep(.dp__input) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    padding: 0 !important;
    margin: 0 !important;
    height: 100% !important;
    width: auto !important;
    font-size: 13px;
    color: #2b2b35;
    background-image: none !important;
    text-align: center !important;
}
.bulk-due-input-wrap :deep(.due-date) {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
}
.bulk-due-input-wrap :deep(input.date_format_cal::placeholder),
.bulk-due-input-wrap :deep(.dp__input::placeholder) {
    text-align: center;
    color: #9aa0a6;
}

.bulk-due-clear {
    appearance: none;
    background: transparent;
    border: none;
    border-top: 1px solid #f0f0f4;
    color: #c5343a;
    cursor: pointer;
    padding: 8px 14px 10px;
    font-size: 12px;
    text-align: left;
    width: 100%;
    margin-top: 4px;
    transition: background-color 0.15s ease;
}
.bulk-due-clear:hover {
    background: #fff5f5;
}

.bulk-bar-fade-enter-active,
.bulk-bar-fade-leave-active {
    transition: opacity 0.18s ease, transform 0.18s ease;
}
.bulk-bar-fade-enter-from,
.bulk-bar-fade-leave-to {
    opacity: 0;
    transform: translate(-50%, 16px);
}
.bulk-action-bar--compact.bulk-bar-fade-enter-from,
.bulk-action-bar--compact.bulk-bar-fade-leave-to {
    transform: translateY(16px);
}
</style>
