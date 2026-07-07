<template>
    <!--
        Screenshot retention card for the Settings → Setting page.

        Visible only to the company owner (roleType === 1). Loads the
        current policy from GET /api/v1/screenshot-retention on mount and
        renders three control rows:
          - toggle (off / on, with a Swal confirmation on first ON)
          - retention window dropdown (3 / 6 / 12 / 24 months)
          - last-run telemetry (when it last ran, how many it deleted)
    -->
    <div v-if="isOwner" class="screenshot-retention-card">
        <h2 class="task_priority_wrapper_value">{{ $t('ScreenshotRetention.heading') }}</h2>
        <p class="screenshot-retention-subtitle">{{ $t('ScreenshotRetention.subtitle') }}</p>

        <div class="screenshot-retention-row">
            <div class="screenshot-retention-row-label">
                <span class="font-weight-500">{{ $t('ScreenshotRetention.toggle_label') }}</span>
                <span class="screenshot-retention-row-hint">{{ $t('ScreenshotRetention.toggle_hint') }}</span>
            </div>
            <label class="screenshot-retention-switch" :class="{ disabled: isBusy }">
                <input
                    type="checkbox"
                    :checked="policy.enabled"
                    :disabled="isBusy"
                    @change="onToggle($event.target.checked)"
                />
                <span class="screenshot-retention-slider"></span>
            </label>
        </div>

        <div class="screenshot-retention-row">
            <div class="screenshot-retention-row-label">
                <span class="font-weight-500">{{ $t('ScreenshotRetention.window_label') }}</span>
                <span class="screenshot-retention-row-hint">{{ $t('ScreenshotRetention.window_hint') }}</span>
            </div>
            <select
                class="screenshot-retention-select"
                :value="policy.maxAgeMonths"
                :disabled="!policy.enabled || isBusy"
                @change="onWindowChange(Number($event.target.value))"
            >
                <option v-for="n in validMaxAgeMonths" :key="n" :value="n">
                    {{ $t('ScreenshotRetention.months_option', { n }) }}
                </option>
            </select>
        </div>

        <div v-if="policy.lastRunAt || policy.enabled" class="screenshot-retention-stats">
            <template v-if="policy.lastRunAt">
                {{ $t('ScreenshotRetention.last_run', {
                    when: formatRelative(policy.lastRunAt),
                    deleted: (policy.lastRunStats && policy.lastRunStats.deletedCount) || 0
                }) }}
            </template>
            <template v-else>
                {{ $t('ScreenshotRetention.not_run_yet') }}
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import Swal from 'sweetalert2';

import { apiRequest } from '@/services';

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();

const userId = inject('$userId');
// const companyId = inject('$companyId');

// Owner gate — mirrors the BillingHistoryTab convention. Component
// renders nothing for non-owners (the <template v-if="isOwner"> above).
const companyUser = computed(() => getters['settings/companyUserDetail'] || {});
// Owner (1) or Admin (2) — both can manage this company setting.
const isOwner = computed(() => [1, 2].includes(Number(companyUser.value && companyUser.value.roleType)));

const policy = ref({
    enabled: false,
    maxAgeMonths: 3,
    enabledAt: null,
    enabledBy: null,
    lastRunAt: null,
    lastRunStats: null
});
const validMaxAgeMonths = ref([3, 6, 12, 24]);
const isBusy = ref(false);

async function loadPolicy() {
    try {
        const res = await apiRequest('get', '/api/v1/screenshot-retention');
        const data = res && res.data && res.data.data;
        if (res && res.data && res.data.status && data) {
            policy.value = data.policy;
            if (Array.isArray(data.validMaxAgeMonths) && data.validMaxAgeMonths.length) {
                validMaxAgeMonths.value = data.validMaxAgeMonths;
            }
        }
    } catch (err) {
        console.error('[ScreenshotRetention] loadPolicy failed', err);
    }
}

async function fetchPreviewCount(maxAgeMonths) {
    try {
        const res = await apiRequest(
            'get',
            `/api/v1/screenshot-retention/preview?maxAgeMonths=${maxAgeMonths}&userId=${encodeURIComponent(userId.value || '')}`
        );
        const data = res && res.data && res.data.data;
        if (res && res.data && res.data.status && data) {
            return data.estimatedDeleteCount || 0;
        }
        return null;
    } catch (err) {
        console.error('[ScreenshotRetention] preview failed', err);
        return null;
    }
}

