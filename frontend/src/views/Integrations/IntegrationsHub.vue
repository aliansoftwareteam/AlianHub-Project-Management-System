<template>
    <div class="ig-wrap">
        <div class="ig-topbar">
            <router-link :to="{ name: 'Home', params: { cid: cid } }" class="ig-home" title="Home">
                <img src="@/assets/images/svg/Home.svg" alt="Home" />
            </router-link>
            <h1 class="ig-title">{{ $t('IntegrationsHub.title') }}</h1>
        </div>

        <div class="ig-body">
            <!-- Left rail -->
            <aside class="ig-rail">
                <button v-for="c in cats" :key="c.key" class="ig-cat" :class="{ active: active === c.key }" @click="active = c.key">
                    <span class="ig-cat-ic">{{ c.icon }}</span>
                    <span class="ig-cat-tx">
                        <span class="ig-cat-name">{{ $t('IntegrationsHub.' + c.key) }}</span>
                        <span class="ig-cat-sub">{{ $t('IntegrationsHub.' + c.key + '_sub') }}</span>
                    </span>
                    <span v-if="c.soon" class="ig-soon">{{ $t('IntegrationsHub.soon') }}</span>
                </button>
            </aside>

            <!-- Content -->
            <section class="ig-content">
                <!-- Email to task -->
                <div v-if="active === 'emailToTask'">
                    <div class="ig-head">
                        <h2>{{ $t('IntegrationsHub.emailToTask') }}</h2>
                        <p>{{ $t('IntegrationsHub.email_intro') }}</p>
                    </div>

                    <div class="ig-card ig-create">
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_pick_project') }}</label>
                        <div class="ig-row">
                            <select v-model="newProjectId" class="form-control">
                                <option value="">{{ $t('IntegrationsHub.email_select') }}</option>
                                <option v-for="p in projects" :key="p._id" :value="String(p._id)">{{ p.ProjectName || '(untitled)' }}</option>
                            </select>
                            <button class="ig-btn" :disabled="!newProjectId || busy" @click="createInbox">{{ busy ? $t('IntegrationsHub.creating') : $t('IntegrationsHub.email_create') }}</button>
                        </div>
                        <p class="ig-note">{{ $t('IntegrationsHub.email_note') }}</p>
                    </div>

                    <div v-if="!inboxes.length" class="ig-empty">{{ $t('IntegrationsHub.email_none') }}</div>
                    <div v-for="ib in inboxes" :key="ib._id" class="ig-card ig-inbox" :class="{ off: !ib.enabled }">
                        <div class="ig-inbox-top">
                            <span class="ig-inbox-name">{{ ib.name }}</span>
                            <span class="ig-pill" :class="ib.enabled ? 'on' : 'paused'">{{ ib.enabled ? $t('IntegrationsHub.active') : $t('IntegrationsHub.paused') }}</span>
                            <span class="ig-inbox-count">{{ ib.receivedCount || 0 }} {{ $t('IntegrationsHub.received') }}</span>
                        </div>
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_address') }}</label>
                        <div class="ig-row">
                            <input class="form-control ig-mono" :value="ib.address" readonly @focus="$event.target.select()" />
                            <button class="ig-mini" @click="copy(ib.address)">{{ $t('IntegrationsHub.copy') }}</button>
                        </div>
                        <label class="ig-lbl">{{ $t('IntegrationsHub.email_webhook') }}</label>
                        <div class="ig-row">
                            <input class="form-control ig-mono" :value="webhookUrl(ib.token)" readonly @focus="$event.target.select()" />
                            <button class="ig-mini" @click="copy(webhookUrl(ib.token))">{{ $t('IntegrationsHub.copy') }}</button>
                        </div>
                        <div class="ig-inbox-actions">
                            <button class="ig-mini" @click="toggle(ib)">{{ ib.enabled ? $t('IntegrationsHub.pause') : $t('IntegrationsHub.resume') }}</button>
                            <button class="ig-mini del" @click="remove(ib)">{{ $t('IntegrationsHub.delete') }}</button>
                        </div>
                    </div>

                    <details class="ig-help">
                        <summary>{{ $t('IntegrationsHub.email_help_title') }}</summary>
                        <ol>
                            <li>{{ $t('IntegrationsHub.email_help_1') }}</li>
                            <li>{{ $t('IntegrationsHub.email_help_2') }}</li>
                            <li>{{ $t('IntegrationsHub.email_help_3') }}</li>
                        </ol>
                    </details>
                </div>

                <!-- Placeholder sections (filled as AUTO-02..07 land) -->
                <div v-else class="ig-soon-panel">
                    <div class="ig-soon-ic">{{ activeCat.icon }}</div>
                    <h2>{{ $t('IntegrationsHub.' + active) }}</h2>
                    <p>{{ $t('IntegrationsHub.' + active + '_sub') }}</p>
                    <span class="ig-pill paused">{{ $t('IntegrationsHub.soon') }}</span>
                </div>
            </section>
        </div>
    </div>
