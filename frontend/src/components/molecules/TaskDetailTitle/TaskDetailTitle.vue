<template>
    <div class="task-detail-title">
        <ul class="d-flex">
            <li class="task-name">
                <template v-if="!isSupport">
                    <ProjectTaskType
                        :id="'task_type_detail'"
                        :modelValue="taskTypeVal"
                        :options="selectedProject.taskTypeCounts"
                        :disabled="showArchiveVar && checkPermission('task.task_list',selectedProject.isGlobalPermission)!==true || checkPermission('task.task_type',selectedProject.isGlobalPermission) !== true || showArchiveVar !== false"
                        @select="$emit('update:taskType', $event)"
                    />
                </template>
                <template v-if="!isEditName">
                <h4 
                    v-if="checkPermission('task.task_name_edit',selectedProject?.isGlobalPermission) === true"
                    class="title-name"
                    :title="taskName"
                >
                    <button ref="titleButton" type="button" class="title-name__edit" @click="isEditName = true, editTaskName = taskName">{{ taskName }}</button>
                </h4>
                <h4 
                    v-else
                    class="title-name"
                    :title="taskName"
                >
                    {{ taskName }}
                </h4>
                </template>
                <span v-else class="task-name__edit">
                    <InputText
                        input-id="taskNameEdit"
                        v-model="editTaskName"
                        :is-direct-focus="true"
                        :max-length="250"
                        @blur="editFocusOut()"
                        :place-holder="$t('Projects.task_name')"
                        @enter="saveName"
                        @keydown="cancelOnEscape"
                        height="25px"
                        :isOutline="false"
                    />
                </span>
                <button
                    v-if="!isEditName && !isSupport"
                    type="button"
                    class="copy-icon__btn"
                    :aria-label="$t('TaskPanel.copy_title')"
                    :title="$t('TaskPanel.copy_title')"
                    @click="copyText(taskName)"
                >
                    <img src="@/assets/images/copy.png" alt="" class="copy-icon cursor-pointer" />
                </button>
            </li>
        </ul>
    </div>
</template>
<script setup>
    import { useCustomComposable } from '@/composable';
    import { computed, defineProps, defineEmits, inject, nextTick, ref } from 'vue';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { useToast } from 'vue-toast-notification';
    import ProjectTaskType from "@/components/atom/TaskTypeSelection/TaskTypeSelection.vue"

    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const { checkPermission } = useCustomComposable();

    const emit = defineEmits(["update:taskName", "update:favourite", "update:taskType"])
    const props = defineProps({
        favourites: Array,
        taskType: Number,
        taskName: String,
        isSupport: {
            type: Boolean,
            default: false
        }
    });

    const $toast = useToast();

    const editTaskName = ref('');
    const showArchiveVar = inject("showArchived");
    const selectedProject = inject("selectedProject");

    const taskTypeVal = computed(() => {
        return selectedProject.value?.taskTypeCounts?.find((x) => x?.key === props?.taskType)
    })

    const isEditName = ref(false);
    const titleButton = ref(null);

    // Only a keyboard exit returns focus: a blur means the user already moved it somewhere.
    const focusTitle = () => nextTick(() => titleButton.value?.focus());

    const saveName = () => {
        emit('update:taskName', editTaskName.value);
        isEditName.value = false;
        focusTitle();
    }

    // Marking Esc handled keeps the task overlay from also treating it as its own Esc.
    const cancelOnEscape = ({ event }) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        isEditName.value = false;
        editTaskName.value = '';
        focusTitle();
    }

    const editFocusOut = () => {
        if(isEditName.value) {
            isEditName.value = false;
        }
        editTaskName.value = '';
    }

    const copyText = (text) => {
        $toast.success(t(`Toast.Task_name_copied`), {position: "top-right"})
        navigator.clipboard.writeText(text);
    }
</script>
<style src="./style.css"></style>