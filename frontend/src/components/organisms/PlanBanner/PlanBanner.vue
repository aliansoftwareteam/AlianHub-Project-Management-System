<template>
    <div v-if="message" class="pb" :class="`pb--${message.tone}`" role="status" :data-test="`plan-banner-${message.kind}`">
        <ShellIcon :name="message.tone === 'danger' ? 'lock' : 'alert'" :size="14" />
        <span>{{ message.text }}</span>
        <button v-if="message.action" type="button" class="pb__action" @click="message.action.run">{{ message.action.text }}</button>
        <button v-if="message.dismissible" type="button" class="pb__close" :aria-label="$t('Plan.banner.dismiss')" @click="dismiss(message.kind)">
            <ShellIcon name="x" :size="14" />
        </button>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";
import { isOwnerOrAdmin } from "@/utils/roles";
import { followPlan, formatPlanBytes, loadPlanUsage, openPortal, percentOf, planState } from "@/composable/planUsage";

defineOptions({ name: "PlanBanner" });

const DISMISSED_KEY = "ah.planBanner.dismissed";

const store = useStore();
const router = useRouter();
const { t } = useI18n();

const readDismissed = () => {
    try { return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; }
};
const dismissed = reactive(new Set(readDismissed()));

function dismiss(kind) {
    dismissed.add(kind);
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed])); } catch { /* private mode keeps it for this page only */ }
}

const privileged = computed(() => isOwnerOrAdmin(store.getters["settings/companyUserDetail"]?.roleType));
const usage = computed(() => planState.data);
const lifecycle = computed(() => publicConfig.hosting?.lifecycle || usage.value?.lifecycle?.state || "active");

const toPlan = () => {
    const cid = store.getters["settings/selectedCompany"]?._id || localStorage.getItem("selectedCompany");
    if (cid && router.hasRoute("PlanUsage")) router.push({ name: "PlanUsage", params: { cid } });
    else openPortal();
};
const portalAction = (text) => ({ text, run: () => openPortal() });

/* The highest-priority message only. Read-only stays until the state changes; the rest can be
 * put away for the session. */
const candidates = computed(() => {
    const u = usage.value;
    const list = [];
    if (lifecycle.value === "read_only") {
        list.push({ kind: "read_only", tone: "danger", text: t("Plan.banner.read_only"), action: privileged.value ? portalAction(t("Plan.banner.update_payment")) : null });
    }
    if (!privileged.value) return list;
    if (lifecycle.value === "past_due") list.push({ kind: "past_due", tone: "warn", dismissible: true, text: t("Plan.banner.past_due"), action: portalAction(t("Plan.banner.update_payment")) });
    if (!u) return list;
    if (u.seats?.overLimit) list.push({ kind: "seats_over", tone: "warn", dismissible: true, text: t("Plan.banner.seats_over", { used: u.seats.used, limit: u.seats.limit }), action: portalAction(t("Plan.banner.add_seats")) });
    const level = Number(u.storage?.level) || 0;
    if (level >= 80) {
        const params = { n: percentOf(u.storage.bytes, u.storage.limit), used: formatPlanBytes(u.storage.bytes), limit: formatPlanBytes(u.storage.limit) };
        const kind = level >= 100 ? "storage_full" : level >= 95 ? "storage_95" : "storage_80";
        list.push({ kind, tone: level >= 95 ? "danger" : "warn", dismissible: true, text: t(`Plan.banner.${kind}`, params), action: portalAction(t("Plan.banner.add_storage")) });
    }
    if (u.mail?.capped) list.push({ kind: "mail_cap", tone: "warn", dismissible: true, text: t("Plan.banner.mail_cap", { limit: u.mail.limit }), action: { text: t("Plan.banner.see_plan"), run: toPlan } });
    return list;
});

const message = computed(() => (isManagedHosting() ? candidates.value.find((candidate) => !candidate.dismissible || !dismissed.has(candidate.kind)) || null : null));

followPlan(store);
onMounted(loadPlanUsage);
watch(() => publicConfig.hosting?.mode, loadPlanUsage);
watch(() => store.getters["settings/selectedCompany"]?._id, loadPlanUsage);
</script>

<style scoped>
.pb { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 6px 12px; font: 500 13px/1.3 var(--font-ui); }
.pb--warn { background: var(--warn-bg); color: var(--warn-ink); }
.pb--danger { background: var(--danger-bg); color: var(--danger-ink); }
.pb__action { border: 0; background: transparent; color: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; min-height: 24px; }
.pb__close { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; min-height: 24px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: var(--r-sm); }
.pb__action:focus-visible, .pb__close:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
