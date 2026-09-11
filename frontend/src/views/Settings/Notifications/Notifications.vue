<template>
    <div class="nt" :class="{ 'nt--busy': isSpinner }">
        <SpinnerComp :is-spinner="isSpinner" />
        <div>
            <h2 class="ah-h3 nt__title">{{ $t('Settings.notifications_title') }}</h2>
            <div class="ah-small">{{ $t('Settings.notifications_subtitle') }}</div>
        </div>

        <section class="ah-card nt__grid" role="table" :aria-label="$t('Settings.notifications_title')">
            <div class="nt__row nt__row--head" role="row">
                <span class="ah-label nt__event" role="columnheader">{{ $t('Settings.col_event') }}</span>
                <span v-for="ch in channels" :key="ch.key" class="ah-label nt__cell" role="columnheader">{{ $t(ch.label) }}</span>
            </div>
            <div v-if="!sections.length && !isSpinner" class="nt__empty ah-empty">{{ $t('Settings.notifications_empty') }}</div>
            <template v-for="section in sections" :key="section.key">
                <div class="nt__section ah-label" role="rowgroup">{{ sectionName(section) }} · {{ section.items.length }}</div>
                <div v-for="item in section.items" :key="item.key" class="nt__row" role="row">
                    <span class="nt__event" role="cell">
                        <span class="nt__event-name">{{ itemName(item) }}</span>
                        <select v-if="item.notifySelection" class="nt__select" :value="item.notifyFor || 'all'" :aria-label="$t('Settings.notify_for')" @change="updateField(section, item, 'notifyFor', $event.target.value)">
                            <option value="all">{{ $t('Settings.notify_all') }}</option>
                            <option value="assigned_to_me">{{ $t('Settings.notify_assigned') }}</option>
                        </select>
                        <select v-if="section.key === 'before'" class="nt__select" :value="item.duration || '1_d'" :aria-label="$t('Settings.notify_when')" @change="updateField(section, item, 'duration', $event.target.value)">
                            <option v-for="d in durations" :key="d" :value="d">{{ durationLabel(d) }}</option>
                        </select>
                    </span>
                    <span v-for="ch in channels" :key="ch.key" class="nt__cell" role="cell">
                        <input
                            type="checkbox"
                            class="ah-check"
                            :checked="!!item[ch.field]"
                            :aria-label="`${itemName(item)} · ${$t(ch.label)}`"
                            @change="updateField(section, item, ch.field, $event.target.checked)"
                        />
                    </span>
                </div>
            </template>
        </section>

        <section class="ah-card">
            <div class="ah-card__body nt__quiet">
                <div class="nt__quiet-head">
                    <h3 class="ah-h3">{{ $t('Settings.quiet_hours') }}</h3>
                    <AhSwitch v-model="prefs.quietHours.enabled" :label="$t('Settings.quiet_hours')" @update:modelValue="savePrefs()" />
                </div>
                <div class="nt__quiet-row" :class="{ 'is-off': !prefs.quietHours.enabled }">
                    <span>{{ $t('Settings.quiet_hours_between') }}</span>
                    <input class="ah-input nt__time" type="time" v-model="prefs.quietHours.start" :disabled="!prefs.quietHours.enabled" :aria-label="$t('Settings.quiet_from')" @change="savePrefs()" />
                    <span>{{ $t('Settings.quiet_hours_and') }}</span>
                    <input class="ah-input nt__time" type="time" v-model="prefs.quietHours.end" :disabled="!prefs.quietHours.enabled" :aria-label="$t('Settings.quiet_to')" @change="savePrefs()" />
                    <span class="ah-small nt__quiet-note">{{ $t('Settings.quiet_hours_urgent') }}</span>
                </div>
                <label class="nt__check-row" :class="{ 'is-off': !prefs.quietHours.enabled }">
                    <input type="checkbox" class="ah-check" v-model="prefs.quietHours.respectTimeOff" :disabled="!prefs.quietHours.enabled" @change="savePrefs()" />
                    <span>{{ $t('Settings.quiet_hours_respect') }}</span>
                </label>
            </div>
        </section>

        <section class="ah-card nt__switch-card nt__switch-card--agent">
            <span class="ah-avatar ah-avatar--agent nt__agent-mark" aria-hidden="true"><ShellIcon name="agent" :size="14" /></span>
            <div class="nt__switch-text">
                <strong>{{ $t('Settings.agent_activity') }}</strong>
                <div class="ah-small">{{ $t('Settings.agent_activity_hint') }}</div>
            </div>
            <AhSwitch v-model="prefs.agentActivity" :label="$t('Settings.agent_activity')" @update:modelValue="savePrefs()" />
        </section>

        <section v-if="aiAlerts.eligible" class="ah-card" data-test="ai-alerts">
            <div class="ah-card__body nt__quiet">
                <div class="nt__quiet-head">
                    <h3 class="ah-h3">{{ $t('AiAlerts.section_title') }}</h3>
                    <router-link v-if="healthRoute" :to="healthRoute" class="ah-small nt__ai-link" data-test="ai-alerts-thresholds">{{ $t('AiAlerts.edit_thresholds') }}</router-link>
                </div>
                <div class="ah-small">{{ $t('AiAlerts.section_lead') }}</div>
                <div v-if="alertSettings && !alertSettings.enabled" class="nt__ai-off ah-small" data-test="ai-alerts-off">
                    <span class="ai-alerts__mark ai-alerts__mark--clear" aria-hidden="true"></span>{{ $t('AiAlerts.disabled_note') }}
                </div>
                <div v-for="type in ALERT_TYPES" :key="type" class="nt__ai-row" :class="{ 'is-off': !aiAlerts.values[type] }" :data-type="type" :data-state="aiAlerts.values[type] ? 'on' : 'off'">
                    <span class="ai-alerts__mark nt__ai-mark" :class="`ai-alerts__mark--${ALERT_FORMS[type]}`" aria-hidden="true"></span>
                    <div class="nt__switch-text">
                        <strong>{{ $t(`AiAlerts.type_${type}`) }}</strong>
                        <div class="ah-small" :data-explain="type">{{ explainAlert(type) }}</div>
                    </div>
                    <AhSwitch :model-value="!!aiAlerts.values[type]" :label="$t('AiAlerts.toggle_label', { name: $t(`AiAlerts.type_${type}`) })" @update:modelValue="saveAiAlert(type, $event)" />
                </div>
                <div v-if="aiAlertsError" class="ah-field__error" data-test="ai-alerts-error">{{ aiAlertsError }}</div>
            </div>
        </section>

        <section class="ah-card nt__switch-card">
            <div class="nt__switch-text">
                <strong>{{ $t('Settings.daily_digest') }}</strong>
                <div class="ah-small">{{ $t('Settings.daily_digest_hint') }}</div>
            </div>
            <AhSwitch v-model="prefs.dailyDigest" :label="$t('Settings.daily_digest')" @update:modelValue="savePrefs()" />
        </section>
        <div v-if="prefsError" class="ah-field__error">{{ prefsError }}</div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import { markFirstRunStep, FIRST_RUN_STEPS } from "@/composable/firstRunProgress";
