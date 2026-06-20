<template>
    <div class="pf-wrap">
        <div class="pf-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="pf-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="pf-title">{{ $t('Header.Portfolio') }}</h1>
            <button class="pf-btn" @click="openCreate">+ {{ $t('Portfolio.new') }}</button>
        </div>

        <div class="pf-body">
            <!-- Left: portfolio list -->
            <aside class="pf-side">
                <div v-if="!portfolios.length && !loading" class="pf-empty">{{ $t('Portfolio.none') }}</div>
                <button
                    v-for="p in portfolios" :key="p._id"
                    class="pf-side-item" :class="{ active: selected && selected._id === p._id }"
                    @click="select(p)"
                >
                    <span class="pf-side-name">{{ p.name }}</span>
                    <span class="pf-side-count">{{ (p.projectIds || []).length }}</span>
                </button>
            </aside>

            <!-- Right: rollup -->
            <section class="pf-main">
                <div v-if="!selected" class="pf-placeholder">{{ $t('Portfolio.pick') }}</div>

                <template v-else>
                    <div class="pf-main-head">
                        <h2 class="m-0">{{ selected.name }}</h2>
                        <div class="pf-main-actions">
                            <button class="pf-btn-ghost" @click="editSelected">{{ $t('Portfolio.edit') }}</button>
                            <button class="pf-btn-ghost danger" @click="removeSelected">{{ $t('Portfolio.delete') }}</button>
                        </div>
                    </div>

                    <div v-if="rollup" class="pf-totals">
                        <div class="pf-stat"><b>{{ rollup.totals.projects }}</b><span>{{ $t('Portfolio.projects') }}</span></div>
                        <div class="pf-stat"><b>{{ rollup.totals.progressPct }}%</b><span>{{ $t('Portfolio.progress') }}</span></div>
                        <div class="pf-stat ok"><b>{{ rollup.totals.onTrack }}</b><span>{{ $t('Portfolio.on_track') }}</span></div>
                        <div class="pf-stat warn"><b>{{ rollup.totals.atRisk }}</b><span>{{ $t('Portfolio.at_risk') }}</span></div>
                        <div class="pf-stat bad"><b>{{ rollup.totals.offTrack }}</b><span>{{ $t('Portfolio.off_track') }}</span></div>
                        <div class="pf-stat"><b>{{ rollup.totals.overdueTasks }}</b><span>{{ $t('Portfolio.overdue') }}</span></div>
                    </div>

                    <div class="pf-grid">
                        <div v-for="proj in (rollup ? rollup.projects : [])" :key="proj.projectId" class="pf-card" :class="proj.health">
                            <div class="pf-card-head">
                                <span class="pf-card-name" :title="proj.name">{{ proj.name }}</span>
                                <span class="pf-health" :class="proj.health">{{ $t('Portfolio.h_' + proj.health.replace('-', '_')) }}</span>
                            </div>
                            <div class="pf-bar"><div class="pf-bar-fill" :style="{ width: proj.progressPct + '%' }"></div></div>
                            <div class="pf-card-meta">
                                <span>{{ proj.progressPct }}%</span>
                                <span>{{ proj.done }}/{{ proj.total }} {{ $t('Portfolio.done') }}</span>
                                <span v-if="proj.overdue" class="pf-overdue">{{ proj.overdue }} {{ $t('Portfolio.overdue') }}</span>
                            </div>
                            <div class="pf-card-ms" v-if="proj.milestones && proj.milestones.total">
                                {{ proj.milestones.total }} {{ $t('Portfolio.milestones') }}
                                <span v-if="proj.milestones.overdue" class="pf-overdue">· {{ proj.milestones.overdue }} {{ $t('Portfolio.past_due') }}</span>
                            </div>
                        </div>
                        <div v-if="rollup && !rollup.projects.length" class="pf-placeholder">{{ $t('Portfolio.no_projects') }}</div>
                    </div>
                </template>
            </section>
        </div>

        <!-- Create / edit modal -->
        <div v-if="showForm" class="pf-modal-bg" @click.self="showForm = false">
            <div class="pf-modal">
                <h3 class="m-0">{{ editing ? $t('Portfolio.edit') : $t('Portfolio.new') }}</h3>
                <input v-model="form.name" class="form-control" :placeholder="$t('Portfolio.name_ph')" />
                <div class="pf-projects">
                    <label v-for="pr in allProjects" :key="pr._id" class="pf-proj">
                        <input type="checkbox" :value="String(pr._id)" v-model="form.projectIds" />
                        <span>{{ pr.ProjectName || '(untitled)' }}</span>
                    </label>
                    <div v-if="!allProjects.length" class="pf-empty">{{ $t('Portfolio.no_company_projects') }}</div>
                </div>
                <div class="pf-modal-actions">
                    <button class="pf-btn" :disabled="busy || !form.name.trim()" @click="save">{{ busy ? $t('Portfolio.saving') : $t('Portfolio.save') }}</button>
                    <button class="pf-btn-ghost" @click="showForm = false">{{ $t('Portfolio.cancel') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
// Explicit multi-word name to satisfy eslint vue/multi-word-component-names
// (the file is Portfolio.vue / route 'Portfolio', but the component is named here).
export default { name: 'PortfolioView' };
</script>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// REP-01 — cross-project Portfolio rollup (CEO single-pane view). Lists portfolios,
// creates one over selected projects, and renders rolled-up progress / health /
// overdue / milestones from real data (GET /api/v1/portfolio/:id/rollup).
const companyIdRef = inject('$companyId');
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const loading = ref(false);
const busy = ref(false);
const portfolios = ref([]);
const allProjects = ref([]);
const selected = ref(null);
const rollup = ref(null);
const showForm = ref(false);
const editing = ref(false);
const form = reactive({ name: '', projectIds: [] });

const loadPortfolios = async () => {
    loading.value = true;
    try {
        const body = (await apiRequest('get', env.PORTFOLIO))?.data;
        portfolios.value = (body && body.data) || [];
    } catch (e) { portfolios.value = []; } finally { loading.value = false; }
};
const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        allProjects.value = Array.isArray(body) ? body : (body && body.data) || [];
    } catch (e) { allProjects.value = []; }
};
const select = async (p) => {
    selected.value = p;
    rollup.value = null;
    try {
        const body = (await apiRequest('get', `${env.PORTFOLIO}/${p._id}/rollup`))?.data;
        if (body && body.status) rollup.value = body.data;
    } catch (e) { rollup.value = null; }
};
const openCreate = () => { editing.value = false; form.name = ''; form.projectIds = []; showForm.value = true; };
const editSelected = () => {
    if (!selected.value) return;
    editing.value = true;
    form.name = selected.value.name;
    form.projectIds = (selected.value.projectIds || []).map(String);
    showForm.value = true;
};
const save = async () => {
    if (busy.value || !form.name.trim()) return;
    busy.value = true;
    try {
        const payload = { name: form.name.trim(), projectIds: form.projectIds };
        if (editing.value && selected.value) {
            await apiRequest('put', `${env.PORTFOLIO}/${selected.value._id}`, payload);
        } else {
            await apiRequest('post', env.PORTFOLIO, payload);
        }
        showForm.value = false;
        await loadPortfolios();
        const match = portfolios.value.find((x) => x.name === payload.name);
        if (match) await select(match);
    } catch (e) { /* surfaced via reload */ } finally { busy.value = false; }
};
const removeSelected = async () => {
    if (!selected.value) return;
    try {
        await apiRequest('delete', `${env.PORTFOLIO}/${selected.value._id}`);
        selected.value = null; rollup.value = null;
        await loadPortfolios();
    } catch (e) { /* surfaced via reload */ }
};

