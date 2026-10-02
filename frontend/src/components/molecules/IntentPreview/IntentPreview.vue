<template>
    <div v-if="kind" class="ipv" data-test="intent-preview">
        <div class="ipv__head">
            <ShellIcon class="ipv__icon" name="checkSquare" :size="14" />
            <span class="ah-chip ipv__kind" data-test="intent-kind">{{ kind }}</span>
            <strong class="ipv__title" data-test="intent-title">{{ title }}</strong>
        </div>
        <dl v-if="lines.length" class="ipv__lines">
            <div
                v-for="(line, i) in rows"
                :key="i"
                class="ipv__line"
                :class="{ 'is-out': isOut(line.pick) || isOut(line.under), 'is-under': choosing && line.under, 'is-more': line.more }"
                data-test="intent-line"
                :data-kind="line.kind"
            >
                <dt class="ipv__label">{{ line.label }}</dt>
                <dd v-if="line.open" class="ipv__text ipv__open">
                    <button v-for="task in line.open" :key="task.taskId" type="button" class="ipv__task" data-test="intent-open-task" @click="emit('open-task', task)">{{ task.name }}</button>
                    <span v-if="line.text" data-test="intent-more">{{ line.text }}</span>
                </dd>
                <dd v-else-if="choosing && line.picks?.length" class="ipv__text ipv__picks">
                    <label v-for="pick in line.picks" :key="pick.key" class="ipv__pick" :class="{ 'is-out': isOut(pick.key), 'is-locked': isLocked(pick.key) }">
                        <input type="checkbox" class="ah-check" data-test="intent-pick" :data-pick="pick.key" :checked="!isOut(pick.key)" :disabled="disabled || isLocked(pick.key)" @change="toggle(pick.key)" />
                        <span>{{ pick.name }} <span v-if="needsOwner(pick.key)" class="ipv__locked" data-test="intent-pick-locked">{{ t('IntentPreview.pick_locked') }}</span></span>
                    </label>
                </dd>
                <dd v-else-if="choosing && line.pick" class="ipv__text">
                    <label class="ipv__pick" :class="{ 'is-out': isOut(line.pick), 'is-locked': isLocked(line.pick) }">
                        <input type="checkbox" class="ah-check" data-test="intent-pick" :data-pick="line.pick" :checked="!isOut(line.pick)" :disabled="disabled || isLocked(line.pick)" @change="toggle(line.pick)" />
                        <span>{{ line.text }} <span v-if="needsOwner(line.pick)" class="ipv__locked" data-test="intent-pick-locked">{{ t('IntentPreview.pick_locked') }}</span></span>
                    </label>
                </dd>
                <dd v-else class="ipv__text">{{ line.text }}</dd>
            </div>
        </dl>
        <p v-if="choosing" class="ipv__hint" data-test="intent-pick-hint">{{ t('IntentPreview.pick_hint') }}</p>
        <p v-if="choosing && kept" class="ipv__hint ipv__went" data-test="intent-pick-kept">{{ t('IntentPreview.pick_kept', { parts: kept }) }}</p>
        <p v-for="line in held" :key="line" class="ipv__hint ipv__went" data-test="intent-pick-held">{{ line }}</p>
        <p v-if="choosing && went" class="ipv__hint ipv__went" role="status" data-test="intent-pick-also">{{ went }}</p>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { kindLabel, linesOf, titleOf } from './intentLines';
import { broughtBack, canChoose, heldWith, keptText, lockedParts, pickNames, toggled } from './planPicks';

defineOptions({ name: 'IntentPreview' });

