<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!rows.length" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div class="in-actions">
                <div class="ah-tabs">
                    <button v-for="g in shownGroups" :key="g" type="button" class="ah-tab" :class="{ 'is-active': group === g }" @click="group = g">{{ $t(`Instance.group_${g}`) }}</button>
                </div>
                <div class="ah-toolbar__spacer"></div>
                <button v-if="testable" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" data-test="instance-settings-test" @click="test">{{ group === 'ai' ? $t('Instance.test_connection') : $t('Instance.test') }}</button>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" @click="save">{{ busy ? $t('Instance.saving') : $t('Instance.save') }}</button>
            </div>

            <div v-if="restartKeys.length && hosted" class="in-banner in-banner--warn in-restart" data-test="instance-restart-banner">
                <ShellIcon name="info" :size="15" />
                <span>{{ restartState === 'restarting' ? $t('Instance.managed_restarting') : restartState === 'failed' ? $t('Instance.managed_restart_failed') : $t('Instance.managed_restart_needed', { n: restartKeys.length }, restartKeys.length) }}</span>
                <button v-if="restartState !== 'restarting'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="instance-restart-now" @click="restartNow">{{ $t('Instance.managed_restart_now') }}</button>
                <span v-else class="ah-spin"></span>
            </div>
            <div v-else-if="restartKeys.length" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('Instance.restart_needed', { keys: restartKeys.join(', ') }) }}</span></div>
            <div v-if="testResult" class="in-banner" :class="testResult.ok ? 'in-banner--ok' : 'in-banner--danger'" role="status"><ShellIcon :name="testResult.ok ? 'check' : 'alert'" :size="15" /><span>{{ testResult.text }}</span></div>
            <div v-if="testResult && testResult.models.length" class="in-models" data-test="instance-settings-models">
                <span class="ah-label">{{ $t('Instance.test_models', { n: testResult.models.length }, testResult.models.length) }}</span>
                <ul class="in-models__list">
                    <li v-for="model in testResult.models" :key="model"><code class="ah-mono">{{ model }}</code></li>
                </ul>
            </div>
            <p class="ah-small">{{ hosted ? $t('Instance.hosted_settings_lead') : $t('Instance.settings_lead') }} <a :href="guide('configure')" target="_blank" rel="noopener">{{ $t('Instance.guide') }}</a></p>

            <section v-for="section in sections" :key="section.id" class="ah-card in-card" :data-test="`instance-section-${section.id}`">
                <div v-if="sectionText(section, '')" class="in-section__head">
                    <h3 class="in-card__title">{{ sectionText(section, '') }}</h3>
                    <p v-if="sectionText(section, '_note')" class="ah-small in-section__note">
                        {{ sectionText(section, '_note') }}
                        <a v-if="section.href && sectionText(section, '_link')" :href="section.href" target="_blank" rel="noopener">{{ sectionText(section, '_link') }}</a>
                    </p>
                    <div v-if="section.paste" class="in-paste" :data-test="`instance-paste-${section.id}`">
                        <span class="ah-small">{{ sectionText(section, '_paste') }}</span>
                        <code class="ah-mono">{{ origin }}</code>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="copy(origin)">{{ $t('Instance.copy') }}</button>
                    </div>
                </div>

                <InstanceSettingField v-for="row in section.rows" :key="row.key" v-model="draft[row.key]" v-model:clear="clear[row.key]" :row="row" :error="errors[row.key] || ''" :hosted="hosted" />

                <fieldset v-if="section.choice" class="in-choice">
                    <legend class="in-field__label">{{ $t(`Instance.choice_${section.choice}`) }}</legend>
                    <label v-for="option in CHOICES[section.choice].options" :key="option" class="in-choice__option">
                        <input v-model="ui[section.choice]" type="radio" class="ah-check" :value="option" :name="section.choice" :data-test="`instance-choice-${option}`" />
                        <span>
                            <span class="in-choice__name">{{ $t(`Instance.choice_${section.choice}_${option}`) }}</span>
                            <span class="ah-small in-choice__help">{{ $t(`Instance.choice_${section.choice}_${option}_help`) }}</span>
                        </span>
                    </label>
                </fieldset>

                <InstanceSettingField v-for="row in section.choiceRows" :key="row.key" v-model="draft[row.key]" v-model:clear="clear[row.key]" :row="row" :error="errors[row.key] || ''" :hosted="hosted" />

                <details v-if="section.advancedRows.length" class="in-advanced">
                    <summary class="ah-small">{{ sectionText(section, '_advanced') || $t('Instance.advanced') }}</summary>
                    <InstanceSettingField v-for="row in section.advancedRows" :key="row.key" v-model="draft[row.key]" v-model:clear="clear[row.key]" :row="row" :error="errors[row.key] || ''" :hosted="hosted" />
                </details>
            </section>

            <InstanceAgents v-if="group === 'ai'" />
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay } from "@/services";
import { isManagedHosting, publicConfig } from "@/config/publicConfig";
import { restartAndWait } from "./restartInstance";
import { useInstanceApi } from "./useInstanceApi";
import InstanceAgents from "./InstanceAgents.vue";
import InstanceSettingField from "./InstanceSettingField.vue";
import { CHOICES, layout } from "./settingsLayout";

