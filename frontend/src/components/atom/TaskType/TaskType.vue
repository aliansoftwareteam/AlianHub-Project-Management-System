<template>
    <div :id="tourId">
        <DropDown :id="id">
            <template #button>
                <div :ref="id" :class="`task__type-width ${isBoardView ? `task__type-width-board` : `task__type-width-list`}`">
                    <slot name="head">
                        <TaskTypeIcon :taskType="modelValue" class="position-re vertical-middle task__image" />
                    </slot>
                </div>
            </template>

            <template #options>
                <DropDownOption v-for="(item, typeIndex) in options" :key="typeIndex" @click="$emit('update:modelValue', item), $emit('select', item,convertTaskType), $refs[id].click()">
                    <div class="d-flex align-items-center">
                        <TaskTypeIcon :taskType="item" :title="item?.name" class="task__type-image vertical-middle ml-6px" />
                        <span class="ml-5px" >{{item.name}}</span>
                    </div>
                </DropDownOption>
            </template>
        </DropDown>
    </div>
</template>

<script setup>
// PACKAGES
import {defineProps, defineEmits} from 'vue';

// COMPONENTS
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";

defineProps({
    id: {
        type: String,
        required: true
    },
    modelValue: {
        type: Object,
        required: true
    },
    options: {
        type: Array,
        required: true,
    },
    convertTaskType: {
        type: Object,
        default: () => ({})
    },
    isBoardView: {
        type: Boolean,
        default: false
    },
    tourId: {
        type: String,
        default: ''
    }
})

defineEmits(['update:modelValue', 'select'])
</script>

<style scoped>
.task__type-width{
    height:13px; 
    width:13px;
}
/* Task-list row task-type icon: a little smaller than the shared TaskTypeIcon default
   (17px library box + 2px padding). :deep() reaches the icon/box that TaskTypeIcon renders
   under its own scope; keyed to .task__image so only the list/board row icon shrinks — the
   dropdown options (.task__type-image) and other call sites keep their size. */
:deep(.task__image) {
    width: 14px;
    height: 14px;
    object-fit: contain;
    top: -2px;
}
:deep(.task__image.tticon--lib) {
    width: 14px !important;
    height: 14px !important;
}
:deep(.task__image.tticon__box) {
    padding: 1px;
}
.task__type-image{
    height:13px; 
    width:13px;
    object-fit: contain;                  
}
.task__type-width-list {
    margin-left: 20px;
}
@media(max-width: 480px){
    .task__type-width-list {
        margin-left: 10px;
    }
}
@media(max-width: 412px){
    .task__type-width-list {
        margin-left: 0px;
    }
}
</style>