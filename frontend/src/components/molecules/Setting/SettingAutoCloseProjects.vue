<template>
    <!--
        Auto-close inactive projects card (Settings → Setting page). AHE-3798.
        Company-owner only. Loads the policy from GET /api/v1/project-close on
        mount. Closing is reversible (reopen any time), so — unlike the
        screenshot-retention delete — no confirmation dialog is needed.
    -->
    <div v-if="isOwner" class="acp-card">
        <h2 class="task_priority_wrapper_value">{{ $t('Settings.auto_close_heading') }}</h2>
        <p class="acp-subtitle">{{ $t('Settings.auto_close_subtitle') }}</p>

        <div class="acp-row">
            <div class="acp-row-label">
                <span class="font-weight-500">{{ $t('Settings.auto_close_toggle_label') }}</span>
                <span class="acp-row-hint">{{ $t('Settings.auto_close_toggle_hint') }}</span>
            </div>
            <label class="acp-switch" :class="{ disabled: isBusy }">
                <input type="checkbox" :aria-label="$t('Settings.auto_close_toggle_label')" :checked="policy.enabled" :disabled="isBusy" @change="onToggle($event.target.checked)" />
                <span class="acp-slider"></span>
            </label>
        </div>

        <div class="acp-row">
            <div class="acp-row-label">
                <span class="font-weight-500">{{ $t('Settings.auto_close_window_label') }}</span>
                <span class="acp-row-hint">{{ $t('Settings.auto_close_window_hint') }}</span>
            </div>
            <select class="acp-select" :aria-label="$t('Settings.auto_close_window_label')" :value="policy.inactiveMonths" :disabled="!policy.enabled || isBusy" @change="onWindowChange(Number($event.target.value))">
                <option v-for="n in validInactiveMonths" :key="n" :value="n">{{ $t('Settings.auto_close_months_option', { n }, n) }}</option>
            </select>
        </div>

        <div v-if="policy.lastRunAt || policy.enabled" class="acp-stats">
            <template v-if="policy.lastRunAt">
                {{ $t('Settings.auto_close_last_run', { when: formatRelative(policy.lastRunAt), count: lastRunClosedCount }, lastRunClosedCount) }}
            </template>
            <template v-else>
                {{ $t('Settings.auto_close_not_run_yet') }}
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useToast } from 'vue-toast-notification';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import { isOwnerOrAdmin } from "@/utils/roles";

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const userId = inject('$userId');

// Owner gate — mirrors SettingScreenshotRetention. Renders nothing for non-owners.
const companyUser = computed(() => getters['settings/companyUserDetail'] || {});
// Owner (1) or Admin (2) — both can manage this company setting.
const isOwner = computed(() => isOwnerOrAdmin(Number(companyUser.value && companyUser.value.roleType)));

const policy = ref({ enabled: false, inactiveMonths: 1, lastRunAt: null, lastRunStats: null });
const validInactiveMonths = ref([1, 2, 3, 6]);
const isBusy = ref(false);
const lastRunClosedCount = computed(() => (policy.value.lastRunStats && policy.value.lastRunStats.closedCount) || 0);

async function loadPolicy() {
    try {
        const res = await apiRequest('get', '/api/v1/project-close');
        const data = res && res.data && res.data.data;
        if (res && res.data && res.data.status && data) {
            policy.value = data.policy;
            if (Array.isArray(data.validInactiveMonths) && data.validInactiveMonths.length) {
                validInactiveMonths.value = data.validInactiveMonths;
            }
        }
    } catch (err) {
        console.error('[autoCloseProjects] loadPolicy failed', err);
    }
}

async function persistPolicy(patch) {
    isBusy.value = true;
    try {
        const res = await apiRequest('put', '/api/v1/project-close', { ...patch, userId: userId.value });
        const data = res && res.data;
        if (data && data.status) {
            policy.value = data.data.policy;
            $toast.success(t('Settings.auto_close_saved'), { position: 'top-right' });
        } else {
            $toast.error((data && data.message) || t('Settings.auto_close_save_failed'), { position: 'top-right' });
        }
    } catch (err) {
        console.error('[autoCloseProjects] persistPolicy failed', err);
        $toast.error(t('Settings.auto_close_save_failed'), { position: 'top-right' });
    } finally {
        isBusy.value = false;
    }
}

async function onToggle(nextEnabled) {
    if (nextEnabled === policy.value.enabled) return;
    // Closing is reversible, so no confirmation — persist directly (enabling
    // also stamps the current inactivity window so the cron has a value).
    await persistPolicy(nextEnabled ? { enabled: true, inactiveMonths: policy.value.inactiveMonths || 1 } : { enabled: false });
}

async function onWindowChange(nextMonths) {
    if (nextMonths === policy.value.inactiveMonths) return;
    await persistPolicy({ inactiveMonths: nextMonths });
}

function formatRelative(dateLike) {
    if (!dateLike) return '';
    const days = Math.floor((Date.now() - new Date(dateLike).getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 0) return t('Settings.auto_close_today');
    if (days === 1) return t('Settings.auto_close_yesterday');
    if (days < 30) return t('Settings.auto_close_days_ago', { n: days }, days);
    const months = Math.floor(days / 30);
    return t('Settings.auto_close_months_ago', { n: months }, months);
}

// Watch isOwner (not one-shot onMounted) — companyUserDetail may hydrate async.
let policyLoaded = false;
watch(isOwner, (val) => {
    if (val && !policyLoaded) { policyLoaded = true; loadPolicy(); }
}, { immediate: true });
</script>

<style scoped>
.acp-card { margin-top: 24px; padding: 20px; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 10px; }
.acp-subtitle { margin: 4px 0 16px 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
.acp-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-top: 1px solid var(--hairline); }
.acp-row-label { display: flex; flex-direction: column; gap: 2px; max-width: 70%; }
.acp-row-hint { color: var(--ink-2); font-size: 12px; }
.acp-select { border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 13px; background: var(--surface); color: var(--ink); cursor: pointer; }
.acp-select:disabled { opacity: 0.5; cursor: not-allowed; }
.acp-stats { margin-top: 12px; padding: 10px 12px; background: var(--surface-2); border-radius: 8px; font-size: 12px; color: var(--ink-2); }
.acp-switch { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
.acp-switch.disabled { opacity: 0.55; cursor: not-allowed; }
.acp-switch input { opacity: 0; width: 0; height: 0; }
.acp-slider { position: absolute; inset: 0; background: var(--border); border-radius: 24px; transition: background 0.15s ease; }
.acp-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: var(--knob); border-radius: 50%; transition: transform 0.15s ease; }
.acp-switch input:checked + .acp-slider { background: var(--brand); }
.acp-switch input:checked + .acp-slider::before { transform: translateX(20px); }
:root[data-theme="dark"] .acp-card { border-color: var(--hairline); }
:root[data-theme="dark"] :is(.acp-subtitle, .acp-row-hint, .acp-stats) { color: var(--ink-2); }
:root[data-theme="dark"] .acp-row { border-top-color: var(--hairline); }
:root[data-theme="dark"] .acp-select { background: var(--surface-2); border-color: var(--ink-3); color: var(--ink); }
:root[data-theme="dark"] .acp-stats { background: var(--fill); }
:root[data-theme="dark"] .acp-slider { background: var(--ink-3); }
:root[data-theme="dark"] .acp-slider::before { background: var(--knob); }
:root[data-theme="dark"] .acp-switch input:checked + .acp-slider { background: var(--brand); }
:root[data-theme="dark"] .acp-switch input:checked + .acp-slider::before { background: var(--on-brand); }
</style>
