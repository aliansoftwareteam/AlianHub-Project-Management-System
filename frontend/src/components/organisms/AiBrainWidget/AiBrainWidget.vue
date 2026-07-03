<template>
    <!-- AHE-3792 — AI Brain, the agent's presence on the main screen.
         A persistent floating assistant (Owner/Admin only). Shows a badge for
         proposals waiting on a human, lets you approve/decline them in place,
         run a quick project scan, and jump to the full settings. Reuses the
         same /api/v1/ai-brain/* endpoints as the settings page. -->
    <div v-if="isAdmin && !hiddenHere" class="aibw" :class="{ 'aibw-is-open': open }">
        <transition name="aibw-pop">
            <div v-if="open" class="aibw-panel" @click.stop>
                <div class="aibw-head">
                    <div class="aibw-head-title">
                        <span class="aibw-spark">
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25zM11.5 9.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z"/></svg>
                        </span>
                        <div>
                            <div class="aibw-title">AI Brain</div>
                            <div class="aibw-autonomy">{{ autonomyLabel }}</div>
                        </div>
                    </div>
                    <button class="aibw-x" aria-label="Close" @click="open = false">&times;</button>
                </div>

                <div v-if="killSwitch" class="aibw-kill">Kill switch is ON — all AI actions are paused.</div>

                <div class="aibw-body">
                    <div class="aibw-section-head">
                        <span>Proposals for you</span>
                        <button class="aibw-refresh" :disabled="loading" @click="refresh">{{ loading ? '…' : 'Refresh' }}</button>
                    </div>

                    <div v-if="!inbox.length && !loading" class="aibw-empty">
                        <span class="aibw-empty-ic">✓</span>
                        All clear — nothing waiting for your decision.
                    </div>
                    <div v-else-if="loading && !inbox.length" class="aibw-empty">Loading…</div>

                    <div v-for="row in inbox" :key="row._id" class="aibw-item">
                        <div class="aibw-item-top">
                            <span class="aibw-item-label">{{ actionLabel(row.actionKey) }}</span>
                            <span class="aibw-risk" :class="'aibw-risk-' + (row.riskLevel || 'low')">{{ row.riskLevel || 'low' }}</span>
                        </div>
                        <div class="aibw-item-why" :title="row.reason">{{ row.reason || '—' }}</div>
                        <div class="aibw-item-actions">
                            <button class="aibw-approve" :disabled="deciding === String(row._id)" @click="decide(row, 'approve')">Approve</button>
                            <button class="aibw-decline" :disabled="deciding === String(row._id)" @click="decide(row, 'decline')">Decline</button>
                        </div>
                    </div>
                    <div v-if="msg" class="aibw-msg" :class="msgType">{{ msg }}</div>

                    <div class="aibw-scan">
                        <div class="aibw-section-head"><span>Ask the agent to scan</span></div>
                        <div class="aibw-scan-row">
                            <select v-model="scanProject" class="aibw-select">
                                <option value="" disabled>Select a project…</option>
                                <option v-for="p in projectOptions" :key="p._id" :value="p._id">{{ p.ProjectName }}</option>
                            </select>
                            <button class="aibw-run" :disabled="scanning || !scanProject" @click="runScan">{{ scanning ? 'Scanning…' : 'Scan' }}</button>
                        </div>
                        <div v-if="scanMsg" class="aibw-scan-msg" :class="scanMsgType">{{ scanMsg }}</div>
                    </div>
                </div>

                <div class="aibw-foot">
                    <button class="aibw-link" @click="openSettings">Open AI Brain settings →</button>
                </div>
            </div>
        </transition>

        <button class="aibw-fab" :class="{ 'aibw-fab-open': open }" title="AI Brain" @click.stop="toggle">
            <span class="aibw-spark">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25zM11.5 9.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z"/></svg>
            </span>
            <span v-if="pendingCount" class="aibw-badge">{{ pendingCount > 99 ? '99+' : pendingCount }}</span>
        </button>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useRouter, useRoute } from 'vue-router';
import { apiRequest } from '@/services';

const BASE = '/api/v1/ai-brain';

const { getters } = useStore();
const router = useRouter();
const route = useRoute();
// Hide the floating shortcut across the whole Settings section — it's redundant
// there (the full AI Brain page lives in Settings) and would overlap content.
const hiddenHere = computed(() => (route.matched || []).some((r) => r && r.name === 'Settings') || (typeof route.path === 'string' && route.path.includes('/settings')));
const userIdRef = inject('$userId', ref(''));
const companyIdRef = inject('$companyId', ref(''));
const companyUserDetail = computed(() => getters['settings/companyUserDetail'] || {});
const roleType = computed(() => Number(companyUserDetail.value.roleType) || 3);
const isAdmin = computed(() => roleType.value === 1 || roleType.value === 2);
const callerUserId = computed(() => (userIdRef && userIdRef.value) ? String(userIdRef.value) : '');

const AUTONOMY_LABELS = { 0: 'L0 · Assist', 1: 'L1 · Suggest', 2: 'L2 · Act in bounds', 3: 'L3 · Scheduled', 4: 'L4 · Lifecycle' };

const open = ref(false);
const loading = ref(false);
const inbox = ref([]);
const deciding = ref('');
const msg = ref('');
const msgType = ref('');
const actionsMap = ref({});     // actionKey -> human label
const autonomyLevel = ref(0);
const killSwitch = ref(false);
const projectOptions = ref([]);
const scanProject = ref('');
const scanning = ref(false);
const scanMsg = ref('');
const scanMsgType = ref('');

const autonomyLabel = computed(() => AUTONOMY_LABELS[autonomyLevel.value] || ('L' + autonomyLevel.value));
const pendingCount = computed(() => inbox.value.length);
const actionLabel = (key) => actionsMap.value[key] || key;

// Pull the exact error out of a failed response / axios exception.
const errText = (e, fb) => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || fb;

const loadInbox = async () => {
    loading.value = true;
    try {
        const body = (await apiRequest('get', `${BASE}/inbox?status=pending`))?.data;
        inbox.value = (body && body.status && body.data) ? body.data : [];
    } catch (e) { /* keep whatever we had */ } finally { loading.value = false; }
};

