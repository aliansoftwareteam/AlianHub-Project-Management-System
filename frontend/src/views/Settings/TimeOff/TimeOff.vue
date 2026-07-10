<template>
    <div class="pto">
        <div class="pto-grid">
            <!-- Request form -->
            <div class="pto-card">
                <h3 class="m-0">{{ $t('Pto.add_title') }}</h3>
                <div class="pto-row">
                    <label>{{ $t('Pto.type') }}</label>
                    <select v-model="form.type" class="form-control">
                        <option v-for="t in types" :key="t" :value="t">{{ $t('Pto.types.' + t) }}</option>
                    </select>
                </div>
                <div class="pto-row two">
                    <div><label>{{ $t('Pto.start') }}</label><input v-model="form.startDate" type="date" class="form-control" /></div>
                    <div><label>{{ $t('Pto.end') }}</label><input v-model="form.endDate" type="date" class="form-control" /></div>
                </div>
                <div class="pto-row"><label>{{ $t('Pto.hours_per_day') }}</label><input v-model.number="form.hoursPerDay" type="number" min="1" max="24" class="form-control" /></div>
                <div class="pto-row"><label>{{ $t('Pto.reason') }}</label><input v-model="form.reason" class="form-control" :placeholder="$t('Pto.reason_ph')" /></div>
                <div class="pto-row pto-days" v-if="form.startDate && form.endDate">{{ $t('Pto.total_days') }}: <b>{{ formDays }}</b></div>
                <div class="pto-actions">
                    <button class="pto-btn" :disabled="busy" @click="addEntry">{{ busy ? $t('Pto.saving') : $t('Pto.request') }}</button>
                    <span v-if="msg" class="pto-msg" :class="msgType">{{ msg }}</span>
                </div>
            </div>

            <!-- Capacity (this month) -->
            <div class="pto-card pto-cap">
                <h3 class="m-0">{{ $t('Pto.capacity_title') }}</h3>
                <p class="pto-sub">{{ capLabel }}</p>
                <div class="pto-cap-nums" v-if="capacity">
                    <div><b>{{ capacity.totalCapacityHours }}h</b><span>{{ $t('Pto.cap_total') }}</span></div>
                    <div><b>−{{ capacity.ptoHours }}h</b><span>{{ $t('Pto.cap_pto') }}</span></div>
                    <div class="pto-cap-avail"><b>{{ capacity.availableHours }}h</b><span>{{ $t('Pto.cap_avail') }}</span></div>
                </div>
                <p v-else class="pto-sub">—</p>
            </div>
        </div>

        <!-- Schedule -->
        <div class="pto-card">
            <div class="pto-list-head">
                <h3 class="m-0">{{ isAdmin ? $t('Pto.team_title') : $t('Pto.my_title') }}</h3>
                <button class="pto-btn-ghost" :disabled="loading" @click="load">{{ $t('Pto.refresh') }}</button>
            </div>
            <div class="pto-table-wrap">
                <table class="pto-table">
                    <thead>
                        <tr>
                            <th v-if="isAdmin">{{ $t('Pto.col_member') }}</th>
                            <th>{{ $t('Pto.col_dates') }}</th>
                            <th>{{ $t('Pto.col_type') }}</th>
                            <th>{{ $t('Pto.col_hours') }}</th>
                            <th>{{ $t('Pto.col_days') }}</th>
                            <th>{{ $t('Pto.col_status') }}</th>
                            <th>{{ $t('Pto.col_reason') }}</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="e in entries" :key="e._id">
                            <td v-if="isAdmin" class="pto-nowrap">{{ e.userName || '—' }}</td>
                            <td class="pto-nowrap">{{ fmt(e.startDate) }} → {{ fmt(e.endDate) }}</td>
                            <td>{{ $t('Pto.types.' + (e.type || 'casual')) }}</td>
                            <td>{{ e.hoursPerDay }}h/day</td>
                            <td class="pto-nowrap">{{ e.totalDays != null ? e.totalDays : leaveDays(e.startDate, e.endDate, e.hoursPerDay) }}</td>
                            <td><span class="pto-badge" :class="e.status">{{ $t('Pto.status.' + e.status) }}</span></td>
                            <td class="pto-reason" :title="e.reason || ''">{{ e.reason || '—' }}</td>
                            <td class="pto-rowactions">
                                <template v-if="isAdmin && e.status === 'pending'">
                                    <button class="pto-mini ok" @click="setStatus(e, 'approved')">{{ $t('Pto.approve') }}</button>
                                    <button class="pto-mini no" @click="setStatus(e, 'rejected')">{{ $t('Pto.reject') }}</button>
                                </template>
                                <button class="pto-mini del" @click="remove(e)">{{ $t('Pto.delete') }}</button>
                            </td>
                        </tr>
                        <tr v-if="!entries.length && !loading"><td :colspan="isAdmin ? 8 : 7" class="pto-empty">{{ $t('Pto.empty') }}</td></tr>
                        <tr v-if="loading && !entries.length"><td :colspan="isAdmin ? 8 : 7" class="pto-empty">{{ $t('Pto.loading') }}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// SEC-08 — time-off / PTO. Members request + see their own; owner/admin see the
// team and approve/reject. Approved PTO reduces available capacity (computed
// server-side and shown here; the same endpoint feeds capacity planning).
const { getters } = useStore();
const { t } = useI18n();
const roleType = computed(() => getters['settings/companyUserDetail'] && getters['settings/companyUserDetail'].roleType);
const isAdmin = computed(() => roleType.value === 1 || roleType.value === 2);

