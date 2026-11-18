<template>
    <section class="psa" data-test="project-standing-approvals" :aria-labelledby="headingId">
        <h5 :id="headingId" class="psa__title">{{ t('StandingApprovals.title') }}</h5>
        <p class="psa__hint">{{ t('StandingApprovals.lead', { days: lifetimeDays }) }}</p>
        <p v-if="loading" class="psa__hint" data-test="standing-loading">{{ t('StandingApprovals.loading') }}</p>
        <template v-else-if="loaded">
            <ul v-if="rows.length" class="psa__rows">
                <li v-for="row in rows" :key="row.id" class="psa__row" data-test="standing-row" :data-id="row.id">
                    <span class="psa__text">
                        <span class="psa__name">{{ whoOf(row) }}: {{ row.label }}</span>
                        <span class="psa__about">{{ t('StandingApprovals.about', { maker: nameOf(row.madeBy), date: when(row.expiresAt), n: row.uses }, row.uses) }}</span>
                    </span>
                    <button
                        v-if="row.canEnd"
                        type="button"
                        class="ah-btn ah-btn--secondary ah-btn--sm psa__remove"
                        :disabled="busy"
                        data-test="standing-remove"
                        :aria-label="t('StandingApprovals.remove_named', { what: row.label, agent: whoOf(row) })"
                        @click="remove(row)"
                    >{{ t('StandingApprovals.remove') }}</button>
                </li>
            </ul>
            <p v-else class="psa__hint" data-test="standing-empty">{{ t('StandingApprovals.empty') }}</p>
        </template>
        <p v-if="error" class="psa__error" role="alert" data-test="standing-error">{{ error }}</p>
    </section>
</template>

<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { useConvertDate, useGetterFunctions } from "@/composable";

defineOptions({ name: "ProjectStandingApprovalsCard" });

const props = defineProps({
    projectId: { type: String, required: true }
});

const DEFAULT_LIFETIME_DAYS = 90;

const { t } = useI18n();
const $toast = useToast();
const { getUser } = useGetterFunctions();
const { convertDateFormat } = useConvertDate();

const headingId = `psa-${Math.random().toString(36).slice(2, 8)}-heading`;
const rows = ref([]);
const lifetimeDays = ref(DEFAULT_LIFETIME_DAYS);
const loading = ref(false);
const loaded = ref(false);
const busy = ref(false);
const error = ref("");

const urlOf = (pid, id) => `${env.AGENT_STANDING_APPROVALS}/${encodeURIComponent(pid)}${id ? `/${encodeURIComponent(id)}` : ""}`;
const reasonOf = (e, fallback) => e?.response?.data?.statusText || e?.response?.data?.message || t(fallback);
const nameOf = (userId) => getUser(userId)?.Employee_Name || t("StandingApprovals.someone");
const whoOf = (row) => (getUser(row.requestedBy)?.Employee_Name ? t("Inbox.queue_for", { agent: row.agentName, person: getUser(row.requestedBy).Employee_Name }) : row.agentName);
const when = (at) => (at ? convertDateFormat(at, "", { showDayName: false }) : "");

async function request(type, url, fallback) {
    let res;
    try {
        res = await apiRequest(type, url, undefined);
    } catch (e) {
        throw new Error(reasonOf(e, fallback));
    }
    if (res?.data?.status !== true) throw new Error(res?.data?.statusText || t(fallback));
    return res.data.data;
}

async function load(pid) {
    loading.value = true;
    loaded.value = false;
    error.value = "";
    try {
        const data = await request("get", urlOf(pid), "StandingApprovals.load_failed");
        if (pid !== props.projectId) return;
        rows.value = Array.isArray(data?.rows) ? data.rows : [];
        lifetimeDays.value = Number(data?.lifetimeDays) || DEFAULT_LIFETIME_DAYS;
        loaded.value = true;
    } catch (e) {
        error.value = e.message;
    } finally {
        loading.value = false;
    }
}

watch(() => props.projectId, (pid) => { if (pid) load(pid); }, { immediate: true });

async function remove(row) {
    busy.value = true;
    error.value = "";
    try {
        await request("delete", urlOf(props.projectId, row.id), "StandingApprovals.remove_failed");
        rows.value = rows.value.filter((kept) => kept.id !== row.id);
        $toast.success(t("StandingApprovals.removed"), { position: "top-right" });
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>

<style scoped>
.psa { display: flex; flex-direction: column; gap: 8px; margin: 20px 0 0; max-width: 560px; min-width: 0; }
.psa__title { margin: 0; font: 600 14px/1.3 var(--font-ui); color: var(--ink); }
.psa__hint { margin: 0; color: var(--ink-2); font-size: 12px; }
.psa__error { margin: 0; color: var(--danger); font-size: 12px; }
.psa__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.psa__row {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; min-width: 0;
    border: 1px solid var(--border); border-radius: var(--r-input, 8px); background: var(--surface);
}
.psa__text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 16ch; min-width: 0; }
.psa__name { color: var(--ink); font: 500 12.5px/1.35 var(--font-ui); overflow-wrap: anywhere; }
.psa__about { color: var(--ink-2); font: 400 12px/1.4 var(--font-ui); overflow-wrap: anywhere; }
.psa__remove { flex: none; }
@media (max-width: 767px) {
    .psa__remove { min-height: 44px; }
}
</style>