</template>

<script>
export default { name: 'IntegrationsHub' };
</script>

<script setup>
import { ref, computed, onMounted, inject } from 'vue';
import { apiRequest } from '@/services';
import { useGetterFunctions } from '@/composable';
import * as env from '@/config/env';

// AUTO module — unified Integrations & Automation hub. Email-to-task (AUTO-01) is
// live; the other categories are scaffolded and fill in as their backends land.
const companyIdRef = inject('$companyId');
const userId = inject('$userId');
const { getUser } = useGetterFunctions();
const cid = computed(() => (companyIdRef && companyIdRef.value) || companyIdRef || '');

const cats = [
    { key: 'emailToTask', icon: '✉️', soon: false },
    { key: 'automations', icon: '⚡', soon: true },
    { key: 'calendar', icon: '📅', soon: true },
    { key: 'marketplace', icon: '🧩', soon: true },
    { key: 'slack', icon: '💬', soon: true },
    { key: 'apps', icon: '🪟', soon: true },
];
const active = ref('emailToTask');
const activeCat = computed(() => cats.find((c) => c.key === active.value) || cats[0]);

const projects = ref([]);
const inboxes = ref([]);
const newProjectId = ref('');
const busy = ref(false);

const webhookUrl = (token) => `${window.location.origin}${env.EMAIL_IN}/${token}`;

const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', env.PROJECT))?.data;
        projects.value = Array.isArray(body) ? body : (body && body.data) || [];
    } catch (e) { projects.value = []; }
};
const loadInboxes = async () => {
    try {
        const body = (await apiRequest('get', `${env.EMAIL_IN}/inboxes`))?.data;
        inboxes.value = (body && body.data) || [];
    } catch (e) { inboxes.value = []; }
};
const createInbox = async () => {
    if (!newProjectId.value || busy.value) return;
    busy.value = true;
    try {
        const u = (getUser && getUser(userId && userId.value)) || {};
        await apiRequest('post', `${env.EMAIL_IN}/inboxes`, {
            projectId: newProjectId.value,
            userData: { id: u.id || (userId && userId.value), Employee_Name: u.Employee_Name || '', companyOwnerId: u.companyOwnerId || '' },
        });
        newProjectId.value = '';
        await loadInboxes();
    } catch (e) { /* surfaced via reload */ } finally { busy.value = false; }
};
const toggle = async (ib) => {
    try { await apiRequest('put', `${env.EMAIL_IN}/inboxes/${ib._id}`, { enabled: !ib.enabled }); await loadInboxes(); } catch (e) { /* noop */ }
};
const remove = async (ib) => {
    try { await apiRequest('delete', `${env.EMAIL_IN}/inboxes/${ib._id}`); await loadInboxes(); } catch (e) { /* noop */ }
};
const copy = (text) => { if (text) navigator.clipboard.writeText(text); };

onMounted(() => { loadProjects(); loadInboxes(); });
</script>

