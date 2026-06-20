<template>
    <div class="ts-approval d-flex align-items-center" v-if="hasPeriod">
        <!-- Employee side: own period status + submit / resubmit -->
        <span v-if="myStatus" class="ts-badge" :class="`ts-${myStatus.status}`">
            {{ $t(`TimesheetApproval.status_${myStatus.status}`) }}
        </span>
        <span
            v-if="myStatus && myStatus.status === 'rejected' && myStatus.rejectionReason"
            class="ts-reason"
            :title="myStatus.rejectionReason"
        >{{ myStatus.rejectionReason }}</span>
        <button
            v-if="canSubmit"
            class="btn-white border ts-btn"
            :disabled="busy"
            @click="submit"
        >{{ myStatus && myStatus.status === 'rejected' ? $t('TimesheetApproval.resubmit') : $t('TimesheetApproval.submit') }}</button>

        <!-- Manager side: pending approvals queue -->
        <div v-if="isManager" class="ts-approvals-wrap">
            <button class="btn-white border ts-btn" :disabled="busy" @click="togglePanel">
                {{ $t('TimesheetApproval.approvals') }}
                <span v-if="pending.length" class="ts-count">{{ pending.length }}</span>
            </button>
            <div v-if="panelOpen" class="ts-panel">
                <div class="ts-panel-head">
                    <span>{{ $t('TimesheetApproval.pending_title') }}</span>
                    <a class="ts-close" @click="panelOpen = false">&times;</a>
                </div>
                <div v-if="!pending.length" class="ts-empty">{{ $t('TimesheetApproval.none_pending') }}</div>
                <div v-for="row in pending" :key="row._id" class="ts-prow">
                    <div class="ts-prow-info">
                        <span class="ts-user">{{ userName(row.userId) }}</span>
                        <span class="ts-period">{{ fmt(row.periodStart) }} &ndash; {{ fmt(row.periodEnd) }}</span>
                        <span class="ts-hours">{{ toHours(row.totalMinutes) }}</span>
                    </div>
                    <div v-if="rejectId === row._id" class="ts-reject-box">
                        <input
                            v-model="rejectReason"
                            class="form-control ts-reason-input"
                            :placeholder="$t('TimesheetApproval.reason_placeholder')"
                        />
                        <button class="btn-white border ts-mini danger" :disabled="busy || !rejectReason.trim()" @click="confirmReject(row)">
                            {{ $t('TimesheetApproval.confirm') }}
                        </button>
                        <button class="btn-white border ts-mini" @click="cancelReject">{{ $t('TimesheetApproval.cancel') }}</button>
                    </div>
                    <div v-else class="ts-prow-actions">
                        <button class="btn-white border ts-mini success" :disabled="busy" @click="review(row, 'approve')">
                            {{ $t('TimesheetApproval.approve') }}
                        </button>
                        <button class="btn-white border ts-mini" :disabled="busy" @click="rejectId = row._id">
                            {{ $t('TimesheetApproval.reject') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import moment from 'moment';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useGetterFunctions } from '@/composable';

// TIME-01 — Timesheet approval control. Self-contained: shows the current
// user's submission status for the displayed period (+ a submit/resubmit
// button), and for owners/admins a pending-approvals queue with approve /
// reject (with reason). Talks to Modules/TimesheetApproval; the raw timesheet
// entries are untouched.
const props = defineProps({
    periodStart: { type: [Date, Number, String], default: null },
    periodEnd: { type: [Date, Number, String], default: null },
    currentUserId: { type: String, default: '' },
    currentUserName: { type: String, default: '' },
    roleType: { type: Number, default: null },
});

const { getUser } = useGetterFunctions();

const busy = ref(false);
const myStatus = ref(null);
const pending = ref([]);
const panelOpen = ref(false);
const rejectId = ref('');
const rejectReason = ref('');

const hasPeriod = computed(() => !!props.periodStart && !!props.periodEnd);
const isManager = computed(() => props.roleType === 1 || props.roleType === 2);
const canSubmit = computed(() => !myStatus.value || myStatus.value.status === 'rejected');

const fmt = (d) => (d ? moment(d).format('DD MMM') : '');
const apiDate = (d) => (d ? moment(d).format('YYYY-MM-DD') : '');
const toHours = (mins) => {
    const m = Number(mins) || 0;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
};
const userName = (id) => {
    const u = getUser(id);
    return (u && (u.Employee_Name || u.name)) || id || '';
};
const payloadUser = () => ({ id: props.currentUserId, name: props.currentUserName });
const bodyOf = (res) => (res && res.data) || {};

const loadMyStatus = async () => {
    if (!hasPeriod.value || !props.currentUserId) { myStatus.value = null; return; }
    try {
        const qs = `userId=${props.currentUserId}&periodStart=${apiDate(props.periodStart)}&periodEnd=${apiDate(props.periodEnd)}`;
        const body = bodyOf(await apiRequest('get', `${env.TIMESHEET_APPROVAL}/status?${qs}`));
        myStatus.value = body.status ? (body.data || null) : null;
    } catch (e) {
        myStatus.value = null;
    }
};

const loadPending = async () => {
    if (!isManager.value) return;
    try {
        const body = bodyOf(await apiRequest('get', `${env.TIMESHEET_APPROVAL}/pending`));
        pending.value = body.status ? (body.data || []) : [];
    } catch (e) {
        pending.value = [];
    }
};

const togglePanel = () => {
    panelOpen.value = !panelOpen.value;
    if (panelOpen.value) loadPending();
};

const submit = async () => {
    if (busy.value || !hasPeriod.value) return;
    busy.value = true;
    try {
        const body = bodyOf(await apiRequest('post', `${env.TIMESHEET_APPROVAL}/submit`, {
            periodStart: apiDate(props.periodStart),
            periodEnd: apiDate(props.periodEnd),
            periodType: 'week',
            userData: payloadUser(),
        }));
        if (body.status) myStatus.value = body.data;
    } catch (e) { /* keep UI as-is on failure */ } finally {
        busy.value = false;
    }
};

const review = async (row, action) => {
    if (busy.value) return;
    busy.value = true;
    try {
        const body = bodyOf(await apiRequest('post', `${env.TIMESHEET_APPROVAL}/${row._id}/review`, {
            action,
            userData: payloadUser(),
        }));
        if (body.status) {
            pending.value = pending.value.filter((p) => p._id !== row._id);
            if (row.userId === props.currentUserId) loadMyStatus();
        }
    } catch (e) { /* ignore */ } finally {
        busy.value = false;
    }
};

const confirmReject = async (row) => {
    if (busy.value || !rejectReason.value.trim()) return;
    busy.value = true;
    try {
        const body = bodyOf(await apiRequest('post', `${env.TIMESHEET_APPROVAL}/${row._id}/review`, {
            action: 'reject',
            reason: rejectReason.value.trim(),
            userData: payloadUser(),
        }));
        if (body.status) {
            pending.value = pending.value.filter((p) => p._id !== row._id);
            cancelReject();
            if (row.userId === props.currentUserId) loadMyStatus();
        }
    } catch (e) { /* ignore */ } finally {
        busy.value = false;
    }
};

const cancelReject = () => {
    rejectId.value = '';
    rejectReason.value = '';
};

watch(() => [props.periodStart, props.periodEnd, props.currentUserId], () => {
    loadMyStatus();
});

onMounted(() => {
    loadMyStatus();
    if (isManager.value) loadPending();
});
</script>

<style scoped>
.ts-approval { gap: 8px; flex-wrap: wrap; }
.ts-btn { position: relative; padding: 4px 12px; border-radius: 6px; font-size: 13px; white-space: nowrap; color: #2F3990; }
.ts-count { background: #2F3990; color: #fff; border-radius: 10px; padding: 0 6px; margin-left: 6px; font-size: 11px; }
.ts-badge { font-size: 12px; font-weight: 600; border-radius: 12px; padding: 2px 10px; white-space: nowrap; }
.ts-submitted { background: #fff5e6; color: #b06a00; }
.ts-approved { background: #e7f6ec; color: #1c7a43; }
.ts-rejected { background: #fdecea; color: #c0392b; }
.ts-reason { font-size: 12px; color: #c0392b; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ts-approvals-wrap { position: relative; }
.ts-panel { position: absolute; right: 0; top: calc(100% + 6px); width: 340px; max-height: 380px; overflow: auto; background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, .12); z-index: 50; padding: 8px; }
.ts-panel-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 13px; padding: 4px 6px 8px; }
.ts-close { cursor: pointer; font-size: 18px; line-height: 1; color: #6b7280; }
.ts-empty { padding: 14px; text-align: center; color: #6b7280; font-size: 13px; }
.ts-prow { border-top: 1px solid #f0f1f5; padding: 8px 6px; }
.ts-prow-info { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.ts-user { font-weight: 600; font-size: 13px; }
.ts-period, .ts-hours { font-size: 12px; color: #6b7280; }
.ts-prow-actions, .ts-reject-box { display: flex; gap: 6px; align-items: center; }
.ts-mini { padding: 3px 10px; border-radius: 6px; font-size: 12px; color: #2F3990; }
.ts-mini.success { color: #1c7a43; border-color: #bfe3c4 !important; }
.ts-mini.danger { color: #c0392b; border-color: #f0c2bd !important; }
.ts-reason-input { height: 30px; font-size: 12px; flex: 1; }
</style>
