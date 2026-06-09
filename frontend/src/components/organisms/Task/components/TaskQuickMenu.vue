<template>
    <DropDown :title="task.TaskName" v-if="showArchiveVar ? task.deletedStatusKey === 2 : task.deletedStatusKey === 0">
        <template #button>
            <img :ref="task._id+'options'" :src="horizontalDots" alt="horizontalDots" id="taskquickmenudriver">
        </template>
        <template #options>
            <div id="taskquickmenu_driver">
                <DropDownOption @click="closeAnd($emit('copyLink'))" v-if="!showArchiveVar">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="linkIcon" alt="inventoryIcon">
                        <span>{{ $t('ProjectDetails.copy_task_link') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('copyKey'))" v-if="!showArchiveVar">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="splitScreen" alt="inventoryIcon">
                        <span>{{ $t('ProjectDetails.copy_task_key') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption v-if="(task.queueListArray == undefined || (task.queueListArray && task.queueListArray.indexOf(userId) == -1)) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && !showArchiveVar && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="closeAnd($emit('queue', 'add'))">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="cancelIcon" alt="addIcon">
                        <span>{{ $t('ProjectDetails.add_que_list') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption v-if="(task.queueListArray && task.queueListArray.indexOf(userId) !== -1) && (task.AssigneeUserId && task.AssigneeUserId.indexOf(userId) !== -1) && !showArchiveVar && checkPermission('task.queue_list',projectData.isGlobalPermission) == true" @click="closeAnd($emit('queue', 'remove'))">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="cancelIcon" alt="addIcon">
                        <span>{{ $t('ProjectDetails.remove_from_queue_list') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption v-if="(task.deletedStatusKey === undefined || task.deletedStatusKey === 0) && !showArchiveVar && checkPermission('task.task_archive',projectData.isGlobalPermission) == true" @click="closeAnd($emit('confirmArchive'))">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="inventoryIcon" alt="inventoryIcon">
                        <span>{{ $t('Projects.archive') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption v-if="task.deletedStatusKey === 2" @click="closeAnd($emit('restore'))">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="inventoryIcon" alt="restoreInventoryIcon">
                        <span>{{ $t('Projects.restore') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('confirmDelete'))" v-if="checkPermission('task.task_delete',projectData.isGlobalPermission) == true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="deleteIcon" alt="deleteIcon">
                        <span>{{ $t('Projects.delete') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToSubTask'))" v-if="checkPermission('task.sub_task_create',projectData.isGlobalPermission) === true && !showArchiveVar && task.isParentTask && checkPermission('task.task_convert_to_subtask',projectData.isGlobalPermission) === true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="subTaskIcon" alt="deleteIcon">
                        <span>{{ $t('ProjectDetails.convert_subtask') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToList'))" v-if="checkPermission('project.project_sprint_create',projectData.isGlobalPermission) === true && !showArchiveVar && checkPermission('task.task_convert_to_list',projectData.isGlobalPermission) === true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="combinedIcon"/>
                        <span>{{ $t('ProjectDetails.convert_list') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('duplicate'))" v-if="!showArchiveVar && checkPermission('task.task_duplicate',projectData.isGlobalPermission) === true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="copyIcon" class="copyIcon"/>
                        <span>{{ $t('Projects.duplicate') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('move'))" v-if="!showArchiveVar && checkPermission('task.task_move',projectData.isGlobalPermission) == true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="moveIcon"/>
                        <span>{{ $t('ProjectDetails.move') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('merge'))" v-if="!showArchiveVar && checkPermission('task.task_merge',projectData.isGlobalPermission) == true">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="mergeIcon"/>
                        <span>{{ $t('ProjectDetails.merge') }}</span>
                    </div>
                </DropDownOption>
                <DropDownOption @click="closeAnd($emit('convertToTask'))" v-if="task.isParentTask === false && checkPermission('task.task_create',projectData.isGlobalPermission) === true && checkPermission('task.convert_to_task',projectData.isGlobalPermission) === true && !showArchiveVar">
                    <div class="d-flex align-items-center task_desc_icon">
                        <img :src="mergeIcon"/>
                        <span>{{ $t('ProjectDetails.convert_task') }}</span>
                    </div>
                </DropDownOption>
            </div>
        </template>
    </DropDown>
</template>

<script setup>
import { getCurrentInstance, defineProps, defineEmits } from 'vue';
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
]);

const instance = getCurrentInstance();

function closeAnd() {
    // Close the menu by clicking the trigger ref (kept for parity with original `$refs[task._id+'options'].click()`)
    const ref = instance?.proxy?.$refs?.[props.task._id + 'options'];
    if (ref && typeof ref.click === 'function') {
        ref.click();
    }
}

const horizontalDots = require('@/assets/images/svg/horizontalDots.svg');
const inventoryIcon = require('@/assets/images/inventory_2.png');
const deleteIcon = require('@/assets/images/DeleteIcon.png');
const linkIcon = require('@/assets/images/png/link.png');
const splitScreen = require('@/assets/images/png/splitscreen.png');
const subTaskIcon = require('@/assets/images/png/subTaskIcon.png');
const moveIcon = require('@/assets/images/png/moveIcon.png');
const mergeIcon = require('@/assets/images/png/mergeIcon.png');
const combinedIcon = require('@/assets/images/png/Combined_shape.png');
const copyIcon = require('@/assets/images/copy.png');
const cancelIcon = require('@/assets/images/svg/arrow_circle_up.svg');
</script>