<style scoped>
.ig-wrap { display: flex; flex-direction: column; height: calc(100dvh - 46px); background: #f7f8fc; }
.ig-topbar { display: flex; align-items: center; gap: 14px; padding: 12px 22px; border-bottom: 1px solid #e6e7ee; background: #fff; }
.ig-home img { width: 20px; height: 20px; }
.ig-title { font-size: 18px; margin: 0; color: #2b2f44; }
.ig-body { flex: 1; display: grid; grid-template-columns: 264px 1fr; min-height: 0; }
@media (max-width: 820px) { .ig-body { grid-template-columns: 1fr; } }
.ig-rail { border-right: 1px solid #e6e7ee; background: #fff; padding: 12px; overflow-y: auto; }
.ig-cat { width: 100%; display: flex; align-items: center; gap: 11px; padding: 11px 12px; border: 1px solid transparent; border-radius: 10px; background: none; cursor: pointer; text-align: left; margin-bottom: 4px; }
.ig-cat:hover { background: #f2f3fb; }
.ig-cat.active { background: #eef0ff; border-color: #d7dbff; }
.ig-cat-ic { font-size: 18px; width: 24px; text-align: center; }
.ig-cat-tx { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.ig-cat-name { font-size: 13.5px; font-weight: 600; color: #33384a; }
.ig-cat-sub { font-size: 11px; color: #9aa0b4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-soon { font-size: 9.5px; font-weight: 700; color: #9a6b00; background: #fff3d6; border-radius: 6px; padding: 2px 6px; }
.ig-content { padding: 22px 26px; overflow-y: auto; }
.ig-head h2 { font-size: 19px; margin: 0 0 4px; color: #2b2f44; }
.ig-head p { color: #6b7280; font-size: 13px; margin: 0 0 18px; max-width: 640px; }
.ig-card { background: #fff; border: 1px solid #e6e7ee; border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; max-width: 720px; }
.ig-create .ig-row { gap: 10px; }
.ig-row { display: flex; align-items: center; gap: 8px; }
.ig-row .form-control { flex: 1; min-width: 0; }
.ig-lbl { display: block; font-size: 11.5px; font-weight: 600; color: #6b7280; margin: 10px 0 5px; }
.ig-create .ig-lbl { margin-top: 0; }
.ig-mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; background: #fafbff; }
.ig-note { font-size: 12px; color: #9aa0b4; margin: 10px 0 0; }
.ig-empty { color: #9aa0b4; font-size: 13px; padding: 8px 2px 16px; }
.ig-inbox.off { opacity: .7; }
.ig-inbox-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.ig-inbox-name { font-size: 14px; font-weight: 700; color: #33384a; }
.ig-inbox-count { font-size: 11.5px; color: #9aa0b4; margin-left: auto; }
.ig-inbox-actions { display: flex; gap: 8px; margin-top: 12px; }
.ig-pill { font-size: 10px; font-weight: 700; border-radius: 6px; padding: 2px 8px; }
.ig-pill.on { background: #e7f6ee; color: #1c7a43; }
.ig-pill.paused { background: #fff3d6; color: #9a6b00; }
.ig-btn { background: #2f3a8f; color: #fff; border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.ig-btn:disabled { opacity: .55; cursor: default; }
.ig-mini { border: 1px solid #e0e2ee; background: #fff; border-radius: 7px; padding: 6px 11px; font-size: 12px; cursor: pointer; color: #33384a; }
.ig-mini:hover { background: #f2f3fb; }
.ig-mini.del { color: #c0392b; border-color: #f3d6d6; }
.ig-help { max-width: 720px; margin-top: 6px; font-size: 12.5px; color: #6b7280; }
.ig-help summary { cursor: pointer; font-weight: 600; color: #2f3a8f; }
.ig-help ol { margin: 10px 0 0; padding-left: 20px; line-height: 1.7; }
.ig-soon-panel { text-align: center; color: #6b7280; padding: 60px 20px; max-width: 460px; margin: 0 auto; }
.ig-soon-ic { font-size: 44px; margin-bottom: 10px; }
.ig-soon-panel h2 { font-size: 20px; color: #2b2f44; margin: 0 0 6px; }
.ig-soon-panel p { font-size: 13px; margin: 0 0 14px; }
</style>
