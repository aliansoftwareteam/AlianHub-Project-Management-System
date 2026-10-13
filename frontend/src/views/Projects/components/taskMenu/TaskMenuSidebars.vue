<template>
    <ConvertToList v-if="mode === 'convert-list'" :openSidebar="true" :task="task" @closeSidebar="$emit('close')" />
    <ConvertToSubTaskSidebar
        v-else-if="mode"
        :closeSideBar="true"
        :isOpenSubTask="mode === 'convert-subtask'"
        :isMoveTask="mode === 'move' && task.isParentTask === true"
        :openMoveSubTask="mode === 'move' && task.isParentTask === false"
        :isMergeTask="mode === 'merge'"
        :isDuplicate="mode === 'duplicate'"
        :task="task"
        @isConvertSubtaskOPen="$emit('close')"
    />
</template>

<script setup>
import ConvertToSubTaskSidebar from "@/components/molecules/ConvertToSubTaskSidebar/ConvertToSubTaskSidebar.vue";
import ConvertToList from "@/components/molecules/ConvertToList/ConvertToList.vue";

defineOptions({ name: "TaskMenuSidebars" });

defineProps({
    mode: { type: String, default: null },
    task: { type: Object, default: () => ({}) }
});
defineEmits(["close"]);
</script>