import { ALERT_FORMS, ALERT_TYPES, explanationOf } from "@/views/Ai/rateAlerts";

defineOptions({ name: "NotificationSettings" });

const { t, te } = useI18n();
const $toast = useToast();
const userId = inject("$userId");
const companyId = inject("$companyId");
const { getters, dispatch } = useStore();
const router = useRouter();

const HIDDEN_ITEMS = new Set([
    "project_description", "project_checklist", "project_checklist_remove", "project_checklist_assign",
    "task_description", "task_checklist", "task_checklist_assign", "task_checklist_remove",
    "after_3_hours_today_pending_hours", "logged_hours_notification"
]);
const META_KEYS = new Set(["updatedAt", "createdAt", "_id", "userId", "__v", "quietHours", "agentActivity", "dailyDigest", "aiAlerts"]);
const SECTION_ORDER = ["tasks", "project", "before", "chat"];

const channels = [
    { key: "inbox", field: "browser", label: "Settings.ch_inbox" },
    { key: "email", field: "email", label: "Settings.ch_email" },
    { key: "push", field: "mobile", label: "Settings.ch_push" },
    { key: "chat", field: "chat", label: "Settings.ch_chat" }
];
const durations = ["10_m", "30_m", "1_h", "2_h", "3_h", "4_h", "8_h", "12_h", "1_d", "2_d", "3_d"];

const isSpinner = ref(false);
const sections = ref([]);
const prefs = ref({ quietHours: { enabled: false, start: "19:00", end: "09:00", respectTimeOff: true }, agentActivity: true, dailyDigest: false });
const prefsError = ref("");

const rulesGetter = computed(() => getters["settings/notificationSettings"]);
const aiAlerts = ref({ eligible: false, values: {} });
const alertSettings = ref(null);
const aiAlertsError = ref("");

