<template>
    <div class="cx" data-test="cx-connectors">
        <header class="cx__head">
            <div class="cx__intro">
                <h2 class="ah-h2">{{ $t('Connectors.screen.connectors_title') }}</h2>
                <p class="cx__lead">{{ $t('Connectors.screen.connectors_lead') }}</p>
            </div>
            <div v-if="privileged" class="cx__add">
                <button
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm cx__add-btn"
                    aria-disabled="true"
                    :aria-describedby="addNoteId"
                    data-test="cx-add-custom"
                    @click="emit('add-custom')"
                >
                    <ShellIcon name="plus" :size="14" />{{ $t('Connectors.screen.add_custom') }}
                </button>
                <span :id="addNoteId" class="ah-small">{{ $t('Connectors.screen.add_custom_soon') }}</span>
            </div>
        </header>

        <p v-if="notice" class="cx__notice" role="status" data-test="cx-notice">{{ notice }}</p>

        <p v-if="guest" class="ah-empty" data-test="cx-guest">{{ $t('Connectors.screen.guest') }}</p>
        <p v-else-if="!available && !legacyGoogle" class="ah-empty" data-test="cx-off">{{ $t('Connectors.conn.my_empty') }}</p>
        <template v-else-if="available">
            <p v-if="loadError" class="ah-field__error" role="alert" data-test="cx-load-error">{{ loadError }}</p>
            <p v-else-if="loading" class="ah-small" data-test="cx-loading">{{ $t('Connectors.screen.loading') }}</p>

            <template v-else>
                <section class="cx-section" :aria-labelledby="`${uid}-mine`" data-test="cx-mine">
                    <h3 :id="`${uid}-mine`" class="ah-label">{{ $t('Connectors.screen.yours_title') }}</h3>
                    <p v-if="!mine.length" class="ah-empty" data-test="cx-mine-empty">{{ $t('Connectors.screen.yours_empty') }}</p>
                    <ul v-else class="ah-card cx-mine" role="list">
                        <li
                            v-for="row in mine"
                            :key="row.provider"
                            class="cx-row"
                            :class="{ 'cx-row--attention': needsAttention(row) }"
                            :data-test="`cx-mine-${row.provider}`"
                        >
                            <button type="button" class="cx-row__open" :aria-label="$t('Connectors.screen.open_detail', { provider: name(row.provider) })" :data-test="`cx-open-${row.provider}`" @click="openDetail(row)">
                                <ConnectorTile :provider="row.provider" :name="name(row.provider)" />
                                <span class="cx-row__text">
                                    <span class="cx-row__name">{{ name(row.provider) }}</span>
                                    <span v-if="row.connection.account && row.connection.account.label" class="cx-row__account" data-test="cx-account">{{ row.connection.account.label }}</span>
                                </span>
                            </button>
                            <span class="cx-row__meta">
                                <span class="cx-row__status" :data-test="`cx-status-${row.provider}`">
                                    <span class="ah-dot" :class="statusDot(row)" aria-hidden="true"></span>
                                    <span>{{ statusText(row) }}</span>
                                </span>
                                <span class="ah-small">{{ usedText(row) }}</span>
                            </span>
                            <button
                                v-if="needsAttention(row)"
                                type="button"
                                class="ah-btn ah-btn--primary ah-btn--sm cx-row__action"
                                :disabled="busy === row.provider"
                                :data-test="`cx-reconnect-${row.provider}`"
                                @click="reconnect(row)"
                            >{{ busy === row.provider ? $t('Connectors.conn.connecting') : $t('Connectors.conn.reconnect') }}</button>
                            <button
                                v-else
                                type="button"
                                class="ah-btn ah-btn--ghost ah-btn--sm cx-row__action"
                                :aria-label="$t('Connectors.screen.open_detail', { provider: name(row.provider) })"
                                @click="openDetail(row)"
                            >{{ $t('Connectors.screen.manage') }}</button>
                            <p v-if="errors[row.provider]" class="ah-field__error cx-row__error" role="alert">{{ errors[row.provider] }}</p>
                        </li>
                    </ul>
                </section>

                <section class="cx-section" :aria-labelledby="`${uid}-browse`" data-test="cx-browse">
                    <div class="cx-section__head">
                        <h3 :id="`${uid}-browse`" class="ah-label">{{ $t('Connectors.screen.browse_title') }}</h3>
                        <div v-if="browseAll.length" class="cx-filters">
                            <label class="cx-search">
                                <span class="ah-sr-only">{{ $t('Connectors.screen.search_label') }}</span>
                                <ShellIcon name="search" :size="14" class="cx-search__icon" />
                                <input v-model="query" type="search" class="ah-input cx-search__input" :placeholder="$t('Connectors.screen.search_placeholder')" data-test="cx-search" />
                            </label>
                            <label class="cx-category">
                                <span class="ah-sr-only">{{ $t('Connectors.screen.category_label') }}</span>
                                <select v-model="category" class="ah-input" data-test="cx-category">
                                    <option :value="ALL_CATEGORIES">{{ $t('Connectors.screen.category_all') }}</option>
                                    <option v-for="key in categories" :key="key" :value="key">{{ categoryName(key) }}</option>
                                </select>
                            </label>
                        </div>
                    </div>

                    <p v-if="!browseAll.length" class="ah-empty" data-test="cx-browse-empty">{{ mine.length ? $t('Connectors.screen.browse_all_connected') : $t('Connectors.conn.my_empty') }}</p>
                    <p v-else-if="!shown.length" class="ah-empty" data-test="cx-browse-none">{{ $t('Connectors.screen.browse_no_match') }}</p>
                    <ul v-else class="cx-grid" role="list">
                        <li v-for="row in shown" :key="row.provider" class="ah-card cx-card" :class="{ 'cx-card--off': row.unavailable }" :data-test="`cx-card-${row.provider}`">
                            <div class="cx-card__top">
                                <ConnectorTile :provider="row.provider" :name="name(row.provider)" />
                                <div class="cx-card__id">
                                    <span class="cx-card__name">{{ name(row.provider) }}</span>
                                    <span class="ah-chip ah-chip--sm cx-card__category">{{ categoryName(categoryOf(row.provider)) }}</span>
                                </div>
                            </div>
                            <p class="cx-card__line">{{ line(row.provider) }}</p>
                            <div class="cx-card__foot">
                                <template v-if="row.unavailable">
                                    <p class="ah-small cx-card__why" :data-test="`cx-why-${row.provider}`">
                                        {{ privileged ? $t('Connectors.screen.setup_admin', { provider: name(row.provider) }) : $t('Connectors.screen.setup_member', { provider: name(row.provider) }) }}
                                    </p>
                                    <button
                                        v-if="privileged"
                                        type="button"
                                        class="ah-btn ah-btn--secondary ah-btn--sm"
                                        :data-test="`cx-setup-${row.provider}`"
                                        @click="emit('open-workspace')"
                                    >{{ $t('Connectors.screen.setup') }}</button>
                                </template>
                                <button
                                    v-else
                                    type="button"
                                    class="ah-btn ah-btn--secondary ah-btn--sm"
                                    :disabled="busy === row.provider"
                                    :aria-label="$t('Connectors.screen.connect_named', { provider: name(row.provider) })"
                                    :data-test="`cx-connect-${row.provider}`"
                                    @click="connect(row)"
                                >{{ busy === row.provider ? $t('Connectors.conn.connecting') : $t('Connectors.conn.connect') }}</button>
                            </div>
                            <p v-if="errors[row.provider]" class="ah-field__error" role="alert">{{ errors[row.provider] }}</p>
                        </li>
                    </ul>
                </section>
            </template>
        </template>

        <GoogleConnection v-if="legacyGoogle && !guest" />

        <ConnectorSignIn v-if="signingIn" :row="signingIn" :name="name(signingIn.provider)" @close="signingIn = null" @connected="onTokenConnected" />
        <ConnectorDetail
            v-if="detailRow"
            :row="detailRow"
            :name="name(detailRow.provider)"
            :privileged="privileged"
            @close="detailProvider = ''"
            @changed="onChanged"
            @disconnected="onDisconnected"
            @reconnect="reconnect"
        />
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import GoogleConnection from "./GoogleConnection.vue";
import ConnectorTile from "./ConnectorTile.vue";
import ConnectorSignIn from "./ConnectorSignIn.vue";
import ConnectorDetail from "./ConnectorDetail.vue";
import { connectorApi, goToConsent } from "./connectorApi";
import { formatDate, providerLabel, statusLabel } from "./connectorLabels";
import {
    ALL_CATEGORIES, LEGACY_GOOGLE_CONNECTOR, asksBeforeConnect, categoriesIn, categoryOf, connectorRows, filterBrowse, needsAttention, sortMine, statusDot, takesOauth
} from "./connectorCatalog";