defineOptions({ name: "InstanceSettings" });

const { t, te } = useI18n();
const $toast = useToast();
const route = useRoute();
const cid = inject("$companyId");
const { get, post, put, message, guide, env } = useInstanceApi();

const TESTABLE = ["mail", "storage", "ai"];
const rows = ref([]);
const groups = ref([]);
const group = ref(String(route.query.group || "general"));
const draft = reactive({});
const clear = reactive({});
const errors = reactive({});
const ui = reactive({});
const busy = ref(false);
const error = ref("");
const restartKeys = ref([]);
const testResult = ref(null);
const restartState = ref("idle");
let baseline = {};
let uiBaseline = {};

const hosted = computed(() => isManagedHosting());
/* A hosted owner sees only what they can change: what AlianHub Cloud or the environment sets is left out. */
const shown = (row) => !row.hidden && !(hosted.value && row.locked);
const shownGroups = computed(() => groups.value.filter((g) => rows.value.some((r) => r.group === g && shown(r))));
const visible = computed(() => rows.value.filter((r) => r.group === group.value && shown(r)));
const sections = computed(() => layout(group.value, visible.value, draft, ui));
const testable = computed(() => TESTABLE.includes(group.value));
const origin = computed(() => (publicConfig.webUrl || window.location.origin).replace(/\/+$/, ""));
const dirty = computed(() => Object.keys(draft).some((k) => draft[k] !== baseline[k])
    || Object.values(clear).some(Boolean)
    || Object.keys(ui).some((k) => ui[k] !== uiBaseline[k]));

const sectionText = (section, suffix) => {
    const base = `Instance.sec_${group.value}_${section.id}${suffix}`;
    if (section.variant && te(`${base}_${section.variant}`)) return t(`${base}_${section.variant}`);
    return te(base) ? t(base) : "";
};

function seed(list) {
    rows.value = list;
    Object.keys(draft).forEach((k) => delete draft[k]);
    Object.keys(clear).forEach((k) => delete clear[k]);
    Object.keys(errors).forEach((k) => delete errors[k]);
    for (const row of list) draft[row.key] = row.secret ? "" : (row.value ?? "");
    for (const [name, choice] of Object.entries(CHOICES)) ui[name] = choice.initial(list);
    baseline = { ...draft };
    uiBaseline = { ...ui };
}

async function load() {
    error.value = "";
    try {
        const data = await get(env.INSTANCE_SETTINGS);
        groups.value = data.groups;
        seed(data.settings);
        if (!shownGroups.value.includes(group.value)) group.value = shownGroups.value[0] || group.value;
    } catch (e) {
        error.value = message(e);
    }
}