const privileged = computed(() => [1, 2].includes(Number(getters["settings/companyUserDetail"]?.roleType)));
const healthRoute = computed(() => (router?.hasRoute?.("AiHealth") ? { name: "AiHealth", params: { cid: companyId?.value } } : null));
const explainAlert = (type) => {
    const { key, params } = explanationOf(type, alertSettings.value);
    return t(key, params);
};

async function loadAiAlerts() {
    if (!privileged.value) return;
    const [prefsRes, settingsRes] = await Promise.allSettled([
        apiRequest("get", env.NOTIFICATION_PREFERENCES),
        apiRequest("get", env.AGENT_SETTINGS)
    ]);
    const data = prefsRes.status === "fulfilled" ? prefsRes.value?.data?.data : null;
    if (data?.aiAlertsEligible && data.aiAlerts) aiAlerts.value = { eligible: true, values: { ...data.aiAlerts } };
    if (settingsRes.status === "fulfilled" && settingsRes.value?.data?.status === true) alertSettings.value = settingsRes.value.data.data?.alerts || null;
}

async function saveAiAlert(type, value) {
    aiAlertsError.value = "";
    const previous = aiAlerts.value.values[type];
    aiAlerts.value.values[type] = value;
    try {
        await apiRequest("put", env.NOTIFICATION_PREFERENCES, { id: rulesGetter.value._id, aiAlerts: { [type]: value } });
    } catch (error) {
        aiAlerts.value.values[type] = previous;
        aiAlertsError.value = error?.response?.data?.message || t("AiAlerts.save_failed");
    }
}

function hydrate(doc) {
    if (!doc || !Object.keys(doc).length) return;
    const list = Object.keys(doc)
        .filter((k) => !META_KEYS.has(k) && doc[k] && Array.isArray(doc[k].items))
        .map((k) => ({ ...doc[k], key: doc[k].key || k, items: doc[k].items.filter((i) => !HIDDEN_ITEMS.has(i.key)) }));
    list.sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key));
    sections.value = list;
    prefs.value = {
        quietHours: { enabled: false, start: "19:00", end: "09:00", respectTimeOff: true, ...(doc.quietHours || {}) },
        agentActivity: doc.agentActivity !== false,
        dailyDigest: doc.dailyDigest === true
    };
}

const sectionName = (section) => (te(`Notification.${section.key}`) ? t(`Notification.${section.key}`) : section.sectionName || section.key);
const itemName = (item) => {
    const k = String(item.key || "").replace("'", "");
    return te(`Notification.${k}`) ? t(`Notification.${k}`) : item.name || item.key;
};
function durationLabel(value) {
    const [n, unit] = String(value).split("_");
    const key = unit === "m" ? "Settings.minutes_before" : unit === "h" ? "Settings.hours_before" : "Settings.days_before";
    return t(key, { n });
}

async function updateField(section, item, field, value) {
    const previous = item[field];
    item[field] = value;
    try {
        await apiRequest("put", env.NOTIFICATION, {
            id: rulesGetter.value._id,
            key: section.key,
            valueToUpdate: value,
            fieldToUpdate: field,
            elementKey: item.key,
            userId: userId.value
        });
    } catch (error) {
        item[field] = previous;
        $toast.error(error?.response?.data?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    }
}

async function savePrefs() {
    prefsError.value = "";
    try {
        await apiRequest("put", env.NOTIFICATION_PREFERENCES, { id: rulesGetter.value._id, ...prefs.value });
    } catch (error) {
        prefsError.value = error?.response?.data?.message || t("Settings.prefs_error");
    }
}

onMounted(async () => {
    markFirstRunStep(FIRST_RUN_STEPS.NOTIFICATIONS);
    isSpinner.value = true;
    try {
        if (!rulesGetter.value || !Object.keys(rulesGetter.value).length) {
            await dispatch("settings/setNotificationRules", { userId: userId.value, cid: companyId.value });
        }
        hydrate(rulesGetter.value);
        await loadAiAlerts();
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
});

watch(rulesGetter, (val) => hydrate(val));
</script>

<style>
@import "../../Ai/rateAlerts.css";
</style>

<style scoped>
@import "./style.css";
.nt__ai-link { color: var(--brand); text-decoration: none; }
.nt__ai-link:hover { text-decoration: underline; }
.nt__ai-off { display: flex; align-items: center; color: var(--warn-ink); }
.nt__ai-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--hairline); }
.nt__ai-row.is-off .nt__switch-text { opacity: .6; }
.nt__ai-row.is-off .nt__ai-mark { background: transparent; border: 1.5px solid currentColor; }
.nt__ai-row.is-off .nt__ai-mark.ai-alerts__mark--triangle { border: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid var(--ink-2); }
.nt__ai-mark { color: var(--brand); }
</style>
