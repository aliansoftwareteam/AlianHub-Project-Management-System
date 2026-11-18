<template>
    <teleport to="body">
        <div class="acc__overlay" data-test="add-custom-connector" @click.self="close">
            <form class="acc__card" role="dialog" aria-modal="true" aria-labelledby="acc-title" novalidate @submit.prevent="submit" @keydown.esc="close">
                <h3 id="acc-title" class="ah-h3 acc__title">{{ $t('Connectors.custom.add_title') }}</h3>

                <template v-if="step === 'address'">
                    <p class="ah-small acc__lead">{{ $t('Connectors.custom.add_lead') }}</p>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Connectors.custom.name') }}</span>
                        <input ref="first" v-model="name" class="ah-input" type="text" maxlength="80" autocomplete="off" data-test="acc-name" :disabled="busy" @input="problem = ''" />
                        <span class="ah-field__hint">{{ $t('Connectors.custom.name_hint') }}</span>
                    </label>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Connectors.custom.address') }}</span>
                        <input v-model="url" class="ah-input" type="url" inputmode="url" maxlength="500" autocomplete="off" data-test="acc-url" :disabled="busy" @input="problem = ''" />
                        <span class="ah-field__hint">{{ $t('Connectors.custom.address_hint') }}</span>
                    </label>
                </template>

                <template v-else-if="step === 'app'">
                    <p class="ah-small acc__lead" data-test="acc-needs-app">{{ $t('Connectors.custom.added_needs_app', { name: server.name }) }}</p>
                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Connectors.custom.callback') }}</span>
                        <div class="acc__copy">
                            <code class="acc__code ah-mono" data-test="acc-callback">{{ server.callback }}</code>
                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="copy">{{ copied ? $t('Connectors.custom.copied') : $t('Connectors.custom.copy') }}</button>
                        </div>
                    </div>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Connectors.custom.client_id') }}</span>
                        <input ref="clientIdInput" v-model="clientId" class="ah-input" type="text" autocomplete="off" data-test="acc-client-id" :disabled="busy" @input="problem = ''" />
                    </label>
                    <label class="ah-field">
                        <span class="ah-field__label">{{ $t('Connectors.custom.client_secret') }}</span>
                        <input v-model="clientSecret" class="ah-input" type="password" autocomplete="off" data-test="acc-client-secret" :disabled="busy" @input="problem = ''" />
                        <span class="ah-field__hint">{{ $t('Connectors.custom.client_secret_hint') }}</span>
                    </label>
                </template>

                <template v-else>
                    <p class="ah-small acc__lead" role="status" data-test="acc-done">{{ doneText }}</p>
                </template>

                <div v-if="server && server.hosts && server.hosts.length" class="acc__hosts">
                    <span class="ah-field__label">{{ $t('Connectors.custom.hosts') }}</span>
                    <span v-for="host in server.hosts" :key="host" class="ah-chip ah-chip--mono">{{ host }}</span>
                </div>

                <p v-if="problem" class="ah-field__error" role="alert" data-test="acc-error">{{ problem }}</p>

                <div class="acc__actions">
                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="close">
                        {{ step === 'done' ? $t('Connectors.custom.close') : $t('Connectors.custom.cancel') }}
                    </button>
                    <button v-if="step !== 'done'" type="submit" class="ah-btn ah-btn--primary ah-btn--sm" data-test="acc-submit" :disabled="busy">
                        {{ busy ? (step === 'address' ? $t('Connectors.custom.adding') : $t('Connectors.custom.saving')) : (step === 'address' ? $t('Connectors.custom.next') : $t('Connectors.custom.save_app')) }}
                    </button>
                </div>
            </form>
        </div>
    </teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "AddCustomConnector" });

const emit = defineEmits(["close", "added"]);
const { t } = useI18n();

const step = ref("address");
const name = ref("");
const url = ref("");
const clientId = ref("");
const clientSecret = ref("");
const server = ref(null);
const busy = ref(false);
const problem = ref("");
const copied = ref(false);
const first = ref(null);
const clientIdInput = ref(null);

const SERVERS = `${env.CONNECTORS}/servers`;

const doneText = computed(() => {
    if (!server.value) return "";
    const key = server.value.signIn === "personal_token" ? "added_personal_token" : server.value.signIn === "registered_app" ? "app_saved" : "added_self_register";
    return t(`Connectors.custom.${key}`, { name: server.value.name });
});

const refusalOf = (e, fallback) => e?.response?.data?.statusText || fallback;

const addServer = async () => {
    const res = await apiRequest("post", SERVERS, { name: name.value, url: url.value });
    if (!res?.data?.status) { problem.value = res?.data?.statusText || t("Connectors.custom.add_failed"); return; }
    server.value = res.data.data.server;
    emit("added", server.value);
    step.value = server.value.status === "needs_app" ? "app" : "done";
    if (step.value === "app") nextTick(() => clientIdInput.value && clientIdInput.value.focus());
};

const saveApp = async () => {
    const res = await apiRequest("put", `${SERVERS}/${server.value.serverId}`, { clientId: clientId.value, clientSecret: clientSecret.value });
    if (!res?.data?.status) { problem.value = res?.data?.statusText || t("Connectors.custom.app_failed"); return; }
    server.value = res.data.data.server;
    clientSecret.value = "";
    emit("added", server.value);
    step.value = "done";
};

const submit = async () => {
    if (busy.value || step.value === "done") return;
    busy.value = true;
    problem.value = "";
    try {
        if (step.value === "address") await addServer();
        else await saveApp();
    } catch (e) {
        problem.value = refusalOf(e, t(step.value === "address" ? "Connectors.custom.add_failed" : "Connectors.custom.app_failed"));
    } finally {
        busy.value = false;
    }
};

const copy = async () => {
    try {
        await navigator.clipboard.writeText(server.value.callback);
        copied.value = true;
    } catch (e) {
        copied.value = false;
    }
};

const close = () => { if (!busy.value) emit("close"); };

onMounted(() => nextTick(() => first.value && first.value.focus()));
</script>

<style scoped>
.acc__overlay { position: fixed; inset: 0; background: var(--scrim); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.acc__card { background: var(--surface); color: var(--ink); border-radius: var(--r-modal); width: min(480px, 100%); max-height: 100%; overflow-y: auto; padding: 18px 20px 20px; box-shadow: var(--shadow-modal); font-family: var(--font-ui); display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; }
.acc__title { margin: 0; }
.acc__lead { margin: 0; color: var(--ink-2); }
.acc__copy { display: flex; align-items: center; gap: 8px; min-width: 0; }
.acc__code { flex: 1; min-width: 0; overflow-wrap: anywhere; padding: 6px 8px; border-radius: var(--r-input); background: var(--fill); color: var(--ink); }
.acc__hosts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acc__hosts .ah-field__label { width: 100%; }
.acc__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
