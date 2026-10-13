<template>
    <div class="pto">
        <div class="pto-grid">
            <div class="ah-card pto-card">
                <h3 class="ah-h3 pto-form-title">{{ $t('Pto.add_title') }}</h3>
                <div class="ah-field pto-row">
                    <label class="ah-field__label" for="pto-type">{{ $t('Pto.type') }}</label>
                    <select id="pto-type" v-model="form.type" class="ah-input">
                        <option v-for="t in types" :key="t" :value="t">{{ $t('Pto.types.' + t) }}</option>
                    </select>
                </div>
                <div class="pto-row two">
                    <div class="ah-field"><label class="ah-field__label" for="pto-start">{{ $t('Pto.start') }}</label><input id="pto-start" v-model="form.startDate" type="date" :max="form.endDate || undefined" class="ah-input" /></div>
                    <div class="ah-field"><label class="ah-field__label" for="pto-end">{{ $t('Pto.end') }}</label><input id="pto-end" v-model="form.endDate" type="date" :min="form.startDate || undefined" class="ah-input" /></div>
                </div>
                <div class="ah-field pto-row">
                    <label class="ah-field__label" for="pto-duration">{{ $t('Pto.duration') }}</label>
                    <select id="pto-duration" v-model="dayType" class="ah-input">
                        <option value="full">{{ $t('Pto.full_day') }}</option>
                        <option value="half">{{ $t('Pto.half_day') }}</option>
                        <option value="custom">{{ $t('Pto.custom_hours') }}</option>
                    </select>
                </div>
                <div class="ah-field pto-row" v-if="dayType === 'custom'">
                    <label class="ah-field__label" for="pto-hours">{{ $t('Pto.hours_per_day') }}</label>
                    <input id="pto-hours" v-model.number="form.hoursPerDay" type="number" min="1" max="24" step="0.5" class="ah-input" />
                </div>
                <div class="ah-field pto-row"><label class="ah-field__label" for="pto-reason">{{ $t('Pto.reason') }}</label><input id="pto-reason" v-model="form.reason" class="ah-input" :placeholder="$t('Pto.reason_ph')" /></div>
                <div class="pto-row pto-days" v-if="form.startDate && form.endDate && !dateError">{{ $t('Pto.total_days') }}: <b>{{ formDays }}</b></div>
                <div v-if="dateError" class="ah-field__error pto-date-err">{{ dateError }}</div>
                <div class="pto-actions">
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="busy || !!dateError" @click="addEntry">{{ busy ? $t('Pto.saving') : $t('Pto.request') }}</button>
                    <span v-if="msg" class="pto-msg" :class="`pto-msg--${msgType}`">{{ msg }}</span>
                </div>
            </div>
        </div>

        <div class="ah-card pto-card">
            <div class="pto-list-head">
                <h3 class="ah-h3">{{ isAdmin ? $t('Pto.team_title') : $t('Pto.my_title') }}</h3>
                <div class="pto-filters">
                    <input v-if="isAdmin" v-model="filters.search" type="text" class="ah-input pto-filter" :placeholder="$t('Pto.search_member')" :aria-label="$t('Pto.search_member')" @input="onSearchInput" />
                    <select v-model="filters.status" class="ah-input pto-filter" :aria-label="$t('Pto.col_status')" @change="applyFilters">
                        <option value="">{{ $t('Pto.all_status') }}</option>
                        <option v-for="s in statuses" :key="s" :value="s">{{ $t('Pto.status.' + s) }}</option>
                    </select>
                    <select v-model="filters.type" class="ah-input pto-filter" :aria-label="$t('Pto.col_type')" @change="applyFilters">
                        <option value="">{{ $t('Pto.all_types') }}</option>
                        <option v-for="t in types" :key="t" :value="t">{{ $t('Pto.types.' + t) }}</option>
                    </select>
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="loading" @click="load">{{ $t('Pto.refresh') }}</button>
                </div>
            </div>
            <div class="pto-table-wrap ah-scroll">
                <table class="pto-table">
                    <thead>
                        <tr>
                            <th>{{ $t('Pto.col_created') }}</th>
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
                            <td class="pto-nowrap">{{ fmt(e.createdAt) }}</td>
                            <td v-if="isAdmin" class="pto-nowrap">{{ e.userName || '—' }}</td>
                            <td class="pto-nowrap">{{ fmt(e.startDate) }} → {{ fmt(e.endDate) }}</td>
                            <td>{{ $t('Pto.types.' + (e.type || 'casual')) }}</td>
                            <td>{{ $t('Time.per_day', { h: e.hoursPerDay }) }}</td>
                            <td class="pto-nowrap">{{ e.totalDays != null ? e.totalDays : leaveDays(e.startDate, e.endDate, e.hoursPerDay) }}</td>
                            <td><span class="ah-chip pto-badge" :class="`pto-badge--${e.status}`">{{ $t('Pto.status.' + e.status) }}</span></td>
                            <td class="pto-reason" :title="e.reason || ''">{{ e.reason || '—' }}</td>
                            <td>
                                <div class="pto-rowactions">
                                    <template v-if="isAdmin && e.status === 'pending'">
                                        <button type="button" class="ah-btn ah-btn--sm pto-mini--ok" @click="setStatus(e, 'approved')">{{ $t('Pto.approve') }}</button>
                                        <button type="button" class="ah-btn ah-btn--sm pto-mini--no" @click="setStatus(e, 'rejected')">{{ $t('Pto.reject') }}</button>
                                    </template>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="e.status === 'approved'" :title="e.status === 'approved' ? $t('Pto.delete_locked') : ''" @click="remove(e)">{{ $t('Pto.delete') }}</button>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!entries.length && !loading"><td :colspan="isAdmin ? 9 : 8" class="pto-empty">{{ $t('Pto.empty') }}</td></tr>
                        <tr v-if="loading && !entries.length"><td :colspan="isAdmin ? 9 : 8" class="pto-empty">{{ $t('Pto.loading') }}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="pto-pager" v-if="totalPages > 1">
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="page <= 1 || loading" @click="goToPage(page - 1)">{{ $t('Pto.prev') }}</button>
                <span class="pto-pager-info">{{ $t('Pto.page') }} {{ page }} / {{ totalPages }} · {{ total }}</span>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="page >= totalPages || loading" @click="goToPage(page + 1)">{{ $t('Pto.next') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useMoment } from '@/composable';
import { isOwnerOrAdmin } from "@/utils/roles";
import { weekendDaysFor } from '@workingDays';

// SEC-08 — time-off / PTO. Members request + see their own; owner/admin see the
// team and approve/reject. Approved PTO reduces available capacity server-side
// (feeds REP-06 capacity planning).
const { getters } = useStore();
const { t } = useI18n();
const roleType = computed(() => getters['settings/companyUserDetail'] && getters['settings/companyUserDetail'].roleType);
const isAdmin = computed(() => isOwnerOrAdmin(roleType.value));

const types = ['casual', 'privilege', 'sick'];
const busy = ref(false);
const loading = ref(false);
const msg = ref(''); const msgType = ref('');
const entries = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const filters = reactive({ search: '', status: '', type: '' });
const statuses = ['pending', 'approved', 'rejected'];
const totalPages = computed(() => Math.max(1, Math.ceil((total.value || 0) / pageSize)));
const form = reactive({ type: 'casual', startDate: '', endDate: '', hoursPerDay: 9, reason: '' });

// Format dates in the company's saved "Date Format" (DD/MM/YYYY, …) — matches
// the rest of the app via the shared useMoment().changeDateFormate helper.
const { changeDateFormate } = useMoment();
const fmt = (d) => (d ? (changeDateFormate(d) || '—') : '—');

// A full working day is 9h (office standard). Leave "days" = the company's working
// days in the range × (hoursPerDay / full day) — a 4.5h half day = 0.5.
// Mirrors the server-side ptoRules.leaveDays used for the table + capacity.
const FULL_DAY_HOURS = 9;
const weekendDays = computed(() => weekendDaysFor(getters['settings/selectedCompany']));
const workingDaysBetween = (start, end) => {
    const s = new Date(start), e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    let cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
    const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
    if (last < cur) return 0;
    let n = 0;
    while (cur <= last) {
        if (!weekendDays.value.includes(cur.getUTCDay())) n++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
};
const leaveDays = (start, end, hoursPerDay) => {
    const hpd = Number(hoursPerDay) > 0 ? Number(hoursPerDay) : FULL_DAY_HOURS;
    return Math.round((workingDaysBetween(start, end) * hpd / FULL_DAY_HOURS) * 100) / 100;
};
const formDays = computed(() => (form.startDate && form.endDate) ? leaveDays(form.startDate, form.endDate, form.hoursPerDay) : 0);
// End date must be on/after start date (ISO yyyy-mm-dd compares lexicographically).
const dateError = computed(() => (form.startDate && form.endDate && form.endDate < form.startDate) ? t('Pto.date_order') : '');

// Duration picker: Full day = 9h, Half day = 4.5h; "custom" reveals the hours
// input for any other amount. Keeps people from having to type 4.5 by hand.
const dayType = ref('full');
watch(dayType, (v) => {
    if (v === 'full') form.hoursPerDay = FULL_DAY_HOURS;
    else if (v === 'half') form.hoursPerDay = FULL_DAY_HOURS / 2;
});

const load = async () => {
    loading.value = true;
    try {
        const params = new URLSearchParams({ page: page.value, pageSize });
        if (filters.status) params.set('status', filters.status);
        if (filters.type) params.set('type', filters.type);
        if (isAdmin.value && filters.search.trim()) params.set('search', filters.search.trim());
        const body = (await apiRequest('get', `${env.PTO}?${params.toString()}`))?.data;
        entries.value = (body && body.data) || [];
        total.value = (body && body.total) || 0;
    } catch (e) { entries.value = []; total.value = 0; } finally { loading.value = false; }
};

// Filters + pagination all recombine server-side. Dropdowns apply immediately,
// the member search is debounced, and any filter change resets to page 1.
let searchTimer = null;
const onSearchInput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page.value = 1; load(); }, 350);
};
const applyFilters = () => { page.value = 1; load(); };
const goToPage = (p) => {
    if (p < 1 || p > totalPages.value || p === page.value) return;
    page.value = p;
    load();
};
const addEntry = async () => {
    if (busy.value) return;
    if (!form.startDate || !form.endDate) { msg.value = t('Pto.dates_required'); msgType.value = 'err'; return; }
    if (form.endDate < form.startDate) { msg.value = t('Pto.date_order'); msgType.value = 'err'; return; }
    busy.value = true; msg.value = '';
    try {
        const body = (await apiRequest('post', env.PTO, { ...form }))?.data;
        if (body && body.status) { msg.value = t('Pto.requested'); msgType.value = 'ok'; form.reason = ''; page.value = 1; load(); }
        else { msg.value = (body && body.statusText) || t('Pto.failed'); msgType.value = 'err'; }
    } catch (e) {
        msg.value = (e && e.response && e.response.data && e.response.data.statusText) || t('Pto.failed'); msgType.value = 'err';
    } finally { busy.value = false; }
};
const setStatus = async (e, status) => {
    try { await apiRequest('put', `${env.PTO}/${e._id}/status`, { status }); load(); } catch (err) { /* surfaced via reload */ }
};
const remove = async (e) => {
    try {
        await apiRequest('delete', `${env.PTO}/${e._id}`);
        // If we just removed the only row on a later page, step back a page.
        if (entries.value.length === 1 && page.value > 1) page.value -= 1;
        load();
    } catch (err) { load(); }
};