const props = defineProps({
    preview: { type: Object, required: true },
    choosable: { type: Boolean, default: false },
    leftOut: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['open-task', 'update:leftOut']);

const { t, locale } = useI18n();

const kind = computed(() => kindLabel(t, props.preview));
const title = computed(() => titleOf(t, props.preview));
const lines = computed(() => linesOf(t, locale.value, props.preview));
const choosing = computed(() => props.choosable && canChoose(props.preview));
const kept = computed(() => (choosing.value ? keptText(t, props.preview, props.leftOut) : ''));
const went = ref('');

const locked = computed(() => lockedParts(props.preview));
const isLocked = (key) => choosing.value && locked.value.includes(key);
const needsOwner = (key) => isLocked(key) && props.preview.locked.includes(key);

/* Several parts of one kind in a row are headed once, in the plural, where each has its own tick box. */
const GROUP_LABELS = Object.freeze({ field: 'IntentPreview.line_fields', planRule: 'IntentPreview.line_rules', planTask: 'IntentPreview.line_first_tasks' });
const grouped = (a, b) => Boolean(a?.pick && b?.pick) && a.kind === b.kind && Object.hasOwn(GROUP_LABELS, a.kind);
const rows = computed(() => lines.value.map((line, i, all) => {
    if (!choosing.value) return line;
    const more = grouped(all[i - 1], line);
    return more || grouped(line, all[i + 1]) ? { ...line, more, label: t(GROUP_LABELS[line.kind]) } : line;
}));

const isOut = (key) => choosing.value && Boolean(key) && (props.leftOut.includes(key) || locked.value.includes(key));

const names = computed(() => pickNames(props.preview));
const said = (message, keys, key) => {
    const quoted = keys.map((held) => (names.value.get(held) || '').replace(/\.$/, '')).filter(Boolean).map((name) => t('IntentPreview.pick_named', { name }));
    return quoted.length ? t(message, { names: quoted.join(', '), name: names.value.get(key) || '' }, quoted.length) : '';
};

// A part that needs one this person may not approve is left out with it, and the card says so from the start.
const held = computed(() => (choosing.value ? heldWith(props.preview).map((entry) => said('IntentPreview.pick_also_out', entry.held, entry.key)).filter(Boolean) : []));

// By the part the person unticked: what went out with it, so ticking it back undoes the whole click.
const wentWith = {};

const toggle = (key) => {
    if (isLocked(key)) return;
    const next = toggled(props.preview, props.leftOut, key);
    if (next.includes(key)) {
        wentWith[key] = next.filter((part) => part !== key && !props.leftOut.includes(part));
        went.value = said('IntentPreview.pick_also_out', wentWith[key], key);
        emit('update:leftOut', next);
        return;
    }
    const after = broughtBack(props.preview, next, wentWith[key] || []);
    delete wentWith[key];
    const needed = props.leftOut.filter((part) => part !== key && !next.includes(part) && !locked.value.includes(part));
    went.value = [said('IntentPreview.pick_also_kept', needed, key), said('IntentPreview.pick_also_back', next.filter((part) => !after.includes(part)), key)].filter(Boolean).join(' ');
    emit('update:leftOut', after);
};
</script>

<style scoped>
.ipv { --ipv-under: 21px; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: var(--r-md, 8px); background: var(--surface); color: var(--ink); }
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
.ipv__picks { display: flex; flex-wrap: wrap; gap: 2px 14px; white-space: normal; }
.ipv__pick { display: inline-flex; align-items: flex-start; gap: 6px; min-width: 0; min-height: var(--hit-min, 24px); cursor: pointer; }
.ipv__pick .ah-check { flex: none; margin-top: 2px; }
.ipv__pick span { min-width: 0; overflow-wrap: anywhere; }
.ipv__line.is-out .ipv__text, .ipv__pick.is-out { color: var(--ink-2); text-decoration: line-through; }
.ipv__pick.is-locked { cursor: default; }
/* An inline block of its own keeps the line through a part that is left out off the reason beside it. */
.ipv__locked { display: inline-block; width: 100%; color: var(--ink-2); font-size: var(--fs-sm, 11.5px); line-height: 1.45; }
.ipv__line.is-more .ipv__label { visibility: hidden; }
.ipv__line.is-under .ipv__text { padding-left: var(--ipv-under); }
.ipv__hint { margin: 0; color: var(--ink-2); font-size: var(--fs-sm, 11.5px); line-height: 1.45; }
.ipv__went { color: var(--ink); }
@media (max-width: 767px) {
    .ipv__pick { box-sizing: border-box; min-height: 36px; padding: 8px 0; }
}
@media (max-width: 480px) {
    .ipv__line { grid-template-columns: minmax(0, 1fr); }
    .ipv__line.is-more .ipv__label { display: none; }
    .ipv__line.is-under { padding-left: var(--ipv-under); }
    .ipv__line.is-under .ipv__text { padding-left: 0; }
}
</style>
