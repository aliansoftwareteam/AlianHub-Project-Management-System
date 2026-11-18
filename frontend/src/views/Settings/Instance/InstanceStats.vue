<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!stats" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div class="in-grid">
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.companies') }}</span><strong class="in-big">{{ stats.companies }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.users') }}</span><strong class="in-big">{{ stats.users }}</strong></section>
                <section class="ah-card in-card"><span class="ah-label">{{ $t('Instance.version_short') }}</span><strong class="in-big ah-mono" data-test="version-label">{{ stats.version ? `v${stats.version}` : '—' }}</strong><span v-if="buildLine" class="ah-small ah-mono" data-test="version-line">{{ buildLine }}</span><span v-if="builtAtLine" class="ah-small ah-mono" data-test="built-at-line">{{ $t('Instance.built_at', { at: builtAtLine }) }}</span></section>
            </div>
            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.companies') }}</span></div>
                <table class="in-table">
                    <thead><tr><th>{{ $t('Instance.company') }}</th><th>{{ $t('Instance.created') }}</th><th></th></tr></thead>
                    <tbody>
                        <tr v-for="c in companies" :key="c._id">
                            <td>{{ c.Cst_CompanyName }} <span class="ah-small ah-mono">{{ c._id }}</span></td>
                            <td>{{ formatWhen(c.createdAt) }}</td>
                            <td>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="download(`${env.INSTANCE_AUDIT_EXPORT}?companyId=${c._id}`, `audit-${c._id}.csv`)"><ShellIcon name="download" :size="14" />{{ $t('Instance.audit_csv') }}</button>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :data-test="`redact-open-${c._id}`" :disabled="busy" @click="openRedact(c)">{{ $t('Instance.redact_open') }}</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
            <section v-if="redactFor" class="ah-card in-card" data-test="redact-panel">
                <div class="in-card__head"><span class="in-card__title">{{ $t('Instance.redact_title', { name: redactFor.name }) }}</span></div>
                <p class="ah-small">{{ $t('Instance.redact_lead') }}</p>
                <div v-if="redactError" class="in-banner in-banner--danger" data-test="redact-error"><ShellIcon name="alert" :size="15" /><span>{{ redactError }}</span></div>
                <form class="in-actions" data-test="redact-form" @submit.prevent="askRedact">
                    <label class="ah-small" for="instance-redact-user">{{ $t('Instance.redact_user') }}</label>
                    <input id="instance-redact-user" v-model.trim="redactUser" type="text" class="ah-input st-input ah-mono" autocomplete="off" spellcheck="false" data-test="redact-user" :disabled="busy" />
                    <button type="submit" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy">{{ $t('Instance.redact_continue') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="redact-cancel" @click="closeRedact">{{ $t('Instance.redact_cancel') }}</button>
                </form>
                <p v-if="redactInputError" class="ah-small st-error" data-test="redact-input-error">{{ redactInputError }}</p>
                <div v-if="pendingRedact" class="in-banner in-banner--danger st-confirm" data-test="redact-confirm">
                    <span>{{ $t('Instance.redact_confirm', { id: pendingRedact.userId, name: redactFor.name }) }}</span>
                    <label class="ah-small" for="instance-redact-confirm">{{ $t('Instance.redact_type_user_id') }}</label>
                    <input id="instance-redact-confirm" v-model="redactTyped" type="text" class="ah-input st-input ah-mono" autocomplete="off" spellcheck="false" data-test="redact-confirm-input" />
                    <div class="in-actions">
                        <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" data-test="redact-confirm-button" :disabled="busy || !typedMatches" @click="runRedact">{{ $t('Instance.redact_now') }}</button>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceStats" });

const CHANNEL_KEYS = { beta: "Instance.channel_beta", release: "Instance.channel_release", dev: "Instance.channel_dev", unknown: "Instance.channel_unknown" };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const REDACT_CODES = ["invalid_user_id", "invalid_company_id", "unknown_workspace", "confirmation_mismatch", "redaction_running", "server_error"];

const { t } = useI18n();
const $toast = useToast();
const { get, post, download, message, env } = useInstanceApi();
const stats = ref(null);
const companies = ref([]);
const error = ref("");
const busy = ref(false);
const redactFor = ref(null);
const redactUser = ref("");
const redactInputError = ref("");
const redactError = ref("");
const pendingRedact = ref(null);
const redactTyped = ref("");

const canonicalId = (value) => (OBJECT_ID.test(String(value || "")) ? String(value).toLowerCase() : String(value || ""));
const typedMatches = computed(() => Boolean(pendingRedact.value) && canonicalId(redactTyped.value.trim()) === pendingRedact.value.userId);

const resetRedact = () => {
    redactUser.value = "";
    redactInputError.value = "";
    redactError.value = "";
    pendingRedact.value = null;
    redactTyped.value = "";
};

const openRedact = (company) => {
    resetRedact();
    redactFor.value = { companyId: company._id, name: company.Cst_CompanyName || company._id };
};

const closeRedact = () => {
    resetRedact();
    redactFor.value = null;
};

const askRedact = () => {
    redactInputError.value = "";
    redactError.value = "";
    redactTyped.value = "";
    pendingRedact.value = null;
    if (!OBJECT_ID.test(redactUser.value)) {
        redactInputError.value = t("Instance.redact_code_invalid_user_id");
        return;
    }
    pendingRedact.value = { userId: canonicalId(redactUser.value) };
};

const runRedact = async () => {
    const pending = pendingRedact.value;
    if (!pending || !typedMatches.value || !redactFor.value) return;
    busy.value = true;
    redactError.value = "";
    try {
        const data = await post(`${env.INSTANCE_AUDIT}/${redactFor.value.companyId}/redact-person`, { userId: pending.userId, confirm: pending.userId });
        $toast.success(data && data.rows ? t("Instance.redact_done", { rows: data.rows, fields: data.fields, pseudonym: data.pseudonym }) : t("Instance.redact_nothing"));
        pendingRedact.value = null;
        redactTyped.value = "";
        redactUser.value = "";
    } catch (e) {
        const code = e?.response?.data?.code;
        redactError.value = REDACT_CODES.includes(code) ? t(`Instance.redact_code_${code}`) : message(e);
    } finally {
        busy.value = false;
    }
};

const buildLine = computed(() => {
    const s = stats.value || {};
    const channel = CHANNEL_KEYS[s.channel] ? t(CHANNEL_KEYS[s.channel]) : "";
    return [s.commit ? String(s.commit).slice(0, 8) : "", channel, s.nodeVersion || ""].filter(Boolean).join(" · ");
});

// The head commit's own date, so it answers "which build am I on" rather than "when did this
// process start" — a restart must not make an old build look fresh.
const builtAtLine = computed(() => {
    const at = (stats.value || {}).builtAt;
    return at ? new Date(at).toLocaleString() : "";
});

onMounted(async () => {
    try {
        [stats.value, companies.value] = await Promise.all([get(env.INSTANCE_STATS), get(env.INSTANCE_COMPANIES)]);
    } catch (e) {
        error.value = message(e);
    }
});
</script>

<style scoped>
.in-big { font: 600 24px/1.1 var(--font-ui); color: var(--ink); }
.st-input { max-width: 320px; }
.st-error { color: var(--danger-ink); }
.st-confirm { flex-direction: column; align-items: stretch; }
</style>
