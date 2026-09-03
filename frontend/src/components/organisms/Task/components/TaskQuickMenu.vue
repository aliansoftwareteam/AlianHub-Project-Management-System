<template>
    <DropDown
        :title="task.TaskName"
        :bodyClass="{ 'tqm': true }"
        v-if="showArchiveVar ? task.deletedStatusKey === 2 : task.deletedStatusKey === 0"
    >
        <template #button>
            <img :ref="task._id+'options'" :src="horizontalDots" alt="horizontalDots" id="taskquickmenudriver">
        </template>
        <template #options>
            <div id="taskquickmenu_driver" class="tqm__list">
                <div class="ah-label tqm__label">{{ $t('MembersV2.quick_menu') }}</div>
                <DropDownOption @click="closeAnd($emit('copyLink'))" v-if="!showArchiveVar">
                    <span class="tqm__item">{{ $t('ProjectDetails.copy_task_link') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('copyKey'))" v-if="!showArchiveVar">
                    <span class="tqm__item">{{ $t('ProjectDetails.copy_task_key') }}</span>
                </DropDownOption>
                <DropDownOption v-if="(task.queueListArray == undefined || (task.queueListArray && task.queueListArray.indexOf(userId) == -1)) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && !showArchiveVar && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="closeAnd($emit('queue', 'add'))">
                    <span class="tqm__item">{{ $t('ProjectDetails.add_que_list') }}</span>
                </DropDownOption>
                <DropDownOption v-if="(task.queueListArray && task.queueListArray.indexOf(userId) !== -1) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && !showArchiveVar && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="closeAnd($emit('queue', 'remove'))">
                    <span class="tqm__item">{{ $t('ProjectDetails.remove_from_queue_list') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToSubTask'))" v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true && !showArchiveVar && task.isParentTask && checkPermission('task.task_convert_to_subtask',projectData.isGlobalPermission) === true">
                    <span class="tqm__item">{{ $t('ProjectDetails.convert_subtask') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToList'))" v-if="checkPermission('project.project_sprint_create',projectData.isGlobalPermission) === true && !showArchiveVar && checkPermission('task.task_convert_to_list',projectData.isGlobalPermission) === true">
                    <span class="tqm__item">{{ $t('ProjectDetails.convert_list') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToTask'))" v-if="task.isParentTask === false && checkPermission('task.task_create',projectData.isGlobalPermission) === true && checkPermission('task.convert_to_task',projectData.isGlobalPermission) === true && !showArchiveVar">
                    <span class="tqm__item">{{ $t('ProjectDetails.convert_task') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('duplicate'))" v-if="!showArchiveVar && checkPermission('task.task_duplicate',projectData.isGlobalPermission) === true">
                    <span class="tqm__item">{{ $t('Projects.duplicate') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('move'))" v-if="!showArchiveVar && checkPermission('task.task_move',projectData.isGlobalPermission) == true">
                    <span class="tqm__item">{{ $t('ProjectDetails.move') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('merge'))" v-if="!showArchiveVar && checkPermission('task.task_merge',projectData.isGlobalPermission) == true">
                    <span class="tqm__item">{{ $t('ProjectDetails.merge') }}</span>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('askAi'))" v-if="hasAiListener">
                    <span class="tqm__item tqm__item--ai">✦ {{ $t('MembersV2.ask_ai') }}</span>
                </DropDownOption>
                <DropDownOption v-if="(task.deletedStatusKey === undefined || task.deletedStatusKey === 0) && !showArchiveVar && checkPermission('task.task_archive',projectData.isGlobalPermission) == true" @click="closeAnd($emit('confirmArchive'))">
                    <span class="tqm__item">{{ $t('Projects.archive') }}</span>
                </DropDownOption>
                <DropDownOption v-if="task.deletedStatusKey === 2" @click="closeAnd($emit('restore'))">
                    <span class="tqm__item">{{ $t('Projects.restore') }}</span>
                </DropDownOption>
                <div class="tqm__sep" v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true"></div>
                <DropDownOption @click="closeAnd($emit('confirmDelete'))" v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true">
                    <span class="tqm__item tqm__item--danger">
                        {{ $t('Projects.delete') }}
                        <span class="tqm__hint">{{ $t('MembersV2.admin_only') }}</span>
                    </span>
                </DropDownOption>
            </div>
        </template>
    </DropDown>
</template>

<script setup>
import { computed, getCurrentInstance, defineProps, defineEmits } from 'vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import { useCustomComposable } from '@/composable';

const { checkPermission } = useCustomComposable();

const props = defineProps({
    task: { type: Object, required: true },
    projectData: { type: Object, required: true },
    showArchiveVar: { type: Boolean, default: false },
    userId: { type: String, default: '' },
});

defineEmits([
    'copyLink',
    'copyKey',
    'queue',
    'confirmArchive',
    'restore',
    'confirmDelete',
    'convertToSubTask',
    'convertToList',
    'duplicate',
    'move',
    'merge',
    'convertToTask',
    'askAi',
]);

const instance = getCurrentInstance();

// The AI entry only appears where a parent actually wired it up; an item that
// does nothing is worse than no item.
const hasAiListener = computed(() => !!instance?.vnode?.props?.onAskAi);

function closeAnd() {
    const ref = instance?.proxy?.$refs?.[props.task._id + 'options'];
    if (ref && typeof ref.click === 'function') {
        ref.click();
    }
}

const horizontalDots = require('@/assets/images/svg/horizontalDots.svg');
</script>

<style>
.tqm .drop-down-options { padding: 0; }
.tqm__list { display: flex; flex-direction: column; gap: 1px; min-width: 196px; }
.tqm__label { padding: 5px 9px; }
.tqm__list .drop-down-item {
    padding: 7px 9px !important;
    border-radius: 6px;
    color: var(--ink);
    font: 400 12.5px/1.2 var(--font-ui);
}
.tqm__item { display: flex; align-items: center; width: 100%; }
.tqm__item--ai { color: var(--brand); font-weight: 600; }
.tqm__item--danger { color: var(--danger); }
.tqm__hint { margin-left: auto; font: 500 10px/1 var(--font-mono); color: var(--ink-3); }
.tqm__sep { height: 1px; background: var(--hairline); margin: 3px 0; }
</style>
