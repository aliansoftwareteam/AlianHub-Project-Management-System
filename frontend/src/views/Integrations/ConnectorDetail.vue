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
                            <p v-if="appOff" class="cx-drawer__off" data-test="cx-detail-app-off">{{ $t('Connectors.detail.app_off', { provider: name }) }}</p>
                            <p v-else-if="toolsError" class="ah-field__error" role="alert">{{ toolsError }}</p>
                            <p v-else-if="toolsLoading" class="ah-small">{{ $t('Connectors.detail.tools_loading') }}</p>
                            <p v-else-if="listProblem" class="ah-small" data-test="cx-detail-tools-problem">{{ listProblem }}</p>
                            <p v-else-if="!tools.length" class="ah-small">{{ $t('Connectors.detail.tools_none') }}</p>
                            <template v-else>
                                <div v-for="group in shownGroups" :key="group.id" class="cx-tools-group" :data-test="`cx-tools-${group.id}`">
                                    <h4 class="cx-tools-group__title">{{ $t(`Connectors.detail.group_${group.id}`) }}</h4>
                                    <ul class="cx-tools" role="list">
                                        <li v-for="tool in group.tools" :key="tool.key" class="cx-tools__row" :data-test="`cx-tool-${tool.key}`">
                                            <span class="cx-tools__text">
                                                <span class="cx-tools__name">{{ toolName(tool) }}</span>
                                                <span v-if="tool.outside && tool.outside.description" class="cx-tools__about">{{ tool.outside.description }}</span>
                                                <span v-if="tool.on === false" class="ah-chip ah-chip--sm cx-tools__chip" :data-test="`cx-tool-unavailable-${tool.key}`">{{ $t('Connectors.detail.unavailable') }}</span>
                                                <span v-if="tool.changed && !tool.gone" class="cx-tools__changed" :data-test="`cx-tool-changed-${tool.key}`">
                                                    <span class="cx-tools__changed-text">{{ $t('Connectors.detail.changed') }}</span>
                                                    <button
                                                        type="button"
                                                        class="ah-btn ah-btn--ghost ah-btn--sm"
                                                        :disabled="busy === tool.key"
                                                        :aria-label="$t('Connectors.detail.looked_at_named', { tool: toolName(tool) })"
                                                        :data-test="`cx-tool-looked-${tool.key}`"
                                                        @click="lookedAt(tool)"
                                                    >{{ $t('Connectors.detail.looked_at') }}</button>
                                                </span>
                                            </span>
                                            <span v-if="!tool.gone" class="cx-tools__controls">
                                                <select
                                                    v-if="tool.live"
                                                    class="ah-input cx-tools__select"
                                                    :value="tool.access"
                                                    :disabled="busy === tool.key"
                                                    :aria-label="$t('Connectors.detail.access_label', { tool: toolName(tool) })"
                                                    :data-test="`cx-tool-access-${tool.key}`"
                                                    @change="setAccess(tool, $event.target.value)"
                                                >
                                                    <option value="read">{{ $t('Connectors.detail.kind_read') }}</option>
                                                    <option value="write">{{ $t('Connectors.detail.kind_write') }}</option>
                                                </select>
                                                <select
                                                    class="ah-input cx-tools__select"
                                                    :value="tool.permission"
                                                    :disabled="busy === tool.key"
                                                    :aria-label="$t('Connectors.detail.permission_label', { tool: toolName(tool) })"
                                                    :data-test="`cx-tool-permission-${tool.key}`"
                                                    @change="setPermission(tool, $event.target.value)"
                                                >
                                                    <option v-for="permission in PERMISSIONS" :key="permission" :value="permission">{{ $t(`Connectors.detail.permission_${permission}`) }}</option>
                                                </select>
                                            </span>
                                        </li>
                                    </ul>
                                </div>
                            </template>
                            <p class="ah-small cx-drawer__status" role="status">{{ toolStatus }}</p>
                        </section>

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
import { useFocusTrap } from "@/composable/useFocusTrap";
import ConnectorTile from "./ConnectorTile.vue";
import { connectorApi, goToConsent } from "./connectorApi";
import { formatDate, productLabel, statusLabel } from "./connectorLabels";
import { PERMISSIONS, groupTools, needsAttention, statusDot } from "./connectorCatalog";

defineOptions({ name: "ConnectorDetail" });

