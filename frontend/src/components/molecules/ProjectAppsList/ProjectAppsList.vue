<template>
    <ul class="pal" :class="{ 'is-disabled': disabled }">
        <li v-for="app in apps" :key="app.key" class="pal__row">
            <img :src="iconFor(app.key)" alt="" class="pal__icon" />
            <label class="pal__text" :for="`pal-${uid}-${app.key}`">
                <span class="pal__title">{{ label(app, 'title') }}</span>
                <span class="ah-small ah-muted">{{ label(app, 'desc') }}</span>
            </label>
            <Toggle
                :id="`pal-${uid}-${app.key}`"
                width="30"
                :modelValue="modelValue.includes(app.key)"
                :disabled="disabled"
                @update:modelValue="onToggle(app.key)"
            />
        </li>
    </ul>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import Toggle from '@/components/atom/Toggle/Toggle.vue';
import { projectAppsIcons } from '@/composable/commonFunction';
import { useCustomComposable } from '@/composable';

const props = defineProps({
    apps: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'toggle']);

const { t, te } = useI18n();
const { makeUniqueId } = useCustomComposable();
const uid = makeUniqueId(4);

const label = (app, part) => {
    const key = `AppsV2.${app.key}_${part}`;
    if (te(key)) return t(key);
    return part === 'title' ? (app.name || app.key) : '';
};

const iconFor = (key) => {
    const icons = projectAppsIcons(key) || {};
    return props.modelValue.includes(key) ? icons.afterIcon : icons.beforeIcon;
};

const onToggle = (key) => {
    if (props.disabled) return;
    const next = props.modelValue.includes(key) ? props.modelValue.filter((k) => k !== key) : [...props.modelValue, key];
    emit('update:modelValue', next);
    emit('toggle', key);
};
</script>

<style scoped>
.pal { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-ui); }
.pal__row { display: flex; align-items: center; gap: 12px; padding: 8px 6px; border-radius: 8px; }
.pal__row:hover { background: var(--surface-hover); }
.pal__icon { width: 18px; height: 18px; flex: none; }
.pal__text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; margin: 0; cursor: pointer; }
.pal__title { font: 500 13px/1.3 var(--font-ui); color: var(--ink); }
.pal.is-disabled { opacity: .6; }
.pal.is-disabled .pal__text { cursor: default; }
</style>
