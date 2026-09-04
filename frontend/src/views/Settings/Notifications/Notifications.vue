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
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import { markFirstRunStep, FIRST_RUN_STEPS } from "@/composable/firstRunProgress";

defineOptions({ name: "NotificationSettings" });

const { t, te } = useI18n();
const $toast = useToast();
const userId = inject("$userId");
const companyId = inject("$companyId");
const { getters, dispatch } = useStore();

const HIDDEN_ITEMS = new Set([
    "project_description", "project_checklist", "project_checklist_remove", "project_checklist_assign",
    "task_description", "task_checklist", "task_checklist_assign", "task_checklist_remove",
    "after_3_hours_today_pending_hours", "logged_hours_notification"
]);
const META_KEYS = new Set(["updatedAt", "createdAt", "_id", "userId", "__v", "quietHours", "agentActivity", "dailyDigest"]);
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
    } catch (error) {
        $toast.error(t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
});

watch(rulesGetter, (val) => hydrate(val));
</script>

<style scoped>
@import "./style.css";
</style>
