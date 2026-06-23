<template>
    <div class="billable-summary d-flex align-items-center" v-if="hasData">
        <span class="bs-item bs-billable">
            <span class="bs-dot"></span>{{ $t('Billable.billable') }}: <b>{{ toHours(summary.billableMinutes) }}</b>
        </span>
        <span class="bs-item bs-nonbillable">
            <span class="bs-dot"></span>{{ $t('Billable.non_billable') }}: <b>{{ toHours(summary.nonBillableMinutes) }}</b>
        </span>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// TIME-02 — billable vs non-billable hours readout for the period + user set
// currently shown in the timesheet. companyId rides the request header.
const props = defineProps({
    periodStart: { type: [Date, Number, String], default: null },
    periodEnd: { type: [Date, Number, String], default: null },
    userIds: { type: Array, default: () => [] },
});

const summary = ref(null);
const hasData = computed(() => !!summary.value && Number(summary.value.totalMinutes) > 0);
const toHours = (mins) => {
    const m = Number(mins) || 0;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const load = async () => {
    if (!props.periodStart || !props.periodEnd || !(props.userIds && props.userIds.length)) {
        summary.value = null;
        return;
    }
    try {
        const s = new Date(props.periodStart); s.setHours(0, 0, 0, 0);
        const e = new Date(props.periodEnd); e.setHours(23, 59, 59, 999);
        const res = await apiRequest('post', `${env.TIMESHEET}/billable-summary`, {
            userArray: props.userIds,
            start: Math.floor(s.getTime() / 1000),
            end: Math.floor(e.getTime() / 1000),
        });
        const body = res && res.data;
        summary.value = body && body.status ? body.data : null;
    } catch (err) {
        summary.value = null;
    }
};

watch(() => [props.periodStart, props.periodEnd, props.userIds], load, { deep: true });
onMounted(load);
</script>

<style scoped>
.billable-summary { gap: 12px; }
.bs-item { font-size: 12px; color: #3a3f52; display: inline-flex; align-items: center; white-space: nowrap; }
.bs-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
.bs-billable .bs-dot { background: #1c7a43; }
.bs-nonbillable .bs-dot { background: #b06a00; }
.bs-item b { margin-left: 3px; color: #1f2330; }
</style>