const loadActions = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/actions`))?.data;
        const map = {};
        ((body && body.data) || []).forEach((a) => { map[a.key] = a.label; });
        actionsMap.value = map;
    } catch (e) { /* labels fall back to the raw key */ }
};

const loadSettings = async () => {
    try {
        const body = (await apiRequest('get', `${BASE}/settings`))?.data;
        if (body && body.data) {
            autonomyLevel.value = Number(body.data.autonomyLevel) || 0;
            killSwitch.value = !!body.data.killSwitch;
        }
    } catch (e) { /* defaults stand */ }
};

// Active projects for the quick-scan picker (fetched directly — the project
// store isn't guaranteed populated on every screen).
const loadProjects = async () => {
    try {
        const body = (await apiRequest('get', '/api/v1/project'))?.data;
        const list = Array.isArray(body) ? body : (body && body.data) || [];
        projectOptions.value = list.filter((p) => p && p.statusType !== 'close' && !p.deletedStatusKey);
    } catch (e) { projectOptions.value = []; }
};

const refresh = async () => { await Promise.all([loadInbox(), loadSettings()]); };

let panelPrimed = false;
const toggle = async () => {
    open.value = !open.value;
    if (open.value && !panelPrimed) {
        panelPrimed = true;
        await Promise.all([loadSettings(), loadProjects()]);
    }
    if (open.value) loadInbox();
};

const decide = async (row, decision) => {
    if (deciding.value) return;
    deciding.value = String(row._id);
    msg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/inbox/decide`, {
            inboxId: String(row._id),
            decision,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status) {
            // The decision was saved, but the action itself may have failed
            // (e.g. a stale proposal missing params) — surface that instead of
            // reporting "Approved" for something that didn't actually run.
            const oc = body.outcome;
            if (decision === 'approve' && oc && oc.status === 'queued') {
                msg.value = 'Queued for the dev runner';
                msgType.value = 'ok';
            } else if (decision === 'approve' && oc && oc.status !== 'executed') {
                msg.value = oc.error || `Action ${oc.status}`;
                msgType.value = 'err';
            } else {
                msg.value = decision === 'approve' ? 'Approved' : 'Declined';
                msgType.value = 'ok';
            }
            await loadInbox();
        } else {
            msg.value = (body && (body.error || body.message)) || 'Failed';
            msgType.value = 'err';
        }
    } catch (e) {
        msg.value = errText(e, 'Failed');
        msgType.value = 'err';
    } finally {
        deciding.value = '';
    }
};

