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
                    @mousedown.stop="onTitlePointerDown($event)"
                    @click.stop="startEditName($event)"
                >
                    {{ taskName }}
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
                        @keydown="onTitleKey"
                        @enter="$emit('update:taskName', editTaskName), isEditName = false"
                        height="25px"
                        :isOutline="false"
                    />
                </span>
                <img
                    v-if="!isEditName && !isSupport"
                    src="@/assets/images/copy.png"
                    class="copy-icon cursor-pointer"
                    @click="copyText(taskName)"
                />
            </li>
        </ul>
    </div>
</template>
<script setup>
    import { useCustomComposable } from '@/composable';
    import { computed, defineProps, defineEmits, defineExpose, inject, onBeforeUnmount, onMounted, ref } from 'vue';
    import { clickFromTab, ignoreTaskBackdrop, wasRecentTabPointer } from '@/utils/taskPanelGuard';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { useToast } from 'vue-toast-notification';
    import ProjectTaskType from "@/components/atom/TaskTypeSelection/TaskTypeSelection.vue"

    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const { checkPermission } = useCustomComposable();

    defineEmits(["update:taskName", "update:favourite", "update:taskType"])
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
    const titlePointerDown = ref(false);

    const onTitlePointerDown = (event) => {
        titlePointerDown.value = Boolean(
            event
            && event.button === 0
            && event.target === event.currentTarget
        );
    };

    const startEditName = (event) => {
        const armed = titlePointerDown.value;
        titlePointerDown.value = false;
        if (!armed) return;
        if (!event || event.type !== 'click') return;
        if (event.target !== event.currentTarget) return;
        if (event.defaultPrevented) return;
        if (Number(event.detail) < 1) return;
        if (clickFromTab(event) || wasRecentTabPointer() || ignoreTaskBackdrop(1500)) return;
        isEditName.value = true;
        editTaskName.value = props.taskName;
    };

    const editFocusOut = () => {
        if(isEditName.value) {
            isEditName.value = false;
        }
        editTaskName.value = '';
    }

    const onTitleKey = (payload) => {
        const event = payload && payload.event;
        if (!event || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        isEditName.value = false;
        editTaskName.value = '';
    };

    const cancelEdit = () => {
        titlePointerDown.value = false;
        isEditName.value = false;
        editTaskName.value = '';
    };

    onMounted(() => {
        document.addEventListener('kiln-task-tab', cancelEdit);
    });
    onBeforeUnmount(() => {
        document.removeEventListener('kiln-task-tab', cancelEdit);
    });

    defineExpose({
        isEditing: isEditName,
        cancelEdit,
    });

    const copyText = (text) => {
        $toast.success(t(`Toast.Task_name_copied`), {position: "top-right"})
        navigator.clipboard.writeText(text);
    }
</script>
<style src="./style.css"></style>