onMounted(load);
</script>

<style scoped>
.pto { padding: var(--page-pad-y, 20px) var(--page-pad-x, 20px); }
.pto-grid { display: grid; grid-template-columns: 1fr; gap: var(--sp-7); margin-bottom: var(--sp-7); }
.pto-card { padding: var(--card-pad-y, 18px) var(--card-pad-x, 18px); min-width: 0; }
.pto-form-title { margin: 0 0 var(--sp-7); }
.pto-days { color: var(--ink-2); font-size: var(--fs-md, 13px); }
.pto-days b { font-weight: 700; color: var(--ink); }
.pto-date-err { margin-bottom: var(--sp-5); }
.pto-row { margin-bottom: var(--sp-5); }
.pto-row.two { display: flex; gap: var(--sp-5); }
.pto-row.two > div { flex: 1; min-width: 0; }
.pto-actions { display: flex; align-items: center; gap: var(--sp-5); flex-wrap: wrap; }
.pto-list-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; margin-bottom: var(--sp-5); }
.pto-table-wrap { overflow-x: auto; }
.pto-table { width: 100%; border-collapse: collapse; font-size: var(--fs-md, 13px); }
.pto-table th { text-align: left; background: var(--surface-2); color: var(--ink-2); font-weight: var(--fw-title, 700); padding: var(--cell-pad-y, 9px) var(--cell-pad-x, 12px); border-bottom: 1px solid var(--border); white-space: nowrap; }
.pto-table td { height: var(--row-h); padding: var(--cell-pad-y, 9px) var(--cell-pad-x, 12px); border-bottom: 1px solid var(--hairline); color: var(--ink); }
.pto-table tbody tr:hover { background: var(--surface-hover); }
.pto-nowrap { white-space: nowrap; }
.pto-reason { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pto-badge { text-transform: capitalize; }
.pto-badge--pending { background: var(--warn-bg); color: var(--warn-ink); }
.pto-badge--approved { background: var(--ok-bg); color: var(--ok-ink); }
.pto-badge--rejected { background: var(--danger-bg); color: var(--danger-ink); }
.pto-table td.pto-empty { text-align: center; color: var(--ink-2); padding: var(--sp-8); }
.pto-rowactions { display: flex; gap: var(--sp-2); justify-content: flex-end; }
.pto-filters { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; justify-content: flex-end; }
.ah-input.pto-filter { width: auto; max-width: 100%; height: var(--control-h, 30px); padding: 0 var(--sp-4); font-size: var(--fs-sm, 12.5px); }
.pto-pager { display: flex; align-items: center; justify-content: center; gap: var(--sp-5); margin-top: var(--sp-6); }
.pto-pager-info { font-size: var(--fs-sm, 12.5px); color: var(--ink-2); }
.pto-mini--ok { background: var(--ok-bg); color: var(--ok-ink); }
.pto-mini--no { background: var(--danger-bg); color: var(--danger-ink); }
.pto-msg { font-size: var(--fs-md, 13px); }
.pto-msg--ok { color: var(--ok-ink); }
.pto-msg--err { color: var(--danger-ink); }
@media (max-width: 767px) {
    .pto-row.two { flex-direction: column; }
    .pto-filters { width: 100%; justify-content: flex-start; }
    .ah-input.pto-filter { flex: 1 1 120px; }
}
</style>