/* Only what changed travels: a secret left blank stays as it is on the server. The fields of a
 * choice the owner moved away from are cleared, so the server never falls back to them. */
function patch() {
    const body = {};
    const dropped = new Set(Object.entries(CHOICES).flatMap(([name, choice]) =>
        Object.entries(choice.keys).filter(([option]) => option !== ui[name]).flatMap(([, keys]) => keys)));
    for (const row of rows.value) {
        if (row.locked) continue;
        if (dropped.has(row.key)) {
            if (row.secret ? row.value?.set : row.value) body[row.key] = "";
        } else if (row.secret) {
            if (clear[row.key]) body[row.key] = "";
            else if (draft[row.key]) body[row.key] = draft[row.key];
        } else if (draft[row.key] !== baseline[row.key]) body[row.key] = draft[row.key];
    }
    return body;
}

async function save() {
    busy.value = true;
    testResult.value = null;
    Object.keys(errors).forEach((k) => delete errors[k]);
    try {
        const data = await put(env.INSTANCE_SETTINGS, patch());
        restartKeys.value = data.restartRequired || [];
        seed(data.settings);
        $toast.success(t("Instance.saved"));
    } catch (e) {
        const fieldErrors = e?.response?.data?.data?.errors;
        if (fieldErrors) Object.assign(errors, fieldErrors);
        if (!fieldErrors || Object.keys(fieldErrors).some((key) => !rows.value.some((row) => row.key === key))) $toast.error(message(e));
    } finally {
        busy.value = false;
    }
}

async function test() {
    busy.value = true;
    testResult.value = null;
    try {
        const values = {};
        for (const row of visible.value) if (!row.locked && !row.secret) values[row.key] = draft[row.key]; else if (row.secret && draft[row.key]) values[row.key] = draft[row.key];
        const res = await apiRequestWithoutCompnay("post", env.INSTANCE_SETTINGS_TEST, { group: group.value, values }).catch((e) => ({ data: { status: false, statusText: message(e) } }));
        const models = Array.isArray(res?.data?.data?.models) ? res.data.data.models : [];
        const text = res?.data?.data?.code === "smtp_port_blocked" ? t("Instance.managed_smtp_blocked") : res?.data?.statusText || t("Instance.test_ok");
        testResult.value = { ok: res?.data?.status === true, text, models };
    } finally {
        busy.value = false;
    }
}

async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        $toast.success(t("Instance.copied"));
    } catch {
        $toast.error(t("Instance.copy_failed"));
    }
}

async function restartNow() {
    restartState.value = "restarting";
    try {
        await restartAndWait({ post, companyId: cid?.value || "" });
        window.location.reload();
    } catch (e) {
        restartState.value = "failed";
        if (e?.response) $toast.error(message(e));
    }
}

watch(group, () => { testResult.value = null; });
onMounted(load);
</script>

<style scoped>
.in-models { margin: 0 0 12px; }
.in-models__list { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; padding: 0; list-style: none; }
.in-models__list code { overflow-wrap: anywhere; }
.in-restart { align-items: center; }
.in-restart > span:not(.ah-spin) { flex: 1; }
.in-section__head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 4px; }
.in-section__head .in-card__title { margin: 0; font-size: 14px; }
.in-section__note { margin: 0; max-width: 760px; color: var(--ink-2); }
.in-paste { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.in-paste code { padding: 2px 6px; border-radius: 6px; background: var(--hairline); color: var(--ink); overflow-wrap: anywhere; }
.in-choice { border: 0; margin: 0; padding: 10px 0; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--hairline); }
.in-choice legend { padding: 0; margin-bottom: 8px; }
.in-choice__option { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; max-width: 760px; }
.in-choice__option > span { display: flex; flex-direction: column; gap: 2px; }
.in-choice__name { font: 600 12.5px/1.3 var(--font-ui); color: var(--ink); }
.in-choice__help { color: var(--ink-2); }
.in-advanced { padding-top: 8px; }
.in-advanced summary { cursor: pointer; color: var(--ink-2); padding: 4px 0; }
</style>
