<template>
    <Teleport to="body">
        <div class="cx-drawer-backdrop" @click.self="close">
            <Transition name="ah-slide-right" appear>
                <aside
                    ref="box"
                    class="cx-drawer"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="titleId"
                    tabindex="-1"
                    data-test="cx-detail"
                    @keydown.esc.stop.prevent="close"
                >
                    <header class="cx-drawer__head">
                        <ConnectorTile :provider="row.provider" :name="name" size="lg" />
                        <div class="cx-drawer__id">
                            <h2 :id="titleId" class="ah-h2 cx-drawer__title">{{ name }}</h2>
                            <span class="cx-drawer__status">
                                <span class="ah-dot" :class="statusDot(row)" aria-hidden="true"></span>
                                <span>{{ statusText }}</span>
                            </span>
                        </div>
                        <button ref="closer" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Connectors.detail.close')" data-test="cx-detail-close" @click="close">
                            <ShellIcon name="x" :size="15" />
                        </button>
                    </header>

                    <div class="cx-drawer__body ah-scroll">
                        <div v-if="attention" class="cx-drawer__alert" role="alert" data-test="cx-detail-attention">
                            <p class="cx-drawer__alert-text">{{ connection.status === 'reauth_required' ? $t('Connectors.conn.reauth_note') : $t('Connectors.conn.broken_note') }}</p>
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="cx-detail-reconnect" @click="emit('reconnect', row)">{{ $t('Connectors.conn.reconnect') }}</button>
                        </div>

                        <dl class="cx-facts">
                            <div v-if="connection.account && connection.account.label" class="cx-facts__row">
                                <dt>{{ $t('Connectors.conn.account') }}</dt>
                                <dd data-test="cx-detail-account">{{ connection.account.label }}</dd>
                            </div>
                            <div class="cx-facts__row">
                                <dt>{{ $t('Connectors.detail.signed_in_with') }}</dt>
                                <dd>{{ connection.signIn === 'personal_token' ? $t('Connectors.detail.sign_in_token') : $t('Connectors.detail.sign_in_oauth') }}</dd>
                            </div>
                            <div v-if="connection.connectedAt" class="cx-facts__row">
                                <dt>{{ $t('Connectors.conn.col_connected') }}</dt>
                                <dd>{{ date(connection.connectedAt) }}</dd>
                            </div>
                            <div class="cx-facts__row">
                                <dt>{{ $t('Connectors.conn.col_used') }}</dt>
                                <dd>{{ connection.lastUsedAt ? date(connection.lastUsedAt) : $t('Connectors.conn.never_used') }}</dd>
                            </div>
                        </dl>

                        <section v-if="editsProducts" class="cx-drawer__section" :aria-labelledby="`${titleId}-products`">
                            <h3 :id="`${titleId}-products`" class="ah-label">{{ $t('Connectors.conn.products_label') }}</h3>
                            <div class="cx-drawer__products">
                                <label v-for="product in row.products" :key="product" class="cx-drawer__product">
                                    <input
                                        type="checkbox"
                                        class="ah-check"
                                        :checked="picked.includes(product)"
                                        :disabled="busy === 'products'"
                                        :data-test="`cx-detail-product-${product}`"
                                        @change="toggleProduct(product)"
                                    />
                                    <span>{{ productName(product) }}</span>
                                </label>
                            </div>
                            <p class="ah-field__hint cx-drawer__hint">{{ $t('Connectors.detail.products_hint', { provider: name }) }}</p>
                            <button
                                type="button"
                                class="ah-btn ah-btn--secondary ah-btn--sm"
                                :disabled="busy === 'products' || !productsChanged || !picked.length"
                                data-test="cx-detail-products-save"
                                @click="saveProducts"
                            >{{ busy === 'products' ? $t('Connectors.conn.connecting') : $t('Connectors.conn.save_products') }}</button>
                        </section>

                        <section class="cx-drawer__section" :aria-labelledby="`${titleId}-tools`">
                            <h3 :id="`${titleId}-tools`" class="ah-label">{{ $t('Connectors.detail.tools_title') }}</h3>
                            <p class="ah-field__hint cx-drawer__hint">{{ $t('Connectors.detail.tools_lead') }}</p>
                            <p v-if="toolsError" class="ah-field__error" role="alert">{{ toolsError }}</p>
                            <p v-else-if="toolsLoading" class="ah-small">{{ $t('Connectors.detail.tools_loading') }}</p>
                            <p v-else-if="!tools.length" class="ah-small">{{ $t('Connectors.detail.tools_none') }}</p>
                            <ul v-else class="cx-tools" role="list">
                                <li v-for="tool in tools" :key="tool.key" class="cx-tools__row" :data-test="`cx-tool-${tool.key}`">
                                    <span class="cx-tools__text">
                                        <span class="cx-tools__name">{{ toolName(tool) }}</span>
                                        <span class="cx-tools__chips">
                                            <span class="ah-chip ah-chip--sm" :class="tool.kind === 'write' ? 'ah-chip--warn' : ''">{{ $t(`Connectors.detail.kind_${tool.kind}`) }}</span>
                                            <span v-if="!tool.on" class="ah-chip ah-chip--sm" :data-test="`cx-tool-workspace-off-${tool.key}`">{{ $t('Connectors.detail.workspace_off') }}</span>
                                        </span>
                                    </span>
                                    <AhSwitch
                                        :model-value="tool.on && !toolsOff.includes(tool.key)"
                                        :disabled="!tool.on || busy === tool.key"
                                        :label="$t('Connectors.detail.tool_switch', { tool: toolName(tool) })"
                                        :data-test="`cx-tool-switch-${tool.key}`"
                                        @update:model-value="(on) => setTool(tool, on)"
                                    />
                                </li>
                            </ul>
                            <p class="ah-small cx-drawer__status" role="status">{{ toolStatus }}</p>
                        </section>

                        <ConnectorToolReviews v-if="privileged" class="cx-drawer__section" :providers="[row.provider]" quiet @reviewed="loadTools" />

                        <p v-if="error" class="ah-field__error" role="alert" data-test="cx-detail-error">{{ error }}</p>
                    </div>

                    <footer class="cx-drawer__foot">
                        <template v-if="confirming">
                            <span class="ah-small cx-drawer__confirm">{{ $t('Connectors.conn.confirm_disconnect', { provider: name }) }}</span>
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy === 'disconnect'" data-test="cx-detail-disconnect-confirm" @click="disconnect">
                                {{ busy === 'disconnect' ? $t('Connectors.conn.disconnecting') : $t('Connectors.conn.disconnect') }}
                            </button>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy === 'disconnect'" @click="confirming = false">{{ $t('Connectors.conn.cancel') }}</button>
                        </template>
                        <button v-else type="button" class="ah-btn ah-btn--ghost ah-btn--sm cx-drawer__danger" data-test="cx-detail-disconnect" @click="confirming = true">{{ $t('Connectors.conn.disconnect') }}</button>
                    </footer>
                </aside>
            </Transition>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onMounted, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import { useFocusTrap } from "@/composable/useFocusTrap";
