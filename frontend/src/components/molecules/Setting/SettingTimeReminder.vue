<template>
    <!--
        "Log your time" daily-reminder card for Settings → Setting.

        Owner-only (roleType === 1). Loads the company policy from
        GET /api/v1/timesheet/reminder-settings on mount:
          - a master toggle (OFF by default — no reminder mail goes out until
            an owner turns it on);
          - when ON, a member picker so the mail is sent ONLY to the selected
            users (empty selection ⇒ nobody).
    -->
    <div v-if="isOwner" class="time-reminder-card">
        <h2 class="task_priority_wrapper_value">{{ $t('TimeReminder.heading') }}</h2>
        <p class="time-reminder-subtitle">{{ $t('TimeReminder.subtitle') }}</p>

        <div class="time-reminder-row">
            <div class="time-reminder-row-label">
                <span class="font-weight-500">{{ $t('TimeReminder.toggle_label') }}</span>
                <span class="time-reminder-row-hint">{{ $t('TimeReminder.toggle_hint') }}</span>
            </div>
            <label class="time-reminder-switch" :class="{ disabled: isBusy }">
                <input
                    type="checkbox"
                    :checked="settings.enabled"
                    :disabled="isBusy"
                    @change="onToggle($event.target.checked)"
                />
                <span class="time-reminder-slider"></span>
            </label>
        </div>

        <div v-if="settings.enabled" class="time-reminder-recipients">
            <div class="time-reminder-recipients-head">
                <div class="time-reminder-row-label">
                    <span class="font-weight-500">{{ $t('TimeReminder.recipients_label') }}</span>
                    <span class="time-reminder-row-hint">{{ $t('TimeReminder.recipients_hint') }}</span>
                </div>
                <label class="time-reminder-selectall">
                    <input
                        type="checkbox"
                        :checked="allSelected"
                        :disabled="isBusy || !filteredMembers.length"
                        @change="toggleSelectAll($event.target.checked)"
                    />
                    <span>{{ $t('TimeReminder.select_all') }}</span>
                </label>
            </div>

            <div v-if="members.length" class="time-reminder-search">
                <input
                    type="text"
                    v-model="search"
                    class="time-reminder-search-input"
                    :placeholder="$t('TimeReminder.search_placeholder')"
                />
            </div>

            <div v-if="filteredMembers.length" class="time-reminder-list style-scroll">
                <label
                    v-for="m in filteredMembers"
                    :key="m.id"
                    class="time-reminder-list-item"
                >
                    <input
                        type="checkbox"
                        :value="m.id"
                        :checked="selectedIds.includes(m.id)"
                        :disabled="isBusy"
                        @change="toggleMember(m.id, $event.target.checked)"
                    />
                    <span class="time-reminder-member">
                        <span class="time-reminder-member-name">{{ m.name }}</span>
                        <span class="time-reminder-member-email">{{ m.email }}</span>
                    </span>
                </label>
            </div>
            <p v-else-if="members.length" class="time-reminder-empty">{{ $t('TimeReminder.no_results') }}</p>
            <p v-else class="time-reminder-empty">{{ $t('TimeReminder.no_members') }}</p>

            <div class="time-reminder-actions">
                <span class="time-reminder-count">
                    {{ $t('TimeReminder.selected_count', { n: selectedIds.length }) }}
                </span>
                <button
                    class="btn time-reminder-save-btn"
                    :disabled="isBusy || !dirty"
                    @click="saveRecipients"
                >
                    {{ $t('TimeReminder.save') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';

import { apiRequest } from '@/services';
import { memberData } from '@/views/Settings/Members/helperMember';

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { getCompanyUsers } = memberData();

// Owner gate — mirrors SettingScreenshotRetention. Renders nothing otherwise.
const companyUser = computed(() => getters['settings/companyUserDetail'] || {});
// Owner (1) or Admin (2) — both can manage this company setting.
const isOwner = computed(() => [1, 2].includes(Number(companyUser.value && companyUser.value.roleType)));

const settings = ref({ enabled: false, userIds: [] });
const selectedIds = ref([]);        // working copy of recipient ids (userId)
const isBusy = ref(false);
const search = ref('');

// Active members who can actually receive mail. `userId` is the global users
// _id — the same value the reminder service matches against — so that is the
// id we persist, NOT the company_users _id.
const members = computed(() => {
    return (getCompanyUsers() || [])
        .filter((m) => m && m.userId && m.Employee_Email && m.isDelete !== true)
        .map((m) => ({ id: String(m.userId), name: m.Employee_Name || m.Employee_Email, email: m.Employee_Email }));
});

// Search filters the displayed rows without touching the working selection,
// so members chosen under one query aren't lost when the query changes.
const filteredMembers = computed(() => {
    const q = search.value.trim().toLowerCase();
    if (!q) return members.value;
    return members.value.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
});

// "Select all" acts on the currently visible (filtered) rows.
const allSelected = computed(() => filteredMembers.value.length > 0 && filteredMembers.value.every((m) => selectedIds.value.includes(m.id)));

// Dirty when the working selection differs from the saved policy.
const dirty = computed(() => {
    const saved = [...(settings.value.userIds || [])].sort().join(',');
    const working = [...selectedIds.value].sort().join(',');
    return saved !== working;
});

async function loadSettings() {
    try {
        const res = await apiRequest('get', '/api/v1/timesheet/reminder-settings');
        const data = res && res.data && res.data.data;
        if (res && res.data && res.data.status && data && data.settings) {
            settings.value = data.settings;
            selectedIds.value = [...(data.settings.userIds || [])];
        }
    } catch (err) {
        console.error('[TimeReminder] loadSettings failed', err);
    }
}

async function persist(patch, successMsg) {
    isBusy.value = true;
    try {
        const res = await apiRequest('put', '/api/v1/timesheet/reminder-settings', patch);
        const data = res && res.data;
        if (data && data.status && data.data && data.data.settings) {
            settings.value = data.data.settings;
            selectedIds.value = [...(data.data.settings.userIds || [])];
            $toast.success(successMsg || t('TimeReminder.saved'), { position: 'top-right' });
            return true;
        }
        $toast.error((data && data.statusText) || t('TimeReminder.save_failed'), { position: 'top-right' });
        return false;
    } catch (err) {
        console.error('[TimeReminder] persist failed', err);
        $toast.error((err && err.message) || t('TimeReminder.save_failed'), { position: 'top-right' });
        return false;
    } finally {
        isBusy.value = false;
    }
}

async function onToggle(nextEnabled) {
    if (nextEnabled === settings.value.enabled) return;
    await persist({ enabled: nextEnabled }, nextEnabled ? t('TimeReminder.enabled_toast') : t('TimeReminder.disabled_toast'));
}

function toggleMember(id, checked) {
    if (checked) {
        if (!selectedIds.value.includes(id)) selectedIds.value.push(id);
    } else {
        selectedIds.value = selectedIds.value.filter((x) => x !== id);
    }
}

function toggleSelectAll(checked) {
    const visibleIds = filteredMembers.value.map((m) => m.id);
    if (checked) {
        selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds])];
    } else {
        const visible = new Set(visibleIds);
        selectedIds.value = selectedIds.value.filter((id) => !visible.has(id));
    }
}

