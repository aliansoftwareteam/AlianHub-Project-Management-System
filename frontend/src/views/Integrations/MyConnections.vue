<template>
    <section class="ah-card mc" data-test="my-connections" aria-labelledby="my-connections-title">
        <div id="my-connections-title" class="mc__title">{{ $t('Connectors.conn.my_title') }}</div>
        <p class="ah-small mc__lead">{{ $t('Connectors.conn.my_lead') }}</p>

        <p v-if="notice" class="ah-small mc__notice" role="status" data-test="mc-notice">{{ notice }}</p>
        <p v-if="loadError" class="ah-field__error" data-test="mc-load-error">{{ loadError }}</p>
        <p v-else-if="!providers.length && !loading" class="ah-small" data-test="mc-empty">{{ $t('Connectors.conn.my_empty') }}</p>

        <div class="mc__list">
            <article v-for="p in providers" :key="p.provider" class="mc__row" :data-test="`mc-row-${p.provider}`">
                <div class="mc__head">
                    <strong class="mc__name">{{ label(p.provider) }}</strong>
                    <span class="ah-dot" :class="dotClass(p)"></span>
                    <span v-if="p.connected" class="ah-small mc__state">{{ status(p.status) }}</span>
                </div>

                <p v-if="p.connected && p.account && p.account.label" class="ah-small mc__account">
                    {{ $t('Connectors.conn.account') }}: {{ p.account.label }}
                </p>

                <p v-if="isBroken(p)" class="ah-small mc__warn" :data-test="`mc-${p.provider}-broken`">{{ $t('Connectors.conn.broken_note') }}</p>
                <p v-if="isReauth(p)" class="ah-small mc__warn" :data-test="`mc-${p.provider}-reauth`">{{ $t('Connectors.conn.reauth_note') }}</p>

                <div v-if="p.products.length" class="mc__products">
                    <span class="ah-field__label">{{ $t('Connectors.conn.products_label') }}</span>
                    <label v-for="product in p.products" :key="product" class="mc__product">
                        <input
                            type="checkbox"
                            :checked="picked[p.provider].includes(product)"
                            :disabled="busy === p.provider"
                            :data-test="`mc-${p.provider}-product-${product}`"
                            @change="toggle(p.provider, product)"
                        />
                        <span>{{ productName(product) }}</span>
                    </label>
                </div>
                <p v-else class="ah-small mc__hint">{{ $t('Connectors.conn.no_products') }}</p>

                <div v-if="p.connected && p.scopes.length" class="mc__scopes">
                    <span class="ah-field__label">{{ $t('Connectors.conn.scopes_label') }}</span>
                    <span v-for="scope in p.scopes" :key="scope" class="ah-chip ah-chip--mono mc__scope">{{ scope }}</span>
                </div>

                <div v-if="p.connected" class="mc__meta ah-small">
                    <span v-if="p.connectedAt">{{ $t('Connectors.conn.connected_on', { date: date(p.connectedAt) }) }}</span>
                    <span>{{ p.lastUsedAt ? $t('Connectors.conn.last_used', { date: date(p.lastUsedAt) }) : $t('Connectors.conn.never_used') }}</span>
                    <span class="mc__hint">{{ $t('Connectors.conn.usage_zero_note') }}</span>
                </div>

                <p v-if="errors[p.provider]" class="ah-field__error" role="alert" :data-test="`mc-${p.provider}-error`">{{ errors[p.provider] }}</p>

                <div class="mc__actions">
                    <button
                        v-if="!p.connected"
                        type="button"
                        class="ah-btn ah-btn--primary ah-btn--sm"
                        :disabled="busy === p.provider"
                        :data-test="`mc-${p.provider}-connect`"
                        @click="connect(p)"
                    >{{ busy === p.provider ? $t('Connectors.conn.connecting') : $t('Connectors.conn.connect') }}</button>

                    <template v-else>
                        <button
                            v-if="p.products.length"
                            type="button"
                            class="ah-btn ah-btn--secondary ah-btn--sm"
                            :disabled="busy === p.provider || !changed(p)"
                            :data-test="`mc-${p.provider}-save`"
                            @click="saveProducts(p)"
                        >{{ busy === p.provider ? $t('Connectors.conn.saving') : $t('Connectors.conn.save_products') }}</button>
                        <button
                            v-if="needsReconnect(p)"
                            type="button"
                            class="ah-btn ah-btn--primary ah-btn--sm"
                            :disabled="busy === p.provider"
                            :data-test="`mc-${p.provider}-reconnect`"
                            @click="connect(p)"
                        >{{ busy === p.provider ? $t('Connectors.conn.connecting') : $t('Connectors.conn.reconnect') }}</button>
                        <button
                            type="button"
                            class="ah-btn ah-btn--ghost ah-btn--sm mc__danger"
                            :disabled="busy === p.provider"
                            :data-test="`mc-${p.provider}-disconnect`"
                            @click="disconnect(p)"
                        >{{ busy === p.provider ? $t('Connectors.conn.disconnecting') : $t('Connectors.conn.disconnect') }}</button>
                    </template>
                </div>
            </article>
        </div>
    </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { providerLabel, productLabel, statusLabel, formatDate } from "./connectorLabels";

