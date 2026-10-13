<template>
    <span class="ftp" :class="{ 'ftp--compact': compact }">
        <template v-if="editable">
            <input
                type="range"
                class="ftp__range"
                data-cell-edit
                :min="RANGE.min"
                :max="RANGE.max"
                step="1"
                :value="dragged ?? percent ?? 0"
                :aria-label="label"
                :aria-valuetext="text || $t('FieldTypes.progress_none')"
                @input="dragged = Number($event.target.value)"
                @pointerdown="onRangePointer"
                @keydown="onRangeKey"
                @change="onRangeChange"
                @blur="commitRange"
            />
            <input
                v-model="typed"
                class="ftp__number"
                type="text"
                inputmode="numeric"
                maxlength="3"
                data-progress-number
                :aria-label="$t('FieldTypes.progress_type', { field: label })"
                @keydown.enter.prevent="commitTyped"
                @keydown.esc="resetTyped"
                @blur="commitTyped"
            />
            <span class="ftp__unit" aria-hidden="true">%</span>
        </template>
        <template v-else-if="percent !== null">
            <span class="ftp__track" role="progressbar" :aria-label="label" :aria-valuenow="percent" :aria-valuemin="RANGE.min" :aria-valuemax="RANGE.max">
                <span class="ftp__fill" :style="{ width: `${percent}%` }"></span>
            </span>
            <span class="ftp__text">{{ text }}</span>
        </template>
    </span>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { RANGE, shownOf, text as progressText } from "@fieldTypes/progress";

defineOptions({ name: "ProgressFieldValue" });

const props = defineProps({
    def: { type: Object, required: true },
    value: { type: [Number, String, Array, Object], default: "" },
    editable: { type: Boolean, default: false },
    compact: { type: Boolean, default: false },
    label: { type: String, default: "" }
});
const emit = defineEmits(["change"]);

const percent = computed(() => shownOf(props.value));
const text = computed(() => progressText(props.value));
const storedText = computed(() => (percent.value === null ? "" : String(percent.value)));

const dragged = ref(null);
const typed = ref(storedText.value);
let byKeyboard = false;
let sent = null;

watch(storedText, (next) => {
    typed.value = next;
    dragged.value = null;
    sent = null;
});

const send = (next) => {
    if (next === sent) return;
    sent = next;
    emit("change", next);
};

/* Every arrow key press on a range fires `change`, so a value set from the keyboard is saved on Enter or on leaving the bar. */
function onRangeKey(event) {
    if (event.key === "Enter") commitRange();
    else byKeyboard = true;
}

function onRangePointer() {
    byKeyboard = false;
}

function onRangeChange() {
    if (!byKeyboard) commitRange();
}

function commitRange() {
    byKeyboard = false;
    const next = dragged.value;
    if (next === null) return;
    if (next === percent.value) dragged.value = null;
    else send(next);
}

function commitTyped() {
    const next = String(typed.value ?? "").trim();
    if (next !== storedText.value) send(next);
}

function resetTyped() {
    typed.value = storedText.value;
}
</script>

<style>
.ftp { display: inline-flex; align-items: center; gap: 6px; min-width: 0; width: 100%; max-width: 220px; }
.ftp--compact { max-width: 100%; }
.ftp__track { flex: 1 1 40px; min-width: 24px; height: 6px; border-radius: 999px; background: var(--fill); overflow: hidden; }
.ftp__fill { display: block; height: 100%; border-radius: inherit; background: var(--brand); }
.ftp__text, .ftp__unit { flex: none; color: var(--ink-2); font: var(--text-data); }
.ftp__range { flex: 1 1 40px; min-width: 24px; height: 16px; margin: 0; accent-color: var(--brand); cursor: pointer; }
.ftp__range:focus-visible, .ftp__number:focus-visible { outline: none; box-shadow: var(--focus); }
.ftp__number {
    flex: none; width: 4ch; box-sizing: content-box; height: 20px;
    padding: 1px 4px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: var(--text-data); text-align: right;
}
</style>
