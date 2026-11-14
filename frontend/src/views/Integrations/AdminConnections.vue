<template>
    <section v-if="privileged" class="ah-card ac" data-test="admin-connections" aria-labelledby="admin-connections-title">
        <div id="admin-connections-title" class="ac__title">{{ $t('Connectors.conn.admin_title') }}</div>
        <p class="ah-small ac__lead">{{ $t('Connectors.conn.admin_lead') }}</p>

        <p v-if="loadError" class="ah-field__error" data-test="ac-load-error">{{ loadError }}</p>
        <p v-else-if="!rows.length && !loading" class="ah-small" data-test="ac-empty">{{ $t('Connectors.conn.admin_empty') }}</p>

        <div v-else class="ac__table" role="table">
            <div class="ac__head" role="row">
                <span role="columnheader">{{ $t('Connectors.conn.col_member') }}</span>
                <span role="columnheader">{{ $t('Connectors.conn.col_provider') }}</span>
                <span role="columnheader">{{ $t('Connectors.conn.col_products') }}</span>
                <span role="columnheader">{{ $t('Connectors.conn.col_status') }}</span>
                <span role="columnheader">{{ $t('Connectors.conn.col_used') }}</span>
                <span role="columnheader" class="ac__end-col"></span>
            </div>
            <div v-for="row in rows" :key="row.connectionId" class="ac__row" role="row" :data-test="`ac-row-${row.connectionId}`">
                <span role="cell" class="ac__member">{{ memberName(row.userId) }}</span>
                <span role="cell">{{ label(row.provider) }}</span>
                <span role="cell" class="ac__products">
                    <span v-if="row.products.length" class="ac__chips">
                        <span v-for="product in row.products" :key="product" class="ah-chip ah-chip--mono">{{ productName(product) }}</span>
                    </span>
                    <span v-else class="ah-small">—</span>
                    <span v-if="row.scopes.length" class="ah-small ac__scopes">{{ row.scopes.join(' · ') }}</span>
                </span>
                <span role="cell" class="ac__status">
                    <span class="ah-dot" :class="row.status === 'connected' ? 'ah-dot--ok' : 'ah-dot--warn'"></span>
                    {{ status(row.status) }}
                </span>
                <span role="cell" class="ah-small">{{ row.lastUsedAt ? date(row.lastUsedAt) : $t('Connectors.conn.never_used') }}</span>
                <span role="cell" class="ac__end-col">
                    <button
                        type="button"
                        class="ah-btn ah-btn--ghost ah-btn--sm ac__danger"
                        :disabled="busy === row.connectionId"
                        :data-test="`ac-end-${row.connectionId}`"
                        @click="end(row)"
                    >{{ busy === row.connectionId ? $t('Connectors.conn.ending') : $t('Connectors.conn.end') }}</button>
                </span>
                <span v-if="errors[row.connectionId]" role="cell" class="ah-field__error ac__row-error" :data-test="`ac-error-${row.connectionId}`">{{ errors[row.connectionId] }}</span>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { isOwnerOrAdmin } from "@/utils/roles";
import { membersOnly } from "@/views/Workflows/approvalOwners";
import { providerLabel, productLabel, statusLabel, formatDate } from "./connectorLabels";

defineOptions({ name: "AdminConnections" });

const { t, te } = useI18n();
const { getters } = useStore();

const rows = ref([]);
const errors = reactive({});
const busy = ref("");
const loading = ref(false);
const loadError = ref("");

const privileged = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
const members = computed(() => {
    const map = {};
    membersOnly(getters["users/users"], getters["settings/companyUsers"]).forEach((user) => { map[String(user._id)] = user.Employee_Name; });
    return map;
});

const label = (id) => providerLabel(t, te, id);
const productName = (product) => productLabel(t, te, product);
const status = (value) => statusLabel(t, te, value);
const date = (value) => formatDate(value);
const memberName = (userId) => members.value[String(userId)] || t("Connectors.conn.former_member");

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", `${env.CONNECTORS}/members`);
        if (!res?.data?.status) { loadError.value = res?.data?.statusText || t("Connectors.conn.admin_load_failed"); return; }
        rows.value = res.data.data?.connections || [];
    } catch (e) {
        loadError.value = e?.response?.data?.statusText || t("Connectors.conn.admin_load_failed");
    } finally {
        loading.value = false;
    }
};

const end = async (row) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t("Connectors.conn.confirm_end", { member: memberName(row.userId), provider: label(row.provider) }))) return;
    busy.value = row.connectionId;
    errors[row.connectionId] = "";
    try {
        const res = await apiRequest("delete", `${env.CONNECTORS}/connections/${row.connectionId}`);
        if (!res?.data?.status) { errors[row.connectionId] = res?.data?.statusText || t("Connectors.conn.end_failed"); return; }
        await load();
    } catch (e) {
        errors[row.connectionId] = e?.response?.data?.statusText || t("Connectors.conn.end_failed");
    } finally {
        busy.value = "";
    }
};

// After a reload the seat arrives once the screen is up, so the members' connections are read when it does.
watch(privileged, (isPrivileged) => { if (isPrivileged && !rows.value.length) load(); }, { immediate: true });
</script>

<style scoped>
.ac { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-bottom: 14px; background: var(--surface); }
.ac__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.ac__lead { margin: 0; color: var(--ink-2); }
.ac__table { display: flex; flex-direction: column; }
.ac__head, .ac__row { display: grid; grid-template-columns: 1.2fr 0.9fr 2fr 1fr 1fr auto; gap: 8px 12px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--hairline); }
.ac__head { font: 600 12px/1.3 var(--font-ui); color: var(--ink-label); }
.ac__member { color: var(--ink); overflow-wrap: anywhere; }
.ac__products { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ac__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ac__scopes { color: var(--ink-2); overflow-wrap: anywhere; }
.ac__status { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); }
.ac__end-col { justify-self: end; }
.ac__danger { color: var(--danger-ink, var(--ink)); }
.ac__row-error { grid-column: 1 / -1; }
@media (max-width: 767px) {
    .ac__head { display: none; }
    .ac__row { grid-template-columns: 1fr; gap: 4px; }
    .ac__end-col { justify-self: start; }
}
</style>
