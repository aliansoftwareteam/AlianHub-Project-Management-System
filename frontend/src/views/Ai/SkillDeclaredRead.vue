<template>
    <div class="sk-read" data-test="declared-read">
        <p class="ah-small sk-read__lead">{{ $t('Ai.skill_read_lead') }}</p>

        <div class="ah-field">
            <label class="ah-field__label" :for="`${id}-host`">{{ $t('Ai.skill_read_host') }}</label>
            <div class="sk-read__host">
                <input :id="`${id}-host`" :value="params.host || ''" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': errorAt('host') }" data-test="read-host" :placeholder="$t('Ai.skill_read_host_placeholder')" autocomplete="off" spellcheck="false" @input="set('host', $event.target.value.trim())" />
                <span v-if="chip" class="ah-chip ah-chip--sm" :class="chip.tone" data-test="read-host-state" aria-live="polite">{{ chip.text }}</span>
            </div>
            <span class="ah-field__hint">{{ $t('Ai.skill_read_host_hint') }}</span>
            <span v-if="state === 'not_declarable'" class="ah-field__hint" data-test="read-host-reason">{{ reasonText }}</span>
            <template v-if="state === 'not_listed'">
                <router-link v-if="instanceAdmin" class="ah-small sk-read__link" :to="{ name: 'InstanceEgress', params: { cid } }">{{ $t('Ai.skill_read_open_egress') }}</router-link>
                <span v-else class="ah-field__hint">{{ $t('Ai.skill_read_ask_owner') }}</span>
            </template>
            <span v-if="errorAt('host')" class="ah-field__error" data-test="read-host-error">{{ errorAt('host') }}</span>
        </div>

        <div class="ah-field">
            <label class="ah-field__label" :for="`${id}-path`">{{ $t('Ai.skill_read_path') }}</label>
            <input :id="`${id}-path`" :value="params.path || ''" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': errorAt('path') }" data-test="read-path" :placeholder="$t('Ai.skill_read_path_placeholder')" autocomplete="off" spellcheck="false" @input="set('path', $event.target.value)" />
            <span class="ah-field__hint" data-test="read-path-help">{{ $t('Ai.skill_read_path_hint', { placeholders: placeholderList }) }}</span>
            <span v-if="errorAt('path')" class="ah-field__error" data-test="read-path-error">{{ errorAt('path') }}</span>
        </div>

        <div class="sk-editor__row">
            <div class="ah-field">
                <label class="ah-field__label" :for="`${id}-format`">{{ $t('Ai.skill_read_format') }}</label>
                <select :id="`${id}-format`" :value="params.format || spec.format?.default" class="ah-input ah-mono" data-test="read-format" @change="set('format', $event.target.value)">
                    <option v-for="format in spec.format?.values || []" :key="format" :value="format">{{ format }}</option>
                </select>
                <span v-if="errorAt('format')" class="ah-field__error">{{ errorAt('format') }}</span>
            </div>
            <div class="ah-field">
                <label class="ah-field__label" :for="`${id}-credential`">{{ $t('Ai.skill_read_credential') }}</label>
                <select :id="`${id}-credential`" :value="params.credential || ''" class="ah-input" :class="{ 'ah-input--error': errorAt('credential') }" data-test="read-credential" @change="set('credential', $event.target.value)">
                    <option value="">{{ $t('Ai.skill_read_credential_none') }}</option>
                    <option v-for="secret in credentials" :key="secret.handle" :value="secret.handle">{{ secret.name }} · {{ secret.handle }}</option>
                </select>
                <span v-if="params.host && !credentials.length" class="ah-field__hint">{{ $t('Ai.skill_read_credential_empty', { host: params.host }) }}</span>
                <span v-else class="ah-field__hint">{{ $t('Ai.skill_read_credential_hint') }}</span>
                <span v-if="errorAt('credential')" class="ah-field__error" data-test="read-credential-error">{{ errorAt('credential') }}</span>
            </div>
        </div>

        <div class="ah-field">
            <span class="ah-field__label">{{ $t('Ai.skill_read_caps') }}</span>
            <div class="sk-read__caps">
                <div v-for="cap in caps" :key="cap.name" class="ah-field">
                    <label class="ah-small" :for="`${id}-${cap.name}`">{{ $t(`Ai.skill_read_${cap.name}`) }}</label>
                    <input :id="`${id}-${cap.name}`" :value="params[cap.name] ?? ''" type="number" class="ah-input ah-mono" :class="{ 'ah-input--error': errorAt(cap.name) }" data-test="read-cap" :min="cap.min" :max="cap.max" :placeholder="String(cap.default)" @input="setNumber(cap.name, $event.target.value)" />
                    <span class="ah-field__hint">{{ $t('Ai.skill_read_cap_range', { min: cap.min, max: cap.max }) }}</span>
                    <span v-if="errorAt(cap.name)" class="ah-field__error" :data-test="`read-cap-error-${cap.name}`">{{ errorAt(cap.name) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { CAPS, HOST_REASONS, HOST_STATES, credentialsForHost } from "./declaredReads";

defineOptions({ name: "SkillDeclaredRead" });

const props = defineProps({
    index: { type: Number, required: true },
    reader: { type: Object, required: true },
    params: { type: Object, required: true },
    secrets: { type: Array, default: () => [] },
    instanceAdmin: { type: Boolean, default: false },
    placeholders: { type: Array, default: () => [] },
    errorFor: { type: Function, default: () => "" }
});
const emit = defineEmits(["set"]);

const { t } = useI18n();
const cid = inject("$companyId", "");

const id = computed(() => `sk-read${props.index}`);
const spec = computed(() => props.reader.params || {});
const caps = computed(() => CAPS.filter((name) => spec.value[name]).map((name) => ({ name, ...spec.value[name] })));
const credentials = computed(() => credentialsForHost(props.secrets, props.params.host));
const placeholderList = computed(() => props.placeholders.map((p) => `{{${p}}}`).join(", "));

const errorAt = (name) => props.errorFor(`gather[${props.index}].params.${name}`);

const set = (name, value) => emit("set", name, value);
const setNumber = (name, text) => set(name, text === "" ? "" : Number(text));

const CHECK_DELAY_MS = 400;
const state = ref("");
const reason = ref("");
let timer = null;
let asked = 0;

const TONE = { allowed: "ah-chip--ok", not_listed: "ah-chip--warn", not_declarable: "ah-chip--danger" };
const chip = computed(() => (state.value ? { text: t(`Ai.skill_read_chip_${state.value}`), tone: TONE[state.value] || "" } : null));
const reasonText = computed(() => t(`Ai.skill_read_host_${HOST_REASONS.includes(reason.value) ? reason.value : "invalid"}`, { host: props.params.host || "" }));

/* Only the latest answer lands: a slow reply for an earlier spelling must not overwrite the current one. */
const check = async (host) => {
    asked += 1;
    const mine = asked;
    if (!host) { state.value = ""; return; }
    state.value = "checking";
    try {
        const res = await apiRequest("get", `${env.AGENT_SKILL_EGRESS_CHECK}?host=${encodeURIComponent(host)}`);
        if (mine !== asked) return;
        const data = res?.data?.status ? res.data.data : null;
        state.value = data && HOST_STATES.includes(data.state) ? data.state : "unchecked";
        reason.value = data?.reason || "";
    } catch (e) {
        if (mine === asked) state.value = "unchecked";
    }
};

watch(() => props.params.host, (host) => {
    clearTimeout(timer);
    timer = setTimeout(() => check(host), CHECK_DELAY_MS);
});
onMounted(() => check(props.params.host));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<style>
.sk-read { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--brand-border); border-radius: 9px; background: var(--fill); }
.sk-read__lead { margin: 0; }
.sk-read__host { display: flex; align-items: center; gap: 8px; }
.sk-read__host .ah-input { flex: 1; }
.sk-read__caps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sk-read__link { color: var(--brand); }
</style>
