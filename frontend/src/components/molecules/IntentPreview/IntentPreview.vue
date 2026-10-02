<template>
    <div v-if="kind" class="ipv" data-test="intent-preview">
        <div class="ipv__head">
            <ShellIcon class="ipv__icon" name="checkSquare" :size="14" />
            <span class="ah-chip ipv__kind" data-test="intent-kind">{{ kind }}</span>
            <strong class="ipv__title" data-test="intent-title">{{ title }}</strong>
        </div>
        <dl v-if="lines.length" class="ipv__lines">
            <div v-for="(line, i) in lines" :key="i" class="ipv__line" data-test="intent-line" :data-kind="line.kind">
                <dt class="ipv__label">{{ line.label }}</dt>
                <dd v-if="line.open" class="ipv__text ipv__open">
                    <button v-for="task in line.open" :key="task.taskId" type="button" class="ipv__task" data-test="intent-open-task" @click="emit('open-task', task)">{{ task.name }}</button>
                    <span v-if="line.text" data-test="intent-more">{{ line.text }}</span>
                </dd>
                <dd v-else class="ipv__text">{{ line.text }}</dd>
            </div>
        </dl>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { kindLabel, linesOf, titleOf } from './intentLines';

defineOptions({ name: 'IntentPreview' });

const props = defineProps({
    preview: { type: Object, required: true },
});

const emit = defineEmits(['open-task']);

const { t, locale } = useI18n();

const kind = computed(() => kindLabel(t, props.preview));
const title = computed(() => titleOf(t, props.preview));
const lines = computed(() => linesOf(t, locale.value, props.preview));
</script>

<style scoped>
.ipv { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-md, 8px); background: var(--surface); color: var(--ink); }
.ipv__head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.ipv__icon { flex: none; color: var(--ink-2); }
.ipv__kind { flex: none; }
.ipv__title { flex: 1 1 12ch; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
.ipv__lines { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.ipv__line { display: grid; grid-template-columns: minmax(72px, max-content) minmax(0, 1fr); gap: 2px 12px; min-width: 0; }
.ipv__label { color: var(--ink-2); font-size: var(--fs-sm, 11.5px); line-height: 1.5; }
.ipv__text { margin: 0; min-width: 0; overflow-wrap: anywhere; white-space: pre-line; line-height: 1.45; }
.ipv__open { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; white-space: normal; }
.ipv__task { border: 0; padding: 0; background: transparent; color: var(--brand); font: inherit; text-align: left; text-decoration: underline; cursor: pointer; min-width: 0; overflow-wrap: anywhere; }
.ipv__task:focus-visible { outline: none; box-shadow: var(--focus); border-radius: var(--r-sm, 6px); }
@media (max-width: 480px) {
    .ipv__line { grid-template-columns: minmax(0, 1fr); }
}
</style>