async function saveRecipients() {
    await persist({ userIds: selectedIds.value }, t('TimeReminder.recipients_saved'));
}

// Load once the owner record is hydrated (Vuex may populate it after mount).
let loaded = false;
watch(
    isOwner,
    (val) => {
        if (val && !loaded) {
            loaded = true;
            loadSettings();
        }
    },
    { immediate: true }
);
</script>

<style scoped>
.time-reminder-card {
    margin-top: 24px;
    padding: 20px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
}
.time-reminder-subtitle {
    margin: 4px 0 16px 0;
    color: #6b7280;
    font-size: 13px;
    line-height: 1.5;
}
.time-reminder-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid #f3f4f6;
}
.time-reminder-row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 70%;
}
.time-reminder-row-hint {
    color: #6b7280;
    font-size: 12px;
}
.time-reminder-recipients {
    padding-top: 8px;
    border-top: 1px solid #f3f4f6;
}
.time-reminder-recipients-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 12px 0 8px 0;
}
.time-reminder-selectall {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #4b5563;
    cursor: pointer;
    white-space: nowrap;
}
.time-reminder-selectall input {
    cursor: pointer;
}
.time-reminder-search {
    margin-bottom: 8px;
}
.time-reminder-search-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: #111827;
    outline: none;
}
.time-reminder-search-input:focus {
    border-color: #4f46e5;
}
.time-reminder-list {
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
}
.time-reminder-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid #f3f4f6;
    cursor: pointer;
    margin: 0;
}
.time-reminder-list-item:last-child {
    border-bottom: none;
}
.time-reminder-list-item input {
    cursor: pointer;
}
.time-reminder-member {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
}
.time-reminder-member-name {
    font-size: 13px;
    color: #111827;
}
.time-reminder-member-email {
    font-size: 11px;
    color: #6b7280;
}
.time-reminder-empty {
    margin: 12px 0;
    color: #6b7280;
    font-size: 13px;
}
.time-reminder-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
}
.time-reminder-count {
    font-size: 12px;
    color: #4b5563;
}
.time-reminder-save-btn {
    background: #4f46e5;
    color: #fff;
    border-radius: 8px;
    padding: 6px 16px;
    font-size: 13px;
    border: none;
    cursor: pointer;
}
.time-reminder-save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* Toggle switch — matches SettingScreenshotRetention. */
.time-reminder-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    cursor: pointer;
}
.time-reminder-switch.disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
.time-reminder-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}
.time-reminder-slider {
    position: absolute;
    inset: 0;
    background: #d1d5db;
    border-radius: 24px;
    transition: background 0.15s ease;
}
.time-reminder-slider::before {
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
.time-reminder-switch input:checked + .time-reminder-slider {
    background: #4f46e5;
}
.time-reminder-switch input:checked + .time-reminder-slider::before {
    transform: translateX(20px);
}
</style>
