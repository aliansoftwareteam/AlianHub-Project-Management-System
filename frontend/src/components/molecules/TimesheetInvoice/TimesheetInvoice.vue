<template>
    <div class="ts-invoice d-flex align-items-center" v-if="hasPeriod">
        <input
            type="number"
            min="0"
            v-model.number="rate"
            class="form-control ts-rate-input"
            :title="$t('TimesheetInvoice.rate_hint')"
            :placeholder="$t('TimesheetInvoice.rate')"
        />
        <button class="btn-white border ts-inv-btn" :disabled="busy" @click="generate">
            {{ busy ? $t('TimesheetInvoice.generating') : $t('TimesheetInvoice.invoice') }}
        </button>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';

// TIME-07 — generate an invoice from billable time at configured rates (with an
// optional default hourly rate for unrated time) and download it as CSV.
const props = defineProps({
    periodStart: { type: [Date, Number, String], default: null },
    periodEnd: { type: [Date, Number, String], default: null },
    userIds: { type: Array, default: () => [] },
});

const { getUser } = useGetterFunctions();
const busy = ref(false);
const rate = ref(null);

const hasPeriod = computed(() => !!props.periodStart && !!props.periodEnd);
const apiDate = (d) => {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const userName = (id) => {
    const u = getUser(id);
    return (u && (u.Employee_Name || u.name)) || id || '';
};
const csvEscape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const generate = async () => {
    if (busy.value || !hasPeriod.value) return;
    busy.value = true;
    try {
        const s = new Date(props.periodStart); s.setHours(0, 0, 0, 0);
        const e = new Date(props.periodEnd); e.setHours(23, 59, 59, 999);
        const res = await apiRequest('post', `${env.TIMESHEET}/generate-invoice`, {
            userArray: props.userIds || [],
            start: Math.floor(s.getTime() / 1000),
            end: Math.floor(e.getTime() / 1000),
            defaultRate: Number(rate.value) || 0,
        });
        const body = res && res.data;
        if (!body || !body.status || !body.data) return;
        const inv = body.data;
        const lines = [['User', 'Hours', `Amount (${inv.currency})`].join(',')];
        (inv.lineItems || []).forEach((li) => {
            lines.push([csvEscape(userName(li.userId)), csvEscape(li.hours), csvEscape(li.amount)].join(','));
        });
        lines.push(['', 'Total', inv.total].join(','));
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${apiDate(props.periodStart)}_${apiDate(props.periodEnd)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        // swallow — button re-enables
    } finally {
        busy.value = false;
    }
};
</script>

<style scoped>
.ts-invoice { gap: 6px; }
.ts-rate-input { width: 72px; height: 30px; font-size: 12px; }
.ts-inv-btn { padding: 4px 12px; border-radius: 6px; font-size: 13px; white-space: nowrap; color: #2F3990; }
.ts-inv-btn[disabled] { opacity: .6; cursor: default; }
</style>
