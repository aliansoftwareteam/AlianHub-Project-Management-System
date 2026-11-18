<template>
    <header class="ah-toolbar rpt__toolbar">
        <h1 class="ah-toolbar__title">{{ title }}</h1>
        <span v-if="$slots.meta" class="rpt__meta"><slot name="meta" /></span>
        <TimesheetTabs v-if="tab" :active="tab" />
        <span class="ah-toolbar__spacer"></span>
        <div class="rpt__actions">
            <slot name="actions" />
            <ReportExportMenu v-if="exportable" :busy="exporting" :disabled="!canExport" :extra="exportExtra" @export="(format) => $emit('export', format)" />
        </div>
    </header>
</template>

<script setup>
import TimesheetTabs from '@/views/Timesheet/TimesheetTabs.vue';
import ReportExportMenu from './ReportExportMenu.vue';
import './report.css';

defineOptions({ name: 'ReportToolbar' });

defineProps({
    title: { type: String, required: true },
    tab: { type: String, default: '' },
    exportable: { type: Boolean, default: true },
    exporting: { type: Boolean, default: false },
    canExport: { type: Boolean, default: true },
    exportExtra: { type: Array, default: () => [] },
});
defineEmits(['export']);
</script>
