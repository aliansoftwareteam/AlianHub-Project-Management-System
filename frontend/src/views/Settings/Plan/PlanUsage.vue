<template>
    <div class="pu">
        <p v-if="!managed" class="ah-muted" data-test="plan-self-hosted">{{ $t('Plan.self_hosted') }}</p>
        <div v-else-if="planState.failed && !usage" class="ah-card ah-card__body pu__failed" role="alert">
            <span>{{ $t('Plan.load_failed') }}</span>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="loadPlanUsage">{{ $t('Plan.retry') }}</button>
        </div>
        <div v-else-if="!usage" class="pu__loading"><span class="ah-spin" :aria-label="$t('Plan.loading')"></span></div>
        <template v-else>
            <section class="ah-card pu__head" data-test="plan-head">
                <div>
                    <div class="ah-h3">{{ planName }}</div>
                    <span class="ah-chip pu__state" :class="stateChip">{{ $t(`Plan.state.${state}`) }}</span>
                </div>
                <button v-if="usage.canManage && usage.portalUrl" type="button" class="ah-btn ah-btn--primary" data-test="plan-manage" @click="openPortal(usage.portalUrl)">
                    {{ $t('Plan.manage_plan') }}
                </button>
            </section>

            <section class="ah-card pu__list">
                <div v-for="row in meters" :key="row.key" class="pu__row" :data-test="`plan-${row.key}`">
                    <div class="pu__row-head">
                        <span class="pu__label">{{ row.label }}</span>
                        <span class="pu__value">{{ row.value }}</span>
                    </div>
                    <div
                        v-if="row.percent !== null"
                        class="pu__meter"
                        role="progressbar"
                        :aria-label="row.label"
                        :aria-valuenow="row.percent"
                        aria-valuemin="0"
                        aria-valuemax="100"
                    >
                        <span class="pu__fill" :class="levelClass(row.percent)" :style="{ width: `${row.percent}%` }"></span>
                    </div>
                    <p v-if="row.note" class="ah-small pu__note">{{ row.note }}</p>
                    <ul v-if="row.key === 'storage' && byWorkspace.length" class="pu__split" :aria-label="$t('Plan.by_workspace')">
                        <li v-for="workspace in byWorkspace" :key="workspace.companyId">
                            <span>{{ workspace.name || $t('Plan.unnamed_workspace') }}</span>
                            <span class="ah-mono">{{ formatPlanBytes(workspace.bytes) }}</span>
                        </li>
                    </ul>
                </div>
            </section>

            <section v-if="usage.canManage && usage.portalUrl" class="pu__more">
                <button type="button" class="ah-btn ah-btn--secondary" data-test="plan-add-more" @click="openPortal(usage.portalUrl)">{{ $t('Plan.add_more') }}</button>
            </section>
            <p v-else-if="!usage.canManage" class="ah-small ah-muted">{{ $t('Plan.admins_only') }}</p>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { isManagedHosting } from "@/config/publicConfig";
import { formatPlanBytes, isUnlimited, loadPlanUsage, openPortal, percentOf, planState } from "@/composable/planUsage";

defineOptions({ name: "PlanUsage" });

const { t, te } = useI18n();

const managed = computed(() => isManagedHosting());
const usage = computed(() => planState.data);
const state = computed(() => usage.value?.lifecycle?.state || "active");
const planName = computed(() => {
    const key = `Plan.plans.${usage.value?.plan || ""}`;
    return te(key) ? t(key) : t("Plan.plans.custom");
});
const stateChip = computed(() => ({
    "ah-chip--ok": state.value === "active",
    "ah-chip--warn": state.value === "past_due",
    "ah-chip--danger": state.value === "read_only" || state.value === "suspended",
}));
const byWorkspace = computed(() => usage.value?.storage?.byWorkspace || []);

