<template>
    <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'">
        <div class="formkit-wrapper">
            <div class="formkit-label__wrapper">
                <label class="formkit-label">
                    <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                    <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                </label>
                <span>
                    <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                </span>
            </div>
            <div class="formkit-inner pointer-event-none">
                <span class="formkit-input d-block">{{ displayValue }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { computed } from "vue";
    import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
    import useCustomFieldImage from '@/composable/customFieldIcon.js';

    const { getImageData } = useCustomFieldImage();
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        },
        isProjectDetail:{
            type: String,
            default: ''
        }
    });
    const emit = defineEmits(['handleEdit']);
    const editIconImage = require("@/assets/images/editing.png");

    const displayValue = computed(() => {
        const val = props.detail?.fieldValue;
        return (val === '' || val === null || val === undefined) ? '—' : val;
    });

    const handleEdit = () => {
        emit('handleEdit', props?.detail);
    };
</script>
