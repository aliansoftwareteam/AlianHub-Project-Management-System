<template>
    <span class="ah-detail__trail">
        <template v-for="(row, index) in ancestors" :key="row._id">
            <span v-if="index" class="ah-detail__crumb-sep" aria-hidden="true">›</span>
            <button type="button" class="ah-detail__crumb-link" :title="row.TaskName" @click="$emit('open', row)">{{ row.TaskName }}</button>
        </template>
        <template v-if="current">
            <span class="ah-detail__crumb-sep" aria-hidden="true">›</span>
            <span class="ah-detail__crumb-current" aria-current="page" :title="current">{{ current }}</span>
        </template>
    </span>
</template>

<script setup>
defineOptions({ name: "TaskAncestorTrail" });

defineProps({
    ancestors: { type: Array, required: true },
    current: { type: String, default: "" }
});
defineEmits(["open"]);
</script>