async function persistPolicy(patch) {
    isBusy.value = true;
    try {
        const res = await apiRequest('put', '/api/v1/screenshot-retention', {
            ...patch,
            userId: userId.value
        });
        const data = res && res.data;
        if (data && data.status) {
            policy.value = data.data.policy;
            $toast.success(t('ScreenshotRetention.saved'), { position: 'top-right' });
        } else {
            $toast.error((data && data.message) || t('ScreenshotRetention.save_failed'), { position: 'top-right' });
        }
    } catch (err) {
        console.error('[ScreenshotRetention] persistPolicy failed', err);
        $toast.error(t('ScreenshotRetention.save_failed'), { position: 'top-right' });
    } finally {
        isBusy.value = false;
    }
}

async function onToggle(nextEnabled) {
    if (nextEnabled === policy.value.enabled) return;
    if (!nextEnabled) {
        // Disabling is reversible and doesn't delete anything — no confirm.
        await persistPolicy({ enabled: false });
        return;
    }
    // Enabling: fetch the preview count and require explicit confirmation
    // because the next cron run will permanently remove that many records.
    const months = policy.value.maxAgeMonths || 3;
    const count = await fetchPreviewCount(months);
    const result = await Swal.fire({
        title: t('ScreenshotRetention.confirm_title'),
        html: t('ScreenshotRetention.confirm_body', {
            count: count === null ? '?' : count,
            months
        }),
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: t('ScreenshotRetention.confirm_yes'),
        cancelButtonText: t('Projects.cancel'),
        confirmButtonColor: '#dc2626'
    });
    if (!result.isConfirmed) {
        // User backed out; the checkbox briefly flipped — reload from state
        // so it returns to OFF visually.
        policy.value = { ...policy.value };
        return;
    }
    await persistPolicy({ enabled: true, maxAgeMonths: months });
}

async function onWindowChange(nextMonths) {
    if (nextMonths === policy.value.maxAgeMonths) return;
    await persistPolicy({ maxAgeMonths: nextMonths });
}

function formatRelative(dateLike) {
    if (!dateLike) return '';
    const d = new Date(dateLike);
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (days <= 0) return t('ScreenshotRetention.today');
    if (days === 1) return t('ScreenshotRetention.yesterday');
    if (days < 30) return t('ScreenshotRetention.days_ago', { n: days });
    const months = Math.floor(days / 30);
    return t('ScreenshotRetention.months_ago', { n: months });
}

// Watch isOwner rather than firing once on mount: the Vuex store may
// hydrate `companyUserDetail` asynchronously after this component mounts
// (soft route change before the owner record is fetched), in which case
// a one-shot onMounted would never load the policy and the card would
// show its hard-coded defaults forever. `immediate: true` covers the
// case where the store IS already hydrated at mount time. The
// `policyLoaded` flag prevents re-fetching if isOwner flips back and
// forth.
let policyLoaded = false;
watch(
    isOwner,
    (val) => {
        if (val && !policyLoaded) {
            policyLoaded = true;
            loadPolicy();
        }
    },
    { immediate: true }
);
</script>

<style scoped>
.screenshot-retention-card {
    margin-top: 24px;
    padding: 20px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
}
.screenshot-retention-subtitle {
    margin: 4px 0 16px 0;
    color: #6b7280;
    font-size: 13px;
    line-height: 1.5;
}
.screenshot-retention-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid #f3f4f6;
}
.screenshot-retention-row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 70%;
}
.screenshot-retention-row-hint {
    color: #6b7280;
    font-size: 12px;
}
.screenshot-retention-select {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
    background: #fff;
    color: #111827;
    cursor: pointer;
}
.screenshot-retention-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.screenshot-retention-stats {
    margin-top: 12px;
    padding: 10px 12px;
    background: #f9fafb;
    border-radius: 8px;
    font-size: 12px;
    color: #4b5563;
}

/* Toggle switch */
.screenshot-retention-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    cursor: pointer;
}
.screenshot-retention-switch.disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
.screenshot-retention-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}
.screenshot-retention-slider {
    position: absolute;
    inset: 0;
    background: #d1d5db;
    border-radius: 24px;
    transition: background 0.15s ease;
}
.screenshot-retention-slider::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 3px;
    bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.15s ease;
}
.screenshot-retention-switch input:checked + .screenshot-retention-slider {
    background: #4f46e5;
}
.screenshot-retention-switch input:checked + .screenshot-retention-slider::before {
    transform: translateX(20px);
}
</style>
