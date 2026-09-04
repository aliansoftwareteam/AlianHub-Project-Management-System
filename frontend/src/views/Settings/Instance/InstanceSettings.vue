<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!rows.length" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div class="in-actions">
                <div class="ah-tabs">
                    <button v-for="g in groups" :key="g" type="button" class="ah-tab" :class="{ 'is-active': group === g }" @click="group = g">{{ $t(`Instance.group_${g}`) }}</button>
                </div>
                <div class="ah-toolbar__spacer"></div>
                <button v-if="testable" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="test">{{ $t('Instance.test') }}</button>
                <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !dirty" @click="save">{{ busy ? $t('Instance.saving') : $t('Instance.save') }}</button>
            </div>

            <div v-if="restartKeys.length" class="in-banner in-banner--warn"><ShellIcon name="alert" :size="15" /><span>{{ $t('Instance.restart_needed', { keys: restartKeys.join(', ') }) }}</span></div>
            <div v-if="testResult" class="in-banner" :class="testResult.ok ? 'in-banner--ok' : 'in-banner--danger'"><ShellIcon :name="testResult.ok ? 'check' : 'alert'" :size="15" /><span>{{ testResult.text }}</span></div>
            <p class="ah-small">{{ $t('Instance.settings_lead') }} <a :href="guide('configure')" target="_blank" rel="noopener">{{ $t('Instance.guide') }}</a></p>

            <section class="ah-card in-card">
                <div v-for="row in visible" :key="row.key" class="in-field">
                    <div>
                        <label class="in-field__label" :for="`f-${row.key}`">
                            {{ label(row) }}
                            <span v-if="row.locked" class="ah-chip ah-chip--mono" :title="$t('Instance.locked_help')">{{ $t('Instance.locked') }}</span>
                            <span v-if="row.restart" class="ah-chip ah-chip--warn">{{ $t('Instance.restart') }}</span>
                        </label>
                        <div class="in-field__help">{{ row.help }} <code class="ah-mono">{{ row.key }}</code></div>
                    </div>
                    <div class="in-field__control">
                        <select v-if="row.type === 'select'" :id="`f-${row.key}`" v-model="draft[row.key]" class="ah-input" :disabled="row.locked">
                            <option v-for="o in row.options" :key="o" :value="o">{{ o }}</option>
                        </select>
                        <label v-else-if="row.type === 'boolean'" class="in-toggle">
                            <input :id="`f-${row.key}`" v-model="draft[row.key]" type="checkbox" class="ah-check" true-value="true" false-value="false" :disabled="row.locked" />
                            <span>{{ draft[row.key] === 'true' ? $t('Instance.on') : $t('Instance.off') }}</span>
                        </label>
                        <template v-else-if="row.secret">
                            <input :id="`f-${row.key}`" v-model="draft[row.key]" type="password" autocomplete="new-password" class="ah-input" :disabled="row.locked" :placeholder="row.value.set ? $t('Instance.secret_set') : $t('Instance.secret_unset')" />
                            <label v-if="row.value.set && !row.locked" class="ah-small in-clear"><input v-model="clear[row.key]" type="checkbox" class="ah-check" /> {{ $t('Instance.clear_secret') }}</label>
                        </template>
                        <input v-else :id="`f-${row.key}`" v-model="draft[row.key]" :type="row.type === 'number' ? 'number' : 'text'" class="ah-input" :class="{ 'ah-input--error': errors[row.key] }" :disabled="row.locked" :placeholder="row.default || ''" />
                        <span v-if="errors[row.key]" class="ah-field__error">{{ $t(`Instance.err_${errors[row.key]}`) }}</span>
                        <span v-else-if="row.source === 'default' && !row.secret" class="ah-small">{{ $t('Instance.using_default') }}</span>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequestWithoutCompnay } from "@/services";
import { useInstanceApi } from "./useInstanceApi";

defineOptions({ name: "InstanceSettings" });

const { t, te } = useI18n();
const $toast = useToast();
const route = useRoute();
const { get, put, message, guide, env } = useInstanceApi();

const TESTABLE = ["mail", "storage", "ai"];
const rows = ref([]);
const groups = ref([]);
const group = ref(String(route.query.group || "general"));
const draft = reactive({});
const clear = reactive({});
const errors = reactive({});
const busy = ref(false);
const error = ref("");
const restartKeys = ref([]);
const testResult = ref(null);
let baseline = {};

const visible = computed(() => rows.value.filter((r) => r.group === group.value));
const testable = computed(() => TESTABLE.includes(group.value));
const dirty = computed(() => Object.keys(draft).some((k) => draft[k] !== baseline[k]) || Object.values(clear).some(Boolean));
const label = (row) => (te(`Instance.f_${row.key}`) ? t(`Instance.f_${row.key}`) : row.label);

function seed(list) {
    rows.value = list;
    Object.keys(draft).forEach((k) => delete draft[k]);
    Object.keys(clear).forEach((k) => delete clear[k]);
    Object.keys(errors).forEach((k) => delete errors[k]);
    for (const row of list) draft[row.key] = row.secret ? "" : (row.value ?? "");
    baseline = { ...draft };
}

async function load() {
    error.value = "";
    try {
        const data = await get(env.INSTANCE_SETTINGS);
        groups.value = data.groups;
        seed(data.settings);
    } catch (e) {
        error.value = message(e);
    }
}

/* Only what changed travels: a secret left blank stays as it is on the server. */
function patch() {
    const body = {};
    for (const row of rows.value) {
        if (row.locked) continue;
        if (row.secret) {
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
        else $toast.error(message(e));
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
        testResult.value = { ok: res?.data?.status === true, text: res?.data?.statusText || t("Instance.test_ok") };
    } finally {
        busy.value = false;
    }
}

watch(group, () => { testResult.value = null; });
onMounted(load);
</script>

<style scoped>
.in-toggle { display: inline-flex; align-items: center; gap: 8px; font: var(--text-small); color: var(--ink); cursor: pointer; }
.in-clear { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
</style>
