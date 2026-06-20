<template>
    <div class="audit-settings">
        <div class="audit-card">
            <div class="audit-head">
                <h3 class="m-0">{{ $t('Audit.title') }}</h3>
                <button class="audit-btn-ghost" :disabled="busy" @click="reload">{{ busy ? $t('Audit.loading') : $t('Audit.refresh') }}</button>
            </div>
            <p class="audit-sub">{{ $t('Audit.subtitle') }}</p>

            <div class="audit-filters">
                <div class="audit-f"><label>{{ $t('Audit.f_action') }}</label><input v-model="filters.action" class="form-control" :placeholder="$t('Audit.f_action_ph')" @keyup.enter="reload" /></div>
                <div class="audit-f"><label>{{ $t('Audit.f_entity') }}</label><input v-model="filters.entityType" class="form-control" placeholder="member, sso, project…" @keyup.enter="reload" /></div>
                <div class="audit-f"><label>{{ $t('Audit.f_from') }}</label><input v-model="filters.from" type="date" class="form-control" /></div>
                <div class="audit-f"><label>{{ $t('Audit.f_to') }}</label><input v-model="filters.to" type="date" class="form-control" /></div>
                <div class="audit-f audit-f-btns">
                    <button class="audit-btn" :disabled="busy" @click="reload">{{ $t('Audit.apply') }}</button>
                    <button class="audit-btn-ghost" :disabled="busy" @click="clearFilters">{{ $t('Audit.clear') }}</button>
                </div>
            </div>

            <div class="audit-table-wrap">
                <table class="audit-table">
                    <thead>
                        <tr>
                            <th>{{ $t('Audit.col_time') }}</th>
                            <th>{{ $t('Audit.col_actor') }}</th>
                            <th>{{ $t('Audit.col_action') }}</th>
                            <th>{{ $t('Audit.col_entity') }}</th>
                            <th>{{ $t('Audit.col_ip') }}</th>
                            <th>{{ $t('Audit.col_details') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row._id">
                            <td class="audit-nowrap">{{ fmtTime(row.createdAt) }}</td>
                            <td>{{ row.actorName || row.actorId || '—' }}</td>
                            <td><span class="audit-action">{{ row.action }}</span></td>
                            <td>{{ entityLabel(row) }}</td>
                            <td class="audit-nowrap">{{ row.ip || '—' }}</td>
                            <td><code class="audit-meta" v-if="hasMeta(row.meta)">{{ fmtMeta(row.meta) }}</code><span v-else>—</span></td>
                        </tr>
                        <tr v-if="!rows.length && !busy"><td colspan="6" class="audit-empty">{{ $t('Audit.empty') }}</td></tr>
                        <tr v-if="busy && !rows.length"><td colspan="6" class="audit-empty">{{ $t('Audit.loading') }}</td></tr>
                    </tbody>
                </table>
            </div>

            <div class="audit-pager" v-if="total > 0">
                <span class="audit-count">{{ $t('Audit.showing', { from: rangeFrom, to: rangeTo, total }) }}</span>
                <div class="audit-pager-btns">
                    <button class="audit-btn-ghost" :disabled="page <= 1 || busy" @click="go(page - 1)">‹ {{ $t('Audit.prev') }}</button>
                    <span class="audit-page">{{ page }} / {{ totalPages }}</span>
                    <button class="audit-btn-ghost" :disabled="page >= totalPages || busy" @click="go(page + 1)">{{ $t('Audit.next') }} ›</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// SEC-04 — audit log viewer. Owner/admin only (enforced server-side in
// Modules/Audit/controller.js — non-privileged callers get 403). A read-only
// window onto the immutable audit_logs trail with action / entity / date
// filters + server-side pagination ($facet, newest first).
const busy = ref(false);
const rows = ref([]);
const total = ref(0);
const totalPages = ref(1);
const page = ref(1);
const limit = 25;
const filters = reactive({ action: '', entityType: '', from: '', to: '' });

const rangeFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * limit + 1));
const rangeTo = computed(() => Math.min(page.value * limit, total.value));

const fmtTime = (d) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch (e) { return String(d); }
};
const entityLabel = (row) => {
    const t = row.entityType || '';
    const id = row.entityName || row.entityId || '';
    if (t && id) return `${t}: ${id}`;
    return t || id || '—';
};
const hasMeta = (m) => m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length > 0;
const fmtMeta = (m) => { try { return JSON.stringify(m); } catch (e) { return ''; } };

const buildUrl = () => {
    const p = new URLSearchParams();
    p.set('page', String(page.value));
    p.set('limit', String(limit));
    if (filters.action) p.set('action', filters.action.trim());
    if (filters.entityType) p.set('entityType', filters.entityType.trim());
    if (filters.from) p.set('from', filters.from);
    if (filters.to) p.set('to', filters.to);
    return `${env.AUDIT_LOGS}?${p.toString()}`;
};

const load = async () => {
    if (busy.value) return;
    busy.value = true;
    try {
        const body = (await apiRequest('get', buildUrl()))?.data;
        if (body && body.status) {
            rows.value = body.data || [];
            total.value = (body.metadata && body.metadata.total) || 0;
            totalPages.value = (body.metadata && body.metadata.totalPages) || 1;
        } else {
            rows.value = []; total.value = 0; totalPages.value = 1;
        }
    } catch (e) {
        rows.value = []; total.value = 0; totalPages.value = 1;
    } finally {
        busy.value = false;
    }
};

const reload = () => { page.value = 1; load(); };
const go = (p) => { if (p < 1 || p > totalPages.value || busy.value) return; page.value = p; load(); };
const clearFilters = () => { filters.action = ''; filters.entityType = ''; filters.from = ''; filters.to = ''; reload(); };

onMounted(load);
</script>

<style scoped>
.audit-settings { padding: 20px; }
.audit-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 10px; padding: 20px; }
.audit-head { display: flex; align-items: center; justify-content: space-between; }
.audit-sub { color: #6b7280; font-size: 13px; margin: 6px 0 18px; }
.audit-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 16px; }
.audit-f { display: flex; flex-direction: column; gap: 5px; }
.audit-f > label { font-size: 12px; font-weight: 600; color: #3a3f52; }
.audit-f .form-control { min-width: 160px; }
.audit-f-btns { flex-direction: row; gap: 8px; }
.audit-table-wrap { overflow-x: auto; border: 1px solid #e6e7ee; border-radius: 8px; }
.audit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.audit-table th { text-align: left; background: #f7f8fc; color: #3a3f52; font-weight: 700; padding: 10px 12px; border-bottom: 1px solid #e6e7ee; white-space: nowrap; }
.audit-table td { padding: 9px 12px; border-bottom: 1px solid #f0f1f6; color: #3a3f52; vertical-align: top; }
.audit-table tr:last-child td { border-bottom: none; }
.audit-nowrap { white-space: nowrap; }
.audit-action { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #eef1fb; color: #2f3a8f; border-radius: 5px; padding: 2px 7px; }
.audit-meta { font-size: 11.5px; color: #555; word-break: break-all; }
.audit-empty { text-align: center; color: #9aa0b4; padding: 22px 12px; }
.audit-pager { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; flex-wrap: wrap; gap: 10px; }
.audit-count { font-size: 12px; color: #6b7280; }
.audit-pager-btns { display: flex; align-items: center; gap: 10px; }
.audit-page { font-size: 12px; color: #3a3f52; }
.audit-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.audit-btn:disabled { opacity: .55; cursor: default; }
.audit-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
.audit-btn-ghost:disabled { opacity: .5; cursor: default; }
</style>
