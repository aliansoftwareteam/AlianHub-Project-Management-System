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

        <div v-if="spec.link" class="ah-field">
            <label class="ah-field__label" :for="`${id}-link`">{{ $t('Ai.skill_read_link') }}</label>
            <select :id="`${id}-link`" :value="params.link || ''" class="ah-input ah-mono" :class="{ 'ah-input--error': errorAt('link') }" data-test="read-link" @change="set('link', $event.target.value)">
                <option value="">{{ $t('Ai.skill_read_link_none') }}</option>
                <option v-for="input in linkInputs" :key="input" :value="input">{{ input }}</option>
            </select>
            <span v-if="!linkInputs.length" class="ah-field__hint" data-test="read-link-hint">{{ $t('Ai.skill_read_link_none_declared', { inputs: (spec.link.values || []).join(', ') }) }}</span>
            <span v-else class="ah-field__hint" data-test="read-link-hint">{{ $t('Ai.skill_read_link_hint') }}</span>
            <span v-if="errorAt('link')" class="ah-field__error" data-test="read-link-error">{{ errorAt('link') }}</span>
        </div>

        <div v-if="!(spec.link && params.link)" class="ah-field">
            <label class="ah-field__label" :for="`${id}-path`">{{ $t('Ai.skill_read_path') }}</label>
            <input :id="`${id}-path`" :value="params.path || ''" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': errorAt('path') }" data-test="read-path" :placeholder="$t('Ai.skill_read_path_placeholder')" autocomplete="off" spellcheck="false" @input="set('path', $event.target.value)" />
            <span class="ah-field__hint" data-test="read-path-help">{{ $t('Ai.skill_read_path_hint', { placeholders: placeholderList }) }}</span>
            <span v-if="errorAt('path')" class="ah-field__error" data-test="read-path-error">{{ errorAt('path') }}</span>
        </div>

        <div v-if="spec.hosts" class="ah-field" data-test="read-hosts">
            <span class="ah-field__label">{{ $t('Ai.skill_read_hosts') }}</span>
            <span class="ah-field__hint">{{ $t('Ai.skill_read_hosts_hint', { max: spec.hosts.max }) }}</span>
            <SkillReadExtraHost
                v-for="(host, j) in extraHosts"
                :id="`${id}-hosts${j}`"
                :key="j"
                :position="j + 1"
                :host="host"
                :instance-admin="instanceAdmin"
                :error="errorAt(`hosts[${j}]`)"
                @update="(value) => setHost(j, value)"
                @remove="removeHost(j)"
            />
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm sk-read__add" data-test="read-add-host" :disabled="extraHosts.length >= spec.hosts.max" @click="addHost">{{ $t('Ai.skill_read_hosts_add') }}</button>
            <span v-if="errorAt('hosts')" class="ah-field__error" data-test="read-hosts-error">{{ errorAt('hosts') }}</span>
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
import { computed, inject } from "vue";
import { CAPS, credentialsForHost, linkChoices } from "./declaredReads";
import { useHostCheck } from "./useHostCheck";
import SkillReadExtraHost from "./SkillReadExtraHost.vue";

defineOptions({ name: "SkillDeclaredRead" });

const props = defineProps({
    index: { type: Number, required: true },
    reader: { type: Object, required: true },
    params: { type: Object, required: true },
    secrets: { type: Array, default: () => [] },
    instanceAdmin: { type: Boolean, default: false },
    placeholders: { type: Array, default: () => [] },
    inputs: { type: Array, default: () => [] },
    errorFor: { type: Function, default: () => "" }
});
const emit = defineEmits(["set"]);

const cid = inject("$companyId", "");

const id = computed(() => `sk-read${props.index}`);
const spec = computed(() => props.reader.params || {});
const caps = computed(() => CAPS.filter((name) => spec.value[name]).map((name) => ({ name, ...spec.value[name] })));
const credentials = computed(() => credentialsForHost(props.secrets, props.params.host));
const placeholderList = computed(() => props.placeholders.map((p) => `{{${p}}}`).join(", "));
const linkInputs = computed(() => linkChoices(spec.value.link, props.inputs, props.params.link));
const extraHosts = computed(() => (Array.isArray(props.params.hosts) ? props.params.hosts : []));

const errorAt = (name) => props.errorFor(`gather[${props.index}].params.${name}`);

const set = (name, value) => emit("set", name, value);
const setNumber = (name, text) => set(name, text === "" ? "" : Number(text));

const setHost = (at, value) => set("hosts", extraHosts.value.map((host, i) => (i === at ? value : host)));
const removeHost = (at) => set("hosts", extraHosts.value.filter((_, i) => i !== at));
const addHost = () => set("hosts", [...extraHosts.value, ""]);

const { state, chip, reasonText } = useHostCheck(() => props.params.host);
</script>

<style>
.sk-read { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--brand-border); border-radius: 9px; background: var(--fill); }
.sk-read__lead { margin: 0; }
.sk-read__host { display: flex; align-items: center; gap: 8px; }
.sk-read__host .ah-input { flex: 1; }
.sk-read__caps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sk-read__link { color: var(--brand); }
.sk-read__extra { display: flex; flex-direction: column; gap: 4px; }
.sk-read__add { align-self: flex-start; }
</style>