defineOptions({ name: "ConnectorsTab" });

const props = defineProps({
    available: { type: Boolean, default: false },
    guest: { type: Boolean, default: false },
    privileged: { type: Boolean, default: false },
    legacyGoogle: { type: Boolean, default: false }
});
const emit = defineEmits(["add-custom", "open-workspace"]);

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const uid = `cx-${useId()}`;
const addNoteId = `${uid}-add-note`;

const loading = ref(true);
const loadError = ref("");
const notice = ref("");
const rows = ref({ mine: [], browse: [], unavailable: [] });
const errors = reactive({});
const busy = ref("");
const query = ref("");
const category = ref(ALL_CATEGORIES);
const signingIn = ref(null);
const detailProvider = ref("");

const name = (provider) => providerLabel(t, te, provider);
const line = (provider) => {
    const key = `Connectors.catalog.${provider}_line`;
    return te(key) ? t(key) : t("Connectors.catalog.default_line", { provider: name(provider) });
};
const categoryName = (key) => t(`Connectors.catalog.category_${key}`);
const statusText = (row) => (needsAttention(row) ? statusLabel(t, te, row.connection.status) : t("Connectors.conn.status_connected"));
const usedText = (row) => (row.connection.lastUsedAt ? t("Connectors.conn.last_used", { date: formatDate(row.connection.lastUsedAt) }) : t("Connectors.conn.never_used"));

