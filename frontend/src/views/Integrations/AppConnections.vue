<template>
    <div class="ah-page apc">
        <div class="ah-toolbar">
            <div class="ah-toolbar__title">{{ $t('AppConnections.title') }}</div>
        </div>

        <div class="apc__body ah-scroll">
            <p class="ah-small">{{ $t('AppConnections.lead') }}</p>
            <p v-if="error" class="ah-field__error" role="alert">{{ error }}</p>
            <p v-if="loaded && !enabled" class="ah-card apc__off">{{ $t('AppConnections.off') }}</p>

            <div v-if="enabled" class="apc__list">
                <article v-for="app in apps" :key="app.key" class="ah-card apc__card" :data-app="app.key">
                    <header class="apc__top">
                        <span class="apc__icon" aria-hidden="true">{{ app.icon }}</span>
                        <div class="apc__id">
                            <strong class="apc__name">{{ app.name }}</strong>
                            <span class="ah-small">{{ app.description }}</span>
                        </div>
                        <button v-if="!app.connections.length || app.multiple" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openConnect(app)">
                            {{ $t('AppConnections.connect') }}
                        </button>
                    </header>

                    <form v-if="connecting === app.key" class="apc__form" @submit.prevent="connect(app)">
                        <label v-for="field in app.fields" :key="field.key" class="ah-field">
                            <span class="ah-label">{{ field.label }}</span>
                            <input v-model="values[field.key]" class="ah-input" :type="field.secret ? 'password' : 'text'" :required="field.required" autocomplete="off" />
                        </label>
                        <div class="apc__actions">
                            <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy">{{ $t('AppConnections.save') }}</button>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="connecting = ''">{{ $t('AppConnections.cancel') }}</button>
                        </div>
                    </form>

                    <section v-for="conn in app.connections" :key="conn.id" class="apc__conn">
                        <div class="apc__row">
                            <span class="ah-chip" :class="chipOf(conn)">{{ $t(`AppConnections.state_${stateOf(conn)}`) }}</span>
                            <span v-if="conn.target" class="ah-chip ah-chip--mono">{{ conn.target }}</span>
                            <span class="apc__spacer"></span>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="toggle(conn)">
                                {{ conn.enabled ? $t('AppConnections.pause') : $t('AppConnections.resume') }}
                            </button>
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" @click="disconnect(conn)">
                                {{ confirming === conn.id ? $t('AppConnections.confirm_disconnect') : $t('AppConnections.disconnect') }}
                            </button>
                        </div>

                        <dl v-if="app.syncs" class="apc__facts">
                            <div>
                                <dt class="ah-label">{{ $t('AppConnections.last_sync') }}</dt>
                                <dd>{{ conn.lastSyncAt ? when(conn.lastSyncAt) : $t('AppConnections.never') }}</dd>
                            </div>
                            <div>
                                <dt class="ah-label">{{ $t('AppConnections.last_error') }}</dt>
                                <dd :class="{ 'apc__error': conn.lastError }">{{ conn.lastError || $t('AppConnections.none') }}</dd>
                            </div>
                            <div v-if="conn.nextAttemptAt">
                                <dt class="ah-label">{{ $t('AppConnections.retry_at') }}</dt>
                                <dd>{{ when(conn.nextAttemptAt) }}</dd>
                            </div>
                        </dl>

                        <div v-if="app.syncs" class="apc__projects">
                            <span class="ah-label">{{ $t('AppConnections.projects') }}</span>
                            <div class="apc__chips">
                                <span v-for="p in conn.projects" :key="p.id" class="ah-chip ah-chip--brand">{{ p.name || p.id }}</span>
                                <span v-if="!conn.projects.length" class="ah-small">{{ $t('AppConnections.no_projects') }}</span>
                            </div>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="editProjects(conn)">{{ $t('AppConnections.link_projects') }}</button>
                            <div v-if="editing === conn.id" class="apc__picker">
                                <label v-for="p in projects" :key="p.id" class="apc__pick">
                                    <input v-model="picked" type="checkbox" :value="p.id" />
                                    <span>{{ p.name }}</span>
                                </label>
                                <div class="apc__actions">
                                    <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="saveProjects(conn)">{{ $t('AppConnections.save') }}</button>
                                    <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="editing = ''">{{ $t('AppConnections.cancel') }}</button>
                                </div>
                            </div>
                        </div>
                    </section>
                </article>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "AppConnections" });

const { t } = useI18n();

const loaded = ref(false);
const enabled = ref(false);
const apps = ref([]);
const projects = ref([]);
const error = ref("");
const busy = ref(false);
const connecting = ref("");
const values = ref({});
const editing = ref("");
const picked = ref([]);
const confirming = ref("");

const when = (value) => new Date(value).toLocaleString();
const stateOf = (conn) => {
    if (!conn.enabled) return "paused";
    return conn.lastError ? "error" : "connected";
};
const chipOf = (conn) => ({ "ah-chip--ok": stateOf(conn) === "connected", "ah-chip--warn": stateOf(conn) === "paused", "ah-chip--danger": stateOf(conn) === "error" });

const failure = (e) => e?.response?.data?.statusText || e?.message || t("AppConnections.failed");

const load = async () => {
    try {
        const res = await apiRequest("get", `${env.INTEGRATIONS}/app-connections`);
        const data = res?.data?.status ? res.data.data : null;
        enabled.value = !!data?.enabled;
        apps.value = data?.apps || [];
        projects.value = data?.projects || [];
        error.value = data ? "" : res?.data?.statusText || t("AppConnections.failed");
    } catch (e) {
        error.value = failure(e);
    } finally {
        loaded.value = true;
    }
};

const act = async (run) => {
    busy.value = true;
    error.value = "";
    try {
        const res = await run();
        if (res?.data && res.data.status === false) error.value = res.data.statusText || t("AppConnections.failed");
        else await load();
    } catch (e) {
        error.value = failure(e);
    } finally {
        busy.value = false;
    }
};

const openConnect = (app) => {
    values.value = {};
    connecting.value = app.key;
};

const connect = async (app) => {
    await act(() => apiRequest("post", `${env.INTEGRATIONS}/connections`, { type: app.key, config: { ...values.value } }));
    if (!error.value) { connecting.value = ""; values.value = {}; }
};

const toggle = (conn) => act(() => apiRequest("put", `${env.INTEGRATIONS}/connections/${conn.id}`, { enabled: !conn.enabled }));

const disconnect = async (conn) => {
    if (confirming.value !== conn.id) { confirming.value = conn.id; return; }
    confirming.value = "";
    await act(() => apiRequest("delete", `${env.INTEGRATIONS}/connections/${conn.id}`));
};

const editProjects = (conn) => {
    editing.value = editing.value === conn.id ? "" : conn.id;
    picked.value = conn.projects.map((p) => p.id);
};

const saveProjects = async (conn) => {
    await act(() => apiRequest("put", `${env.INTEGRATIONS}/connections/${conn.id}/projects`, { projectIds: picked.value }));
    if (!error.value) editing.value = "";
};

onMounted(load);
</script>

<style>
@import "./appConnections.css";
</style>