const count = (value) => Number(value || 0).toLocaleString();
const outOf = (used, limit, format = count) => (isUnlimited(limit)
    ? t("Plan.of_unlimited", { used: format(used) })
    : t("Plan.of", { used: format(used), limit: format(limit) }));

const meters = computed(() => {
    const u = usage.value;
    if (!u) return [];
    const tracker = u.timeTracker || {};
    return [
        {
            key: "seats", label: t("Plan.seats"), value: outOf(u.seats.used, u.seats.limit),
            percent: isUnlimited(u.seats.limit) ? null : percentOf(u.seats.used, u.seats.limit),
            note: u.seats.overLimit ? t("Plan.seats_over") : (u.seats.pending ? t("Plan.pending_invites", { n: u.seats.pending }, u.seats.pending) : ""),
        },
        { key: "guests", label: t("Plan.guests"), value: outOf(u.guests.used, u.guests.limit), percent: null, note: u.guests.overLimit ? t("Plan.guests_over") : "" },
        {
            key: "storage", label: t("Plan.storage"), value: outOf(u.storage.bytes, u.storage.limit, formatPlanBytes),
            percent: isUnlimited(u.storage.limit) ? null : percentOf(u.storage.bytes, u.storage.limit),
            note: u.storage.level >= 80 ? t("Plan.storage_note", { n: percentOf(u.storage.bytes, u.storage.limit) }) : "",
        },
        { key: "workspaces", label: t("Plan.workspaces"), value: outOf(u.workspaces.count, u.workspaces.limit), percent: null, note: "" },
        {
            key: "tracker", label: t("Plan.time_tracker"), percent: null, note: "",
            value: tracker.enabled ? (isUnlimited(tracker.limit) ? t("Plan.tracked_users_unlimited", { used: count(tracker.used) }) : t("Plan.tracked_users", { used: count(tracker.used), limit: count(tracker.limit) })) : t("Plan.tracker_off"),
        },
        { key: "file", label: t("Plan.largest_file"), value: isUnlimited(u.maxFileBytes) ? t("Plan.unlimited") : formatPlanBytes(u.maxFileBytes), percent: null, note: "" },
        {
            key: "mail", label: t("Plan.email_today"), value: outOf(u.mail.sentToday, u.mail.limit), percent: null,
            note: u.mail.queued ? t("Plan.emails_queued", { n: u.mail.queued }, u.mail.queued) : (u.mail.capped ? t("Plan.mail_capped") : ""),
        },
    ];
});

const levelClass = (percent) => (percent >= 95 ? "pu__fill--danger" : percent >= 80 ? "pu__fill--warn" : "");

onMounted(loadPlanUsage);
</script>

<style scoped>
.pu { display: flex; flex-direction: column; gap: 16px; max-width: 720px; padding: 4px 0 24px; }
.pu__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; }
.pu__state { margin-top: 6px; }
.pu__list { display: flex; flex-direction: column; }
.pu__row { padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.pu__row:last-child { border-bottom: 0; }
.pu__row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.pu__label { font: var(--text-label); color: var(--ink); }
.pu__value { font: var(--text-data); color: var(--ink-2); }
.pu__meter { margin-top: 8px; height: 8px; border-radius: var(--r-chip); background: var(--track); overflow: hidden; }
.pu__fill { display: block; height: 100%; background: var(--brand); border-radius: inherit; transition: width var(--motion-base) var(--ease); }
.pu__fill--warn { background: var(--warn); }
.pu__fill--danger { background: var(--danger); }
.pu__note { margin: 6px 0 0; }
.pu__split { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.pu__split li { display: flex; justify-content: space-between; gap: 12px; color: var(--ink-2); font: var(--text-small); }
.pu__more { display: flex; justify-content: flex-end; }
.pu__failed { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pu__loading { display: flex; justify-content: center; padding: 32px; }
@media (max-width: 600px) {
    .pu__head { flex-direction: column; align-items: flex-start; }
}
</style>