import ConnectorTile from "./ConnectorTile.vue";
import ConnectorToolReviews from "./ConnectorToolReviews.vue";
import { connectorApi, goToConsent } from "./connectorApi";
import { formatDate, productLabel, statusLabel } from "./connectorLabels";
import { needsAttention, statusDot, toolsOffAfter } from "./connectorCatalog";

defineOptions({ name: "ConnectorDetail" });

const props = defineProps({
    row: { type: Object, required: true },
    name: { type: String, required: true },
    privileged: { type: Boolean, default: false }
});
const emit = defineEmits(["close", "changed", "disconnected", "reconnect"]);

const { t, te } = useI18n();
const titleId = `cx-detail-${useId()}`;

const box = ref(null);
const closer = ref(null);
const busy = ref("");
const error = ref("");
const confirming = ref(false);
const tools = ref([]);
const toolsLoading = ref(false);
const toolsError = ref("");
const toolStatus = ref("");

const connection = computed(() => props.row.connection || {});
const attention = computed(() => needsAttention(props.row));
const statusText = computed(() => (attention.value ? statusLabel(t, te, connection.value.status) : t("Connectors.conn.status_connected")));
const toolsOff = ref([...(connection.value.toolsOff || [])]);
const editsProducts = computed(() => props.row.products.length > 1 && connection.value.signIn !== "personal_token" && (props.row.signIn || []).includes("oauth"));
const picked = ref([...(connection.value.products || [])]);
const productsChanged = computed(() => {
    const held = connection.value.products || [];
    return picked.value.length !== held.length || picked.value.some((product) => !held.includes(product));
});

useFocusTrap(box, ref(true));