const props = defineProps({
    row: { type: Object, required: true },
    name: { type: String, required: true },
    privileged: { type: Boolean, default: false }
});
const emit = defineEmits(["close", "disconnected", "reconnect"]);

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
const listStatus = ref("");
const LIST_PROBLEMS = Object.freeze(["unreachable", "broken", "not_connected", "provider_off"]);

const connection = computed(() => props.row.connection || {});
const attention = computed(() => needsAttention(props.row));
const statusText = computed(() => (attention.value ? statusLabel(t, te, connection.value.status) : t("Connectors.conn.status_connected")));
const appOff = computed(() => Boolean(props.row.switchedOff) || listStatus.value === "app_off");
const listProblem = computed(() => (LIST_PROBLEMS.includes(listStatus.value) ? t(`Connectors.detail.list_${listStatus.value}`, { provider: props.name }) : ""));
const shownGroups = computed(() => {
    const groups = groupTools(tools.value);
    return ["read", "write", "gone"].map((id) => ({ id, tools: groups[id] })).filter((group) => group.tools.length);
});
const editsProducts = computed(() => props.row.products.length > 1 && connection.value.signIn !== "personal_token" && (props.row.signIn || []).includes("oauth"));
const picked = ref([...(connection.value.products || [])]);
const productsChanged = computed(() => {
    const held = connection.value.products || [];
    return picked.value.length !== held.length || picked.value.some((product) => !held.includes(product));
});

useFocusTrap(box, ref(true));

const date = (value) => formatDate(value);
const productName = (product) => productLabel(t, te, product);
const toolName = (tool) => (tool.label && te(tool.label) ? t(tool.label) : tool.tool || tool.key);
const close = () => emit("close");

const loadTools = async () => {
    if (!connection.value.connectionId) return;
    toolsLoading.value = true;
    toolsError.value = "";
    try {
        const out = await connectorApi.connectionTools(connection.value.connectionId);
        tools.value = out?.tools || [];
        listStatus.value = out?.status || "";
    } catch (e) {
        toolsError.value = e.message || t("Connectors.detail.tools_failed");
    } finally {
        toolsLoading.value = false;
    }
};

const changeTool = async (tool, change, savedKey) => {
    busy.value = tool.key;
    error.value = "";
    toolStatus.value = "";
    try {
        const view = await connectorApi.setTool(connection.value.connectionId, tool.key, change);
        tools.value = tools.value.map((held) => (held.key === tool.key ? { ...held, ...view } : held));
        toolStatus.value = t(savedKey, { tool: toolName(tool) });
    } catch (e) {
        error.value = e.message || t("Connectors.detail.tool_failed");
    } finally {
        busy.value = "";
    }
};

const setPermission = (tool, permission) => changeTool(tool, { permission }, "Connectors.detail.permission_saved");
const setAccess = (tool, access) => changeTool(tool, { access }, "Connectors.detail.access_saved");
const lookedAt = (tool) => changeTool(tool, { lookedAt: true }, "Connectors.detail.looked_at_saved");

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
.cx-drawer__off { margin: 0; padding: 10px 12px; border-radius: var(--r-card); background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.cx-tools-group { width: 100%; display: flex; flex-direction: column; gap: 4px; }
.cx-tools-group__title { margin: 6px 0 0; font: var(--text-small); color: var(--ink-2); }
.cx-tools { list-style: none; margin: 0; padding: 0; width: 100%; display: flex; flex-direction: column; }
.cx-tools__row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; padding: 9px 0; border-top: 1px solid var(--hairline); }
.cx-tools__row:first-child { border-top: 0; }
.cx-tools__text { flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cx-tools__name { font: var(--text-body); color: var(--ink); overflow-wrap: anywhere; }
.cx-tools__about { font: var(--text-small); color: var(--ink-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cx-tools__chip { align-self: flex-start; }
.cx-tools__changed { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 8px; border-radius: var(--r-input); background: var(--warn-bg); }
.cx-tools__changed-text { font: var(--text-small); color: var(--warn-ink); }
.cx-tools__controls { display: flex; flex-wrap: wrap; gap: 6px; }
.cx-tools__select { width: auto; min-width: 0; }
.cx-drawer__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--hairline); }
.cx-drawer__confirm { flex: 1 1 100%; color: var(--ink); }
.cx-drawer__danger { color: var(--danger-ink); }
@media (max-width: 480px) {
    .cx-facts__row { grid-template-columns: 1fr; gap: 2px; }
    .cx-drawer__foot .ah-btn { min-height: 40px; }
}
</style>