const mine = computed(() => sortMine(rows.value.mine, name));
const browseAll = computed(() => [...rows.value.browse, ...rows.value.unavailable.map((row) => ({ ...row, unavailable: true }))]
    .sort((a, b) => name(a.provider).localeCompare(name(b.provider))));
const categories = computed(() => categoriesIn(browseAll.value));
const shown = computed(() => filterBrowse(browseAll.value, { query: query.value, category: category.value }, (row) => [name(row.provider), line(row.provider), categoryName(categoryOf(row.provider))]));
const detailRow = computed(() => rows.value.mine.find((row) => row.provider === detailProvider.value) || null);

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        rows.value = connectorRows(await connectorApi.list());
    } catch (e) {
        loadError.value = e.message || t("Connectors.conn.load_failed");
    } finally {
        loading.value = false;
    }
};

const openDetail = (row) => { detailProvider.value = row.provider; };

const startOauth = async (row, products) => {
    busy.value = row.provider;
    errors[row.provider] = "";
    try {
        const out = await connectorApi.connect(row.provider, products);
        if (!out?.url) throw new Error("");
        goToConsent(out.url);
    } catch (e) {
        errors[row.provider] = e.message || t("Connectors.conn.connect_failed");
        busy.value = "";
    }
};

const connect = (row) => {
    if (asksBeforeConnect(row)) signingIn.value = row;
    else startOauth(row, row.products);
};

const reconnect = (row) => {
    detailProvider.value = "";
    const held = row.connection && row.connection.products && row.connection.products.length ? row.connection.products : row.products;
    if (asksBeforeConnect(row) || !takesOauth(row)) signingIn.value = row;
    else startOauth(row, held);
};

const onTokenConnected = async () => {
    const provider = signingIn.value && signingIn.value.provider;
    signingIn.value = null;
    notice.value = t("Connectors.conn.return_ok", { provider: name(provider) });
    await load();
};

const onChanged = (view) => {
    if (!view || !view.provider) return;
    rows.value = { ...rows.value, mine: rows.value.mine.map((row) => (row.provider === view.provider ? { ...row, connection: view } : row)) };
};

const onDisconnected = async (provider) => {
    detailProvider.value = "";
    notice.value = t("Connectors.screen.disconnected", { provider: name(provider) });
    await load();
};