const date = (value) => formatDate(value);
const productName = (product) => productLabel(t, te, product);
const toolName = (tool) => (te(tool.label) ? t(tool.label) : tool.key);
const close = () => emit("close");

const loadTools = async () => {
    toolsLoading.value = true;
    toolsError.value = "";
    try {
        const out = await connectorApi.tools(props.row.provider);
        tools.value = out?.tools || [];
    } catch (e) {
        toolsError.value = e.message || t("Connectors.detail.tools_failed");
    } finally {
        toolsLoading.value = false;
    }
};

const setTool = async (tool, on) => {
    const next = toolsOffAfter(toolsOff.value, tool.key, on);
    busy.value = tool.key;
    error.value = "";
    toolStatus.value = "";
    try {
        const view = await connectorApi.setToolsOff(connection.value.connectionId, next);
        toolsOff.value = [...((view && view.toolsOff) || next)];
        toolStatus.value = t(on ? "Connectors.detail.tool_on" : "Connectors.detail.tool_off", { tool: toolName(tool) });
        emit("changed", view);
    } catch (e) {
        error.value = e.message || t("Connectors.detail.tool_failed");
    } finally {
        busy.value = "";
    }
};

const toggleProduct = (product) => {
    picked.value = picked.value.includes(product) ? picked.value.filter((value) => value !== product) : [...picked.value, product];
};

const saveProducts = async () => {
    busy.value = "products";
    error.value = "";
    try {
        const out = await connectorApi.setProducts(connection.value.connectionId, picked.value);
        if (!out?.url) throw new Error("");
        goToConsent(out.url);
    } catch (e) {
        error.value = e.message || t("Connectors.conn.connect_failed");
        busy.value = "";
    }
};

const disconnect = async () => {
    busy.value = "disconnect";
    error.value = "";
    try {
        await connectorApi.disconnect(connection.value.connectionId);
        emit("disconnected", props.row.provider);
    } catch (e) {
        error.value = e.message || t("Connectors.conn.disconnect_failed");
        busy.value = "";
    }
};

onMounted(() => {
    closer.value?.focus();
    loadTools();
});
</script>

<style scoped>
.cx-drawer-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end; background: var(--scrim); }
.cx-drawer { width: 440px; max-width: 100%; height: 100%; display: flex; flex-direction: column; background: var(--surface); border-left: 1px solid var(--hairline); box-shadow: var(--shadow-modal); outline: none; box-sizing: border-box; }
.cx-drawer__head { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border-bottom: 1px solid var(--hairline); }
.cx-drawer__id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cx-drawer__title { overflow-wrap: anywhere; }
.cx-drawer__status { display: inline-flex; align-items: center; gap: 6px; font: var(--text-small); color: var(--ink-2); }
.cx-drawer__body { flex: 1; min-height: 0; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
.cx-drawer__alert { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border-radius: var(--r-card); background: var(--warn-bg); color: var(--warn-ink); }
.cx-drawer__alert-text { flex: 1 1 200px; margin: 0; font: var(--text-small); color: var(--warn-ink); }
.cx-drawer__section { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.cx-drawer__section > * { max-width: 100%; }
.cx-drawer__hint, .cx-drawer__status { margin: 0; }
.cx-drawer__status { min-height: 1em; }
.cx-drawer__products { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.cx-drawer__product { display: inline-flex; align-items: center; gap: 8px; min-height: var(--hit-min); font: var(--text-body); color: var(--ink); cursor: pointer; }
.cx-facts { margin: 0; display: grid; gap: 8px; }
.cx-facts__row { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; align-items: baseline; }
.cx-facts dt { font: var(--text-small); color: var(--ink-2); }
.cx-facts dd { margin: 0; font: var(--text-body); color: var(--ink); overflow-wrap: anywhere; }
.cx-tools { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; }
.cx-tools__row { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--hairline); }
.cx-tools__row:first-child { border-top: 0; }
.cx-tools__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cx-tools__name { font: var(--text-body); color: var(--ink); overflow-wrap: anywhere; }
.cx-tools__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.cx-drawer__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hairline); }
.cx-drawer__confirm { flex: 1 1 100%; color: var(--ink); }
.cx-drawer__danger { color: var(--danger-ink); }
@media (max-width: 480px) {
    .cx-facts__row { grid-template-columns: 1fr; gap: 2px; }
    .cx-drawer__foot .ah-btn { min-height: 40px; }
}
</style>