const runScan = async () => {
    if (scanning.value || !scanProject.value) return;
    scanning.value = true;
    scanMsg.value = '';
    try {
        const body = (await apiRequest('post', `${BASE}/skills/run`, {
            skill: 'project_health_check',
            projectId: scanProject.value,
            callerRoleType: roleType.value,
            callerUserId: callerUserId.value,
        }))?.data;
        if (body && body.status && body.data && body.data.status === 'ok') {
            const d = body.data;
            const parts = [`${d.proposed || 0} proposed`];
            if (d.executed) parts.push(`${d.executed} auto-run`);
            if (d.failed) parts.push(`${d.failed} failed (handler not wired)`);
            if (d.blocked) parts.push(`${d.blocked} blocked`);
            if (d.skipped) parts.push(`${d.skipped} already handled`);
            scanMsg.value = `${parts.join(', ')}.`;
            scanMsgType.value = d.failed ? 'err' : 'ok';
            await loadInbox();
        } else {
            scanMsg.value = (body && body.data && body.data.error) || (body && (body.error || body.message)) || 'Failed';
            scanMsgType.value = 'err';
        }
    } catch (e) {
        scanMsg.value = errText(e, 'Failed to scan');
        scanMsgType.value = 'err';
    } finally {
        scanning.value = false;
    }
};

const openSettings = () => {
    const cid = (companyIdRef && companyIdRef.value) ? companyIdRef.value : ((getters['settings/selectedCompany'] || {})._id || '');
    open.value = false;
    router.push({ name: 'AiBrainSettings', params: { cid } }).catch(() => {});
};

// Close on outside click / Escape.
const onDocClick = () => { if (open.value) open.value = false; };
const onEsc = (e) => { if (e.key === 'Escape' && open.value) open.value = false; };

// The widget lives in App.vue and mounts for every user; only initialise (and
// attach listeners) for admins. isAdmin can settle a tick after mount, so watch
// it too.
let inited = false;
const init = () => {
    if (inited || !isAdmin.value) return;
    inited = true;
    loadActions();
    loadInbox();
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
};

onMounted(init);
watch(isAdmin, init);
onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onEsc);
});
</script>

<style scoped>
.aibw { position: fixed; bottom: 24px; right: 24px; z-index: 1000; font-family: 'Roboto', sans-serif; }

.aibw-fab {
    position: relative; width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
    background: linear-gradient(135deg, #3a45b0, #2f3990); color: #fff;
    box-shadow: 0 6px 18px rgba(47, 57, 144, .40);
    display: flex; align-items: center; justify-content: center;
    transition: transform .15s ease, box-shadow .15s ease;
}
.aibw-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(47, 57, 144, .52); }
.aibw-fab-open { transform: translateY(-2px); }
.aibw-spark { display: inline-flex; width: 26px; height: 26px; }
.aibw-spark svg { width: 100%; height: 100%; display: block; }
.aibw-badge {
    position: absolute; top: -3px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px;
    background: #e8482b; color: #fff; border-radius: 10px; font-size: 11px; font-weight: 700;
    line-height: 20px; text-align: center; border: 2px solid #fff; box-sizing: border-box;
}