defineOptions({ name: "MyConnections" });

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();

const providers = ref([]);
const picked = reactive({});
const errors = reactive({});
const busy = ref("");
const loading = ref(true);
const loadError = ref("");
const notice = ref("");

const label = (id) => providerLabel(t, te, id);
const productName = (product) => productLabel(t, te, product);
const status = (value) => statusLabel(t, te, value);
const date = (value) => formatDate(value);

const isBroken = (p) => p.connected && p.status === "broken";
const isReauth = (p) => p.connected && p.status === "reauth_required";
const needsReconnect = (p) => isBroken(p) || isReauth(p);
const dotClass = (p) => (p.connected && p.status === "connected" ? "ah-dot--ok" : p.connected ? "ah-dot--warn" : "ah-dot--off");

// What the server holds now for each connected provider, so "changed" compares the ticks against it.
const held = reactive({});
const sorted = (list) => [...list].sort();
const same = (a, b) => a.length === b.length && sorted(a).every((value, i) => value === sorted(b)[i]);
const changed = (p) => !same(picked[p.provider] || [], held[p.provider] || []);

const toggle = (provider, product) => {
    errors[provider] = "";
    const list = picked[provider] || [];
    picked[provider] = list.includes(product) ? list.filter((value) => value !== product) : [...list, product];
};

/* The list endpoint gives each provider's offered products and the person's own connection. The connection's own
 * products are the ones ticked for a connected provider; a provider with none connected starts with all offered. */
const toRows = (data) => {
    const offered = data.providers || [];
    const byProvider = {};
    (data.connections || []).forEach((conn) => { byProvider[conn.provider] = conn; });
    return offered.map((entry) => {
        const conn = byProvider[entry.provider] || {};
        const connected = Boolean(conn.connected);
        const ticked = connected ? conn.products || [] : [];
        return {
            provider: entry.provider,
            products: entry.products || [],
            connected,
            status: conn.status || null,
            account: conn.account || null,
            scopes: conn.scopes || [],
            connectionId: conn.connectionId || null,
            connectedAt: conn.connectedAt || null,
            lastUsedAt: conn.lastUsedAt || null,
            ticked,
        };
    });
};

const applyRows = (rows) => {
    providers.value = rows;
    rows.forEach((row) => {
        held[row.provider] = [...row.ticked];
        picked[row.provider] = row.connected ? [...row.ticked] : [...row.products];
        if (!(row.provider in errors)) errors[row.provider] = "";
    });
};

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", env.CONNECTORS);
        if (!res?.data?.status) { loadError.value = res?.data?.statusText || t("Connectors.conn.load_failed"); return; }
        applyRows(toRows(res.data.data || {}));
    } catch (e) {
        loadError.value = e?.response?.data?.statusText || t("Connectors.conn.load_failed");
    } finally {
        loading.value = false;
    }
};

const goTo = (url) => { if (url) window.location.assign(url); };

const connect = async (p) => {
    busy.value = p.provider;
    errors[p.provider] = "";
    try {
        const res = await apiRequest("post", `${env.CONNECTORS}/${p.provider}/connect`, { products: picked[p.provider] || [] });
        if (!res?.data?.status || !res.data.data?.url) { errors[p.provider] = res?.data?.statusText || t("Connectors.conn.connect_failed"); busy.value = ""; return; }
        goTo(res.data.data.url);
    } catch (e) {
        errors[p.provider] = e?.response?.data?.statusText || t("Connectors.conn.connect_failed");
        busy.value = "";
    }
};

