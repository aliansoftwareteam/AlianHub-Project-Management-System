<template>
    <section v-if="shown" class="ah-card csv" data-test="custom-servers" aria-labelledby="custom-servers-title">
        <div class="csv__top">
            <div id="custom-servers-title" class="csv__title">{{ $t('Connectors.custom.title') }}</div>
            <button v-if="mayAdd && ownAdd" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="csv-add" @click="adding = true">{{ $t('Connectors.custom.add') }}</button>
        </div>
        <p class="ah-small csv__lead">{{ $t('Connectors.custom.lead') }}</p>

        <p v-if="loadError" class="ah-field__error" role="alert" data-test="csv-load-error">{{ loadError }}</p>
        <p v-else-if="!servers.length && !loading" class="ah-small" data-test="csv-empty">{{ $t('Connectors.custom.empty') }}</p>

        <article v-for="s in servers" :key="s.serverId" class="csv__row" :data-test="`csv-row-${s.serverId}`">
            <div class="csv__head">
                <strong class="csv__name">{{ s.name }}</strong>
                <span v-if="s.status === 'needs_app'" class="ah-chip ah-chip--warn ah-chip--sm">{{ $t('Connectors.custom.status_needs_app') }}</span>
                <span class="ah-dot" :class="dotClass(s)"></span>
                <span class="ah-small csv__state">{{ connectionText(s) }}</span>
            </div>
            <p class="ah-small csv__meta"><span class="ah-mono">{{ s.url }}</span> · {{ $t(`Connectors.custom.sign_in_${s.signIn}`) }}</p>

            <form v-if="s.status === 'active' && s.signIn === 'personal_token' && !s.connection.connected" class="csv__form" novalidate @submit.prevent="saveToken(s)">
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.token') }}</span>
                    <input v-model="tokens[s.serverId]" class="ah-input" type="password" autocomplete="off" :disabled="busy === s.serverId" :data-test="`csv-token-${s.serverId}`" />
                    <span class="ah-field__hint">{{ $t('Connectors.custom.token_hint') }}</span>
                </label>
                <div class="csv__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === s.serverId || !tokens[s.serverId]">{{ $t('Connectors.custom.save_token') }}</button>
                </div>
            </form>

            <form v-if="s.mayManage && s.status === 'needs_app'" class="csv__form" novalidate @submit.prevent="saveApp(s)">
                <div class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.callback') }}</span>
                    <code class="csv__code ah-mono">{{ s.callback }}</code>
                </div>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.client_id') }}</span>
                    <input v-model="apps[s.serverId].clientId" class="ah-input" type="text" autocomplete="off" :disabled="busy === s.serverId" />
                </label>
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.client_secret') }}</span>
                    <input v-model="apps[s.serverId].clientSecret" class="ah-input" type="password" autocomplete="off" :disabled="busy === s.serverId" />
                    <span class="ah-field__hint">{{ $t('Connectors.custom.client_secret_hint') }}</span>
                </label>
                <div class="csv__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === s.serverId">{{ $t('Connectors.custom.save_app') }}</button>
                </div>
            </form>

            <form v-if="renaming === s.serverId" class="csv__form csv__rename" novalidate @submit.prevent="rename(s)">
                <label class="ah-field">
                    <span class="ah-field__label">{{ $t('Connectors.custom.name') }}</span>
                    <input v-model="newName" class="ah-input" type="text" maxlength="80" :disabled="busy === s.serverId" />
                </label>
                <div class="csv__actions">
                    <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === s.serverId">{{ $t('Connectors.custom.save_name') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="renaming = ''">{{ $t('Connectors.custom.cancel') }}</button>
                </div>
            </form>

            <p v-if="errors[s.serverId]" class="ah-field__error" role="alert">{{ errors[s.serverId] }}</p>

            <div class="csv__actions">
                <button v-if="s.status === 'active' && s.signIn !== 'personal_token' && !isConnected(s)" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy === s.serverId" :data-test="`csv-connect-${s.serverId}`" @click="connect(s)">
                    {{ busy === s.serverId ? $t('Connectors.custom.connecting') : $t('Connectors.custom.connect') }}
                </button>
                <button v-if="s.connection.connected" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy === s.serverId" @click="disconnect(s)">{{ $t('Connectors.custom.disconnect') }}</button>
                <template v-if="s.mayManage">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :aria-expanded="open === s.serverId ? 'true' : 'false'" :data-test="`csv-tools-${s.serverId}`" @click="open = open === s.serverId ? '' : s.serverId">
                        {{ open === s.serverId ? $t('Connectors.custom.hide_tools') : $t('Connectors.custom.tools') }}
                    </button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="startRename(s)">{{ $t('Connectors.custom.rename') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm csv__danger" :disabled="busy === s.serverId" :data-test="`csv-remove-${s.serverId}`" @click="remove(s)">{{ $t('Connectors.custom.remove') }}</button>
                </template>
            </div>

            <CustomServerTools v-if="open === s.serverId" :server="s" />
        </article>

        <AddCustomConnector v-if="adding" @close="adding = false" @added="load" />
    </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import AddCustomConnector from "./AddCustomConnector.vue";
import CustomServerTools from "./CustomServerTools.vue";

defineOptions({ name: "CustomServers" });

/* On the Connectors tab the page header holds the Add button, so the card hides its own and, with nothing to show, itself. */
const props = defineProps({ ownAdd: { type: Boolean, default: true } });
const emit = defineEmits(["ready"]);

const { t } = useI18n();
const route = useRoute();

const SERVERS = `${env.CONNECTORS}/servers`;

const available = ref(true);
const servers = ref([]);
const mayAdd = ref(false);
const loading = ref(true);
const loadError = ref("");
const busy = ref("");
const open = ref("");
const adding = ref(false);
const renaming = ref("");
const newName = ref("");
const tokens = reactive({});
const apps = reactive({});
const errors = reactive({});

const shown = computed(() => available.value && (props.ownAdd || mayAdd.value || servers.value.length > 0 || Boolean(loadError.value)));

const isConnected = (s) => Boolean(s.connection && s.connection.connected);
const dotClass = (s) => (isConnected(s) && s.connection.status === "connected" ? "ah-dot--ok" : isConnected(s) ? "ah-dot--warn" : "ah-dot--off");
const connectionText = (s) => {
    if (!isConnected(s)) return t("Connectors.custom.not_connected");
    return s.connection.status === "connected" ? t("Connectors.custom.connected") : t("Connectors.custom.needs_attention");
};
const refusalOf = (e, key) => e?.response?.data?.statusText || t(key);

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        const res = await apiRequest("get", SERVERS);
        if (!res?.data?.status) { loadError.value = res?.data?.statusText || t("Connectors.custom.load_failed"); return; }
        servers.value = res.data.data.servers || [];
        mayAdd.value = res.data.data.mayAdd === true;
        emit("ready", { mayAdd: mayAdd.value });
        servers.value.forEach((s) => {
            if (!apps[s.serverId]) apps[s.serverId] = { clientId: "", clientSecret: "" };
            if (!(s.serverId in errors)) errors[s.serverId] = "";
        });
    } catch (e) {
        if (e?.response?.status === 404) { available.value = false; return; }
        loadError.value = refusalOf(e, "Connectors.custom.load_failed");
    } finally {
        loading.value = false;
    }
};