.aibw-panel {
    position: absolute; bottom: 70px; right: 0; width: 360px; max-width: calc(100vw - 32px);
    max-height: 72vh; background: #fff; border-radius: 14px; border: 1px solid #e6e7ee;
    box-shadow: 0 16px 48px rgba(20, 23, 54, .28); display: flex; flex-direction: column; overflow: hidden;
}
.aibw-head {
    background: linear-gradient(135deg, #3a45b0, #2f3990); color: #fff; padding: 14px 16px;
    display: flex; align-items: center; justify-content: space-between; flex: none;
}
.aibw-head-title { display: flex; align-items: center; gap: 10px; }
.aibw-head .aibw-spark { width: 24px; height: 24px; color: #fff; }
.aibw-title { font-size: 15px; font-weight: 700; line-height: 1.1; }
.aibw-autonomy { font-size: 11px; opacity: .85; margin-top: 2px; }
.aibw-x { background: transparent; border: none; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; opacity: .8; padding: 0 2px; }
.aibw-x:hover { opacity: 1; }
.aibw-kill { background: #fdeaea; color: #c0392b; font-size: 12px; font-weight: 600; padding: 8px 16px; flex: none; }

.aibw-body { padding: 12px 16px; overflow-y: auto; flex: 1 1 auto; }
.aibw-section-head {
    display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700;
    color: #6b7280; text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 10px;
}
.aibw-refresh { background: none; border: none; color: #2f3990; font-size: 12px; cursor: pointer; font-weight: 600; }
.aibw-refresh:disabled { opacity: .5; cursor: default; }
.aibw-empty { text-align: center; color: #9aa0b4; font-size: 13px; padding: 18px 8px; }
.aibw-empty-ic { display: block; font-size: 22px; color: #1c7a43; margin-bottom: 4px; }

.aibw-item { border: 1px solid #eceef5; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.aibw-item-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.aibw-item-label { font-size: 13px; font-weight: 600; color: #2f3990; }
.aibw-item-why { font-size: 12px; color: #4b4f66; line-height: 1.45; margin-bottom: 8px; }
.aibw-item-actions { display: flex; gap: 8px; }
.aibw-approve { flex: 1; background: #1c7a43; color: #fff; border: none; border-radius: 7px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.aibw-decline { flex: 1; background: #fff; color: #c0392b; border: 1px solid #e6bcbc; border-radius: 7px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.aibw-approve:disabled, .aibw-decline:disabled { opacity: .55; cursor: default; }

.aibw-risk { font-size: 10px; border-radius: 5px; padding: 1px 7px; text-transform: capitalize; white-space: nowrap; }
.aibw-risk-low { background: #e7f5ec; color: #1c7a43; }
.aibw-risk-medium { background: #fff3e0; color: #b26a00; }
.aibw-risk-high { background: #fdeaea; color: #c0392b; }
.aibw-risk-critical { background: #c0392b; color: #fff; }

.aibw-msg { font-size: 12px; margin: 2px 0 6px; }
.aibw-msg.ok { color: #1c7a43; }
.aibw-msg.err { color: #c0392b; }

.aibw-scan { border-top: 1px solid #f0f1f6; margin-top: 8px; padding-top: 12px; }
.aibw-scan-row { display: flex; gap: 8px; }
.aibw-select { flex: 1; min-width: 0; border: 1px solid #d7dae8; border-radius: 7px; padding: 6px 8px; font-size: 12px; color: #3a3f52; background: #fff; }
.aibw-run { background: #2f3990; color: #fff; border: none; border-radius: 7px; padding: 6px 14px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.aibw-run:disabled { opacity: .55; cursor: default; }
.aibw-scan-msg { font-size: 12px; margin-top: 6px; }
.aibw-scan-msg.ok { color: #1c7a43; }
.aibw-scan-msg.err { color: #c0392b; }

.aibw-foot { border-top: 1px solid #eceef5; padding: 10px 16px; flex: none; }
.aibw-link { background: none; border: none; color: #2f3990; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; }
.aibw-link:hover { text-decoration: underline; }

.aibw-pop-enter-active, .aibw-pop-leave-active { transition: opacity .18s ease, transform .18s ease; transform-origin: bottom right; }
.aibw-pop-enter-from, .aibw-pop-leave-to { opacity: 0; transform: translateY(10px) scale(.98); }
</style>
