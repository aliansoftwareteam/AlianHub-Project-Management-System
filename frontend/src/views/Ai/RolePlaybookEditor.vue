<template>
    <section v-if="shown" class="ah-card" data-test="role-playbooks" aria-labelledby="role-playbooks-title">
        <div class="ah-card__head">
            <span id="role-playbooks-title" class="ah-h3">{{ $t('RolePlaybooks.title') }}</span>
            <span class="ah-mono rpb-note">{{ canEdit ? $t('RolePlaybooks.you_can_edit') : $t('RolePlaybooks.read_only') }}</span>
        </div>
        <div class="ah-card__body">
            <p class="rpb-note">{{ $t('RolePlaybooks.lead') }}</p>
            <p v-if="loadError" class="ah-field__error" role="alert">{{ loadError }}</p>
            <p v-else-if="loaded && !roles.length" class="rpb-note" data-test="role-playbooks-empty">{{ $t('RolePlaybooks.empty') }}</p>
            <div v-else-if="current" class="rpb-form">
                <label class="rpb-field" for="role-playbook-role">
                    <span>{{ $t('RolePlaybooks.role_label') }}</span>
                    <select id="role-playbook-role" v-model="chosen" class="ah-input" data-test="role-playbook-select">
                        <option v-for="role in roles" :key="idOf(role)" :value="idOf(role)">{{ role.name }} ({{ role.department }})</option>
                    </select>
                </label>
                <p>
                    <span class="ah-chip" :class="current.edited ? 'ah-chip--warn' : ''" data-test="role-playbook-state">{{ current.edited ? $t('RolePlaybooks.edited_chip') : $t('RolePlaybooks.default_chip') }}</span>
                </p>
                <label class="rpb-field" for="role-playbook-text">
                    <span>{{ $t('RolePlaybooks.text_label') }}</span>
                    <textarea id="role-playbook-text" v-model="draft" class="ah-input rpb-text" rows="14" :maxlength="maxLength" :readonly="!canEdit" data-test="role-playbook-text"></textarea>
                    <small class="rpb-note">{{ $t('RolePlaybooks.count', { used: draft.length, max: maxLength }) }}</small>
                </label>
                <div v-if="canEdit" class="rpb-actions">
                    <button type="button" class="ah-btn ah-btn--primary" data-test="role-playbook-save" :disabled="busy || !changed || !draft.trim()" @click="save">{{ $t('RolePlaybooks.save') }}</button>
                    <button type="button" class="ah-btn ah-btn--secondary" data-test="role-playbook-restore" :disabled="busy || !current.edited" @click="restore">{{ $t('RolePlaybooks.restore') }}</button>
                    <span v-if="notice" class="rpb-note" role="status" data-test="role-playbook-notice">{{ notice }}</span>
                </div>
                <p v-if="error" class="ah-field__error" role="alert" data-test="role-playbook-error">{{ error }}</p>
            </div>
        </div>
    </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "RolePlaybookEditor" });

const { t } = useI18n();

const roles = ref([]);
const canEdit = ref(false);
const maxLength = ref(30000);
const loaded = ref(false);
const loadError = ref("");
const on = ref(false);
const shown = computed(() => loaded.value && (on.value || Boolean(loadError.value)));
const chosen = ref("");
const draft = ref("");
const busy = ref(false);
const error = ref("");
const notice = ref("");

const idOf = (role) => `${role.blueprint}/${role.slug}`;
const current = computed(() => roles.value.find((role) => idOf(role) === chosen.value) || null);
const changed = computed(() => Boolean(current.value) && draft.value !== current.value.body);
const urlOf = (id) => `${env.AGENT_ROLES}/${id.split("/").map(encodeURIComponent).join("/")}/playbook`;
const reasonOf = (res, fallback) => res?.data?.statusText || res?.data?.message || fallback;

const take = (data) => {
    on.value = data.on !== false;
    roles.value = data.roles || [];
    canEdit.value = Boolean(data.canEdit);
    maxLength.value = data.maxLength || maxLength.value;
    if (!current.value && roles.value.length) chosen.value = idOf(roles.value[0]);
};

watch(chosen, () => { draft.value = current.value ? current.value.body : ""; error.value = ""; notice.value = ""; });

const load = async () => {
    try {
        const res = await apiRequest("get", env.AGENT_ROLES);
        if (res?.data?.status !== true) loadError.value = reasonOf(res, t("RolePlaybooks.load_failed"));
        else take(res.data.data || {});
    } catch (e) {
        loadError.value = e?.response?.data?.statusText || t("RolePlaybooks.load_failed");
    } finally {
        loaded.value = true;
    }
};

const send = async (type, body, done, failed) => {
    busy.value = true;
    error.value = "";
    notice.value = "";
    const id = chosen.value;
    try {
        const res = await apiRequest(type, urlOf(id), body);
        if (res?.data?.status !== true) {
            error.value = reasonOf(res, failed);
            return;
        }
        take(res.data.data || {});
        draft.value = current.value ? current.value.body : "";
        notice.value = done;
    } catch (e) {
        error.value = e?.response?.data?.statusText || failed;
    } finally {
        busy.value = false;
    }
};

const save = () => send("put", { body: draft.value }, t("RolePlaybooks.saved"), t("RolePlaybooks.save_failed"));
const restore = () => send("delete", undefined, t("RolePlaybooks.restored"), t("RolePlaybooks.restore_failed"));

onMounted(load);
</script>

<style scoped>
.rpb-note { font: var(--text-small); color: var(--ink-2); margin: 0 0 var(--sp-3); }
.rpb-form { display: flex; flex-direction: column; gap: var(--sp-3); }
.rpb-field { display: flex; flex-direction: column; gap: var(--sp-2); font: var(--text-body); color: var(--ink); }
.rpb-text { font-family: var(--font-mono); resize: vertical; min-height: 12rem; }
.rpb-actions { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
</style>
