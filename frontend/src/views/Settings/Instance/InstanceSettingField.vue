<template>
    <div class="in-field" :data-test="`instance-field-${row.key}`">
        <div>
            <label class="in-field__label" :for="id" :title="hosted ? undefined : row.key">
                {{ label }}
                <span v-if="row.locked && !hosted" class="ah-chip ah-chip--mono" :title="$t('Instance.locked_help')">{{ $t('Instance.locked') }}</span>
                <span v-if="row.restart" class="ah-chip ah-chip--warn" :title="$t('Instance.restart_help')">{{ $t('Instance.restart') }}</span>
            </label>
            <div v-if="help" class="in-field__help">{{ help }}</div>
        </div>
        <div class="in-field__control">
            <select v-if="row.type === 'timezone'" :id="id" v-model="value" class="ah-input" :disabled="row.locked">
                <option v-if="!knownZone" :value="value">{{ value }}</option>
                <optgroup v-for="g in zones" :key="g.region" :label="g.region">
                    <option v-for="z in g.zones" :key="z" :value="z">{{ z.replace(/_/g, ' ') }}</option>
                </optgroup>
            </select>
            <select v-else-if="row.type === 'select'" :id="id" v-model="value" class="ah-input" :disabled="row.locked">
                <option v-for="o in row.options" :key="o" :value="o">{{ optionLabel(o) }}</option>
            </select>
            <label v-else-if="row.type === 'boolean'" class="in-toggle">
                <input :id="id" v-model="value" type="checkbox" class="ah-check" true-value="true" false-value="false" :disabled="row.locked" />
                <span>{{ value === 'true' ? $t('Instance.on') : $t('Instance.off') }}</span>
            </label>
            <template v-else-if="row.secret">
                <input :id="id" v-model="value" type="password" autocomplete="new-password" class="ah-input" :disabled="row.locked" :placeholder="row.value.set ? $t('Instance.secret_set') : $t('Instance.secret_unset')" />
                <label v-if="row.value.set && !row.locked" class="ah-small in-clear"><input v-model="clearValue" type="checkbox" class="ah-check" /> {{ $t('Instance.clear_secret') }}</label>
            </template>
            <textarea v-else-if="row.type === 'list'" :id="id" v-model="value" rows="4" class="ah-input in-list" :class="{ 'ah-input--error': error }" :disabled="row.locked" :placeholder="$t('Instance.allowlist_placeholder')" :data-test="`instance-setting-${row.key}`"></textarea>
            <input v-else :id="id" v-model="value" :type="row.type === 'number' ? 'number' : 'text'" class="ah-input" :class="{ 'ah-input--error': error }" :disabled="row.locked" :placeholder="row.default || ''" />

            <span v-if="error" class="ah-field__error">{{ $t(`Instance.err_${error}`) }}</span>
            <span v-else-if="row.source === 'default' && !row.secret && row.type !== 'boolean' && value === row.value" class="ah-small">{{ $t('Instance.using_default') }}</span>

            <ul v-if="effects.length" class="in-effects" :data-test="`instance-effects-${row.key}`">
                <li v-for="e in effects" :key="e.key" :class="{ 'is-current': e.current }">
                    <span class="in-effects__name">{{ e.name }}</span> {{ e.text }}
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { timeZones } from "./settingsLayout";

defineOptions({ name: "InstanceSettingField" });

const props = defineProps({
    row: { type: Object, required: true },
    error: { type: String, default: "" },
    hosted: { type: Boolean, default: false },
});
const value = defineModel({ type: String, default: "" });
const clearValue = defineModel("clear", { type: Boolean, default: false });

const { t, te } = useI18n();
const id = computed(() => `f-${props.row.key}`);
const zones = props.row.type === "timezone" ? timeZones() : [];
const knownZone = computed(() => zones.some((g) => g.zones.includes(value.value)));

const pick = (key, fallback) => (te(key) ? t(key) : fallback);
const label = computed(() => pick(`Instance.f_${props.row.key}`, props.row.label));
const help = computed(() => pick(`Instance.h_${props.row.key}`, props.row.help));
const optionLabel = (option) => pick(`Instance.o_${props.row.key}_${option}`, option);

/* What each state does: "When on / When off" for a switch, one line per choice for a dropdown. */
const effects = computed(() => {
    const key = props.row.key;
    if (props.row.type === "boolean") {
        return ["true", "false"]
            .filter((state) => te(`Instance.${state === "true" ? "when_on" : "when_off"}_${key}`))
            .map((state) => ({
                key: state,
                name: t(state === "true" ? "Instance.when_on" : "Instance.when_off"),
                text: t(`Instance.${state === "true" ? "when_on" : "when_off"}_${key}`),
                current: value.value === state,
            }));
    }
    if (props.row.type === "select") {
        return (props.row.options || [])
            .filter((option) => te(`Instance.od_${key}_${option}`))
            .map((option) => ({ key: option, name: `${optionLabel(option)}:`, text: t(`Instance.od_${key}_${option}`), current: value.value === option }));
    }
    return [];
});
</script>

<style scoped>
.in-toggle { display: inline-flex; align-items: center; gap: 8px; font: var(--text-small); color: var(--ink); cursor: pointer; }
.in-clear { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.in-list { height: auto; min-height: 88px; resize: vertical; font-family: var(--font-mono, monospace); }
.in-effects { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; max-width: 520px; font: var(--text-small); color: var(--ink-2); }
.in-effects li { padding-left: 10px; border-left: 2px solid var(--hairline); }
.in-effects li.is-current { color: var(--ink); border-left-color: var(--brand); }
.in-effects__name { font-weight: 600; }
</style>