/* The provider sends the browser back with a state and code (or an error) in the address, which no server sees;
 * they are read once and taken out. The old Google Calendar card reads its own. */
const RETURN_KEYS = ["connector", "state", "code", "result", "reason"];
const clearReturn = () => {
    const left = { ...route.query };
    RETURN_KEYS.forEach((key) => delete left[key]);
    return router.replace({ query: left });
};

/* Microsoft answers access_denied both when the person declines and when their organisation lets only an admin
 * approve apps, so the message names the admin route rather than guess which it was. */
const CONSENT_REFUSED = ["access_denied", "consent_required"];

const handleReturn = async () => {
    const { connector, state, code, result, reason } = route.query || {};
    if (!connector || connector === LEGACY_GOOGLE_CONNECTOR) return;
    const provider = String(connector);
    if (state && code) {
        try {
            await connectorApi.complete(provider, String(state), String(code));
            notice.value = t("Connectors.conn.return_ok", { provider: name(provider) });
        } catch (e) {
            notice.value = e.message || t("Connectors.conn.return_error", { provider: name(provider) });
        }
    } else if (result === "error") {
        const key = CONSENT_REFUSED.includes(String(reason)) ? "Connectors.conn.return_consent" : "Connectors.conn.return_error";
        notice.value = t(key, { provider: name(provider) });
    }
    await clearReturn();
};

onMounted(async () => {
    if (!props.available || props.guest) return;
    await handleReturn();
    await load();
});
</script>

<style scoped>
.cx { display: flex; flex-direction: column; gap: 18px; min-width: 0; max-width: 1080px; }
.cx__head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px 16px; }
.cx__intro { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 680px; }
.cx__lead { margin: 0; font: var(--text-body); color: var(--ink-2); }
.cx__add { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.cx__add-btn[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.cx__notice { margin: 0; padding: 10px 14px; border-radius: var(--r-card); background: var(--surface); border: 1px solid var(--hairline); font: var(--text-body); color: var(--ink); }

.cx-section { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.cx-section__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.cx-section .ah-empty { margin: 0; }

.cx-mine { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cx-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 14px; border-top: 1px solid var(--hairline); }
.cx-row:first-child { border-top: 0; }
.cx-row--attention { background: var(--warn-bg); }
.cx-row__open { flex: 1 1 220px; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--ink); border-radius: var(--r-input); }
.cx-row__open:focus-visible { outline: none; box-shadow: var(--focus); }
.cx-row__text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cx-row__name { font: 600 13.5px/1.3 var(--font-ui); color: var(--ink); }
.cx-row__account { font: var(--text-small); color: var(--ink-2); overflow-wrap: anywhere; }
.cx-row__meta { display: flex; flex-direction: column; gap: 2px; min-width: 140px; }
.cx-row__status { display: inline-flex; align-items: center; gap: 6px; font: var(--text-small); color: var(--ink); }
.cx-row__action { flex: none; }
.cx-row__error { width: 100%; margin: 0; }

.cx-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.cx-search { position: relative; display: flex; align-items: center; }
.cx-search__icon { position: absolute; left: 10px; color: var(--ink-2); pointer-events: none; }
.cx-search__input { width: 220px; padding-left: 30px; }
.cx-category .ah-input { width: auto; min-width: 160px; }

.cx-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 12px; }
.cx-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; min-width: 0; }
.cx-card__top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cx-card__id { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
.cx-card__name { font: 600 13.5px/1.3 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.cx-card__line { flex: 1; margin: 0; font: var(--text-small); color: var(--ink-2); }
.cx-card__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cx-card__why { margin: 0; flex: 1 1 100%; }
.cx-card--off .cx-card__top { opacity: .7; }

@media (max-width: 640px) {
    .cx__add { align-items: flex-start; }
    .cx-filters, .cx-search, .cx-category { width: 100%; }
    .cx-search__input, .cx-category .ah-input { width: 100%; }
    .cx-row__meta { min-width: 0; flex: 1 1 auto; }
    .cx-row .ah-btn, .cx-card__foot .ah-btn { min-height: 40px; }
}
</style>