const types = ['casual', 'privilege', 'sick'];
const busy = ref(false);
const loading = ref(false);
const msg = ref(''); const msgType = ref('');
const entries = ref([]);
const capacity = ref(null);
const form = reactive({ type: 'casual', startDate: '', endDate: '', hoursPerDay: 9, reason: '' });

const fmt = (d) => { try { return new Date(d).toLocaleDateString(); } catch (e) { return d; } };

const monthRange = () => {
    const now = new Date();
    const from = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
    return { from, to };
};
const capLabel = computed(() => {
    const { from, to } = monthRange();
    const wd = capacity.value && capacity.value.workingDays;
    return wd != null ? `${from} → ${to} · ${wd} ${t('Pto.working_days')}` : `${from} → ${to}`;
});

// A full working day is 9h (office standard). Leave "days" = working days
// (Mon–Fri) in the range × (hoursPerDay / full day) — a 4.5h half day = 0.5.
// Mirrors the server-side ptoRules.leaveDays used for the table + capacity.
const FULL_DAY_HOURS = 9;
const workingDaysBetween = (start, end) => {
    const s = new Date(start), e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    let cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
    if (last < cur) return 0;
    let n = 0;
    while (cur <= last) {
        const d = cur.getUTCDay();
        if (d !== 0 && d !== 6) n++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
};
const leaveDays = (start, end, hoursPerDay) => {
    const hpd = Number(hoursPerDay) > 0 ? Number(hoursPerDay) : FULL_DAY_HOURS;
    return Math.round((workingDaysBetween(start, end) * hpd / FULL_DAY_HOURS) * 100) / 100;
};
const formDays = computed(() => (form.startDate && form.endDate) ? leaveDays(form.startDate, form.endDate, form.hoursPerDay) : 0);

const load = async () => {
    loading.value = true;
    try {
        const body = (await apiRequest('get', env.PTO))?.data;
        entries.value = (body && body.data) || [];
    } catch (e) { entries.value = []; } finally { loading.value = false; }
    loadCapacity();
};
const loadCapacity = async () => {
    try {
        const { from, to } = monthRange();
        const body = (await apiRequest('get', `${env.PTO}/capacity?from=${from}&to=${to}`))?.data;
        capacity.value = (body && body.data) || null;
    } catch (e) { capacity.value = null; }
};
const addEntry = async () => {
    if (busy.value) return;
    if (!form.startDate || !form.endDate) { msg.value = t('Pto.dates_required'); msgType.value = 'err'; return; }
    busy.value = true; msg.value = '';
    try {
        const body = (await apiRequest('post', env.PTO, { ...form }))?.data;
        if (body && body.status) { msg.value = t('Pto.requested'); msgType.value = 'ok'; form.reason = ''; load(); }
        else { msg.value = (body && body.statusText) || t('Pto.failed'); msgType.value = 'err'; }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && e.response.data.statusText) || t('Pto.failed'); msgType.value = 'err';
    } finally { busy.value = false; }
};
const setStatus = async (e, status) => {
    try { await apiRequest('put', `${env.PTO}/${e._id}/status`, { status }); load(); } catch (err) { /* surfaced via reload */ }
};
const remove = async (e) => {
    try { await apiRequest('delete', `${env.PTO}/${e._id}`); load(); } catch (err) { /* surfaced via reload */ }
};

onMounted(load);
</script>

<style scoped>
.pto { padding: 20px; }
.pto-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; margin-bottom: 16px; }
@media (max-width: 800px) { .pto-grid { grid-template-columns: 1fr; } }
.pto-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 18px; }
.pto-sub { color: #6b7280; font-size: 12.5px; margin: 6px 0 14px; }
.pto-days { color: #3a3f52; font-size: 13px; }
.pto-days b { font-weight: 700; }
.pto-row { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.pto-row > label { font-size: 12.5px; font-weight: 600; color: #3a3f52; }
.pto-row.two { flex-direction: row; gap: 12px; }
.pto-row.two > div { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.pto-actions { display: flex; align-items: center; gap: 12px; }
.pto-cap-nums { display: flex; gap: 18px; align-items: flex-end; }
.pto-cap-nums > div { display: flex; flex-direction: column; }
.pto-cap-nums b { font-size: 22px; color: #3a3f52; }
.pto-cap-nums span { font-size: 11.5px; color: #6b7280; }
.pto-cap-avail b { color: #1c7a43; }
.pto-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.pto-table-wrap { overflow-x: auto; }
.pto-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pto-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 9px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.pto-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; }
.pto-nowrap { white-space: nowrap; }
.pto-reason { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pto-badge { font-size: 11px; font-weight: 700; border-radius: 5px; padding: 2px 8px; text-transform: capitalize; }
.pto-badge.pending { background: #fff8e6; color: #9a6b00; }
.pto-badge.approved { background: #e7f6ee; color: #1c7a43; }
.pto-badge.rejected { background: #fdecec; color: #c0392b; }
.pto-empty { text-align: center; color: #9aa0b4; padding: 20px; }
.pto-rowactions { display: flex; gap: 6px; justify-content: flex-end; }
.pto-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.pto-btn:disabled { opacity: .55; cursor: default; }
.pto-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 6px 13px; font-size: 12.5px; cursor: pointer; }
.pto-mini { border: none; border-radius: 5px; padding: 4px 9px; font-size: 12px; cursor: pointer; }
.pto-mini.ok { background: #1c7a43; color: #fff; }
.pto-mini.no { background: #c0392b; color: #fff; }
.pto-mini.del { background: #eef0f6; color: #3a3f52; }
.pto-msg.ok { color: #1c7a43; font-size: 13px; }
.pto-msg.err { color: #c0392b; font-size: 13px; }
</style>