onMounted(() => { loadPortfolios(); loadProjects(); });
</script>

<style scoped>
.pf-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); }
.pf-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 20px; border-bottom: 1px solid #e6e7ee; }
.pf-home img { width: 20px; height: 20px; }
.pf-title { font-size: 18px; margin: 0; flex: 1; }
.pf-body { flex: 1; display: flex; overflow: hidden; }
.pf-side { width: 240px; border-right: 1px solid #e6e7ee; overflow-y: auto; padding: 10px; }
.pf-side-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #fff; border: 1px solid #eef0f6; border-radius: 8px; padding: 9px 11px; margin-bottom: 7px; cursor: pointer; text-align: left; }
.pf-side-item.active { border-color: #2f3a8f; background: #f5f6fd; }
.pf-side-name { font-size: 13px; color: #3a3f52; font-weight: 600; }
.pf-side-count { font-size: 11px; color: #6b7280; background: #eef0f6; border-radius: 10px; padding: 1px 8px; }
.pf-main { flex: 1; overflow-y: auto; padding: 18px 22px; }
.pf-placeholder, .pf-empty { color: #9aa0b4; font-size: 13px; padding: 14px 4px; }
.pf-main-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.pf-main-actions { display: flex; gap: 8px; }
.pf-totals { display: flex; flex-wrap: wrap; gap: 22px; background: #f7f8fc; border: 1px solid #e6e7ee; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; }
.pf-stat { display: flex; flex-direction: column; }
.pf-stat b { font-size: 22px; color: #3a3f52; }
.pf-stat span { font-size: 11.5px; color: #6b7280; }
.pf-stat.ok b { color: #1c7a43; }
.pf-stat.warn b { color: #9a6b00; }
.pf-stat.bad b { color: #c0392b; }
.pf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.pf-card { background: #fff; border: 1px solid #e6e7ee; border-left-width: 4px; border-radius: 10px; padding: 14px; }
.pf-card.on-track { border-left-color: #1c7a43; }
.pf-card.at-risk { border-left-color: #d99a00; }
.pf-card.off-track { border-left-color: #c0392b; }
.pf-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.pf-card-name { font-weight: 700; font-size: 13.5px; color: #3a3f52; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pf-health { font-size: 10.5px; font-weight: 700; border-radius: 5px; padding: 2px 7px; white-space: nowrap; }
.pf-health.on-track { background: #e7f6ee; color: #1c7a43; }
.pf-health.at-risk { background: #fff8e6; color: #9a6b00; }
.pf-health.off-track { background: #fdecec; color: #c0392b; }
.pf-bar { height: 7px; background: #eef0f6; border-radius: 4px; overflow: hidden; margin-bottom: 8px; }
.pf-bar-fill { height: 100%; background: #2f3a8f; }
.pf-card-meta { display: flex; gap: 12px; font-size: 12px; color: #6b7280; flex-wrap: wrap; }
.pf-card-ms { font-size: 11.5px; color: #6b7280; margin-top: 8px; }
.pf-overdue { color: #c0392b; }
.pf-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 7px; padding: 8px 15px; font-size: 13px; cursor: pointer; }
.pf-btn:disabled { opacity: .55; cursor: default; }
.pf-btn-ghost { background: #fff; color: #2f3a8f; border: 1px solid #cdd2e6; border-radius: 7px; padding: 7px 13px; font-size: 12.5px; cursor: pointer; }
.pf-btn-ghost.danger { color: #c0392b; border-color: #e9c4c0; }
.pf-modal-bg { position: fixed; inset: 0; background: rgba(20,22,40,.4); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.pf-modal { background: #fff; border-radius: 12px; padding: 20px; width: 440px; max-width: 92vw; max-height: 84vh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.pf-projects { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; border: 1px solid #eef0f6; border-radius: 8px; padding: 10px; }
.pf-proj { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #3a3f52; }
.pf-modal-actions { display: flex; gap: 10px; }
</style>
