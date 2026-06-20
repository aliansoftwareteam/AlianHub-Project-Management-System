<template>
    <button class="btn-white border ts-export-btn" :disabled="busy" @click="exportCsv" v-if="hasPeriod">
        {{ busy ? $t('TimesheetExport.exporting') : $t('TimesheetExport.export_csv') }}
    </button>
</template>

<script setup>
import { ref, computed } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// TIME-04 — downloads a payroll CSV of the time entries for the selected
// period + visible users (+ project filter), via /api/v1/timesheet/export-csv.
const props = defineProps({
    periodStart: { type: [Date, Number, String], default: null },
    periodEnd: { type: [Date, Number, String], default: null },
    userIds: { type: Array, default: () => [] },
    projectIds: { type: Array, default: () => [] },
});

const busy = ref(false);
const hasPeriod = computed(() => !!props.periodStart && !!props.periodEnd);
const apiDate = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const exportCsv = async () => {
    if (busy.value || !hasPeriod.value) return;
    busy.value = true;
    try {
        const s = new Date(props.periodStart); s.setHours(0, 0, 0, 0);
        const e = new Date(props.periodEnd); e.setHours(23, 59, 59, 999);
        const res = await apiRequest('post', `${env.TIMESHEET}/export-csv`, {
            userArray: props.userIds || [],
            projectArray: props.projectIds || [],
            start: Math.floor(s.getTime() / 1000),
            end: Math.floor(e.getTime() / 1000),
        });
        const data = res && res.data;
        const csv = typeof data === 'string' ? data : '';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timesheet-${apiDate(props.periodStart)}_${apiDate(props.periodEnd)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        // swallow — the button simply re-enables
    } finally {
        busy.value = false;
    }
};
</script>

<style scoped>
.ts-export-btn { padding: 4px 12px; border-radius: 6px; font-size: 13px; white-space: nowrap; color: #2F3990; }
.ts-export-btn[disabled] { opacity: .6; cursor: default; }
</style>