const act = async (s, run, failKey) => {
    busy.value = s.serverId;
    errors[s.serverId] = "";
    try {
        const res = await run();
        if (!res?.data?.status) { errors[s.serverId] = res?.data?.statusText || t(failKey); return false; }
        return res;
    } catch (e) {
        errors[s.serverId] = refusalOf(e, failKey);
        return false;
    } finally {
        busy.value = "";
    }
};

const connect = async (s) => {
    const res = await act(s, () => apiRequest("post", `${env.CONNECTORS}/${s.provider}/connect`, { products: [] }), "Connectors.custom.connect_failed");
    if (res && res.data.data?.url) window.location.assign(res.data.data.url);
};

const saveToken = async (s) => {
    const res = await act(s, () => apiRequest("post", `${env.CONNECTORS}/${s.provider}/token`, { token: tokens[s.serverId] }), "Connectors.custom.connect_failed");
    tokens[s.serverId] = "";
    if (res) await load();
};

const disconnect = async (s) => {
    // eslint-disable-next-line no-alert
    if (!s.connection.connectionId || !window.confirm(t("Connectors.custom.confirm_disconnect", { name: s.name }))) return;
    if (await act(s, () => apiRequest("delete", `${env.CONNECTORS}/connections/${s.connection.connectionId}`), "Connectors.custom.connect_failed")) await load();
};

const saveApp = async (s) => {
    const res = await act(s, () => apiRequest("put", `${SERVERS}/${s.serverId}`, { ...apps[s.serverId] }), "Connectors.custom.app_failed");
    apps[s.serverId].clientSecret = "";
    if (res) await load();
};

const startRename = (s) => {
    renaming.value = s.serverId;
    newName.value = s.name;
};

const rename = async (s) => {
    if (await act(s, () => apiRequest("put", `${SERVERS}/${s.serverId}`, { name: newName.value }), "Connectors.custom.app_failed")) {
        renaming.value = "";
        await load();
    }
};

const remove = async (s) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t("Connectors.custom.confirm_remove", { name: s.name }))) return;
    if (await act(s, () => apiRequest("delete", `${SERVERS}/${s.serverId}`), "Connectors.custom.remove_failed")) {
        if (open.value === s.serverId) open.value = "";
        await load();
    }
};

// A provider's sign-in returns to this page, where the Connectors tab completes it and clears the return.
watch(() => route.query.connector, (now, before) => { if (before && !now) load(); });

const startAdd = () => { adding.value = true; };

defineExpose({ startAdd });

onMounted(load);
</script>

<style scoped>
.csv { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin-bottom: 14px; background: var(--surface); }
.csv__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.csv__title { font: 600 13px/1.2 var(--font-ui); color: var(--ink); }
.csv__lead { margin: 0; color: var(--ink-2); }
.csv__row { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-top: 1px solid var(--hairline); }
.csv__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.csv__name { font: 600 13px/1.2 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.csv__state { color: var(--ink-2); }
.csv__meta { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }
.csv__form { display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
.csv__code { overflow-wrap: anywhere; padding: 6px 8px; border-radius: var(--r-input); background: var(--fill); color: var(--ink); }
.csv__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.csv__danger { color: var(--danger-ink); }
.ah-dot--off { background: var(--ink-3); }
</style>
