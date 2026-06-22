<template>
    <span
        class="text-ellipse d-block text-center custom-ellipse-text"
        :title="displayValue === '—' ? '' : String(displayValue)"
    >
        {{ displayValue }}
    </span>
</template>

<script setup>
    import { computed } from "vue";
    import { computeCustomFieldValue } from '@/plugins/customFieldView/formulaEngine.js';

    const props = defineProps({
        // Custom field definition (has fieldType, formulaExpression, rollupSourceFieldId, rollupFunction).
        def:{
            type:Object,
            default:() => {}
        },
        // The task this cell belongs to.
        task:{
            type:Object,
            default:() => {}
        },
        // Flat task list (incl. subtasks) for rollup aggregation.
        allTasks:{
            type:Array,
            default:() => []
        },
        // All custom field definitions (used to resolve {Title} references in formulas).
        defs:{
            type:Array,
            default:() => []
        }
    });

    const displayValue = computed(() => {
        const val = computeCustomFieldValue(props.def, props.task, props.allTasks, props.defs);
        return (val === '' || val === null || val === undefined) ? '—' : val;
    });
</script>