const saveProducts = async (p) => {
    if (!p.connectionId) return;
    busy.value = p.provider;
    errors[p.provider] = "";
    try {
        const res = await apiRequest("put", `${env.CONNECTORS}/connections/${p.connectionId}/products`, { products: picked[p.provider] || [] });
        if (!res?.data?.status || !res.data.data?.url) { errors[p.provider] = res?.data?.statusText || t("Connectors.conn.connect_failed"); busy.value = ""; return; }
        goTo(res.data.data.url);
    } catch (e) {
        errors[p.provider] = e?.response?.data?.statusText || t("Connectors.conn.connect_failed");
        busy.value = "";
    }
};

const disconnect = async (p) => {
    if (!p.connectionId) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(t("Connectors.conn.confirm_disconnect", { provider: label(p.provider) }))) return;
    busy.value = p.provider;
    errors[p.provider] = "";
    try {
        const res = await apiRequest("delete", `${env.CONNECTORS}/connections/${p.connectionId}`);
        if (!res?.data?.status) { errors[p.provider] = res?.data?.statusText || t("Connectors.conn.disconnect_failed"); return; }
        await load();
    } catch (e) {
        errors[p.provider] = e?.response?.data?.statusText || t("Connectors.conn.disconnect_failed");
    } finally {
        busy.value = "";
    }
};

/* The provider's redirect sends the browser back here in the URL fragment, which no server sees: on success a
 * state and code to finish the connection, on failure a result and reason. Either way the return is cleared from
 * the address once read. */
const RETURN_KEYS = ["connector", "state", "code", "result", "reason"];
const clearReturn = () => {
    const query = { ...route.query };
    if (!RETURN_KEYS.some((key) => key in query)) return;
    RETURN_KEYS.forEach((key) => delete query[key]);
    router.replace({ query });
};

const complete = async (provider, state, code) => {
    try {
        const res = await apiRequest("post", `${env.CONNECTORS}/${provider}/complete`, { state, code });
        notice.value = res?.data?.status
            ? t("Connectors.conn.return_ok", { provider: label(provider) })
            : (res?.data?.statusText || t("Connectors.conn.return_error", { provider: label(provider) }));
    } catch (e) {
        notice.value = e?.response?.data?.statusText || t("Connectors.conn.return_error", { provider: label(provider) });
    }
};

/* Microsoft answers access_denied both when the person declines and when their organisation lets only an admin
 * approve apps, so the message names the admin route rather than guess which it was. */
const CONSENT_REFUSED = ["access_denied", "consent_required"];

const handleReturn = async () => {
    const { connector, state, code, result, reason } = route.query;
    if (!connector) return;
    if (state && code) await complete(String(connector), String(state), String(code));
    else if (result === "error") {
        const key = CONSENT_REFUSED.includes(String(reason)) ? "Connectors.conn.return_consent" : "Connectors.conn.return_error";
        notice.value = t(key, { provider: label(String(connector)) });
    }
    clearReturn();
};

onMounted(async () => {
    await handleReturn();
    await load();
});
</script>

<style scoped>
.mc { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-bottom: 14px; background: var(--surface); }
.mc__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.mc__lead { margin: 0; color: var(--ink-2); }
.mc__notice { margin: 0; color: var(--ink); }
.mc__list { display: flex; flex-direction: column; gap: 10px; }
.mc__row { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.mc__row:first-child { border-top: 0; }
.mc__head { display: flex; align-items: center; gap: 8px; }
.mc__name { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.mc__state { color: var(--ink-2); }
.mc__account { margin: 0; color: var(--ink-2); }
.mc__warn { margin: 0; color: var(--warn-ink); }
.mc__hint { color: var(--ink-2); }
.mc__products { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.mc__product { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); }
.mc__scopes { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mc__scope { height: 18px; }
.mc__meta { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--ink-2); }
.mc__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mc__danger { margin-left: auto; color: var(--danger-ink, var(--ink)); }
.ah-dot--off { background: var(--ink-3, var(--ink-2)); }
</style>
