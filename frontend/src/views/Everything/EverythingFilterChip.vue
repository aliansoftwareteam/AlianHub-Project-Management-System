<template>
    <div ref="anchor" class="evr__chip-anchor">
        <button
            type="button"
            class="evr__chip"
            :class="{ 'is-on': modelValue.length }"
            :aria-expanded="open ? 'true' : 'false'"
            aria-haspopup="listbox"
            :data-test="`evr-filter-${name}`"
            @click="open = !open"
        >
            <span>{{ label }}</span>
            <span v-if="modelValue.length" class="evr__chip-n">{{ summary }}</span>
            <ShellIcon name="chevronDown" :size="12" aria-hidden="true" />
        </button>
        <div v-if="open" class="ah-pop evr__pop" role="listbox" :aria-label="label" :aria-multiselectable="single ? 'false' : 'true'">
            <input
                v-if="options.length > SEARCH_FROM"
                v-model="needle"
                type="search"
                class="ah-input evr__pop-search"
                :placeholder="$t('Everything.find_option')"
                :aria-label="$t('Everything.find_option')"
            />
            <div class="evr__pop-list ah-scroll">
                <button
                    v-for="option in shown"
                    :key="option.value"
                    type="button"
                    class="ah-pop__item evr__option"
                    role="option"
                    :aria-selected="isOn(option) ? 'true' : 'false'"
                    data-test="evr-option"
                    @click="pick(option)"
                >
                    <span class="evr__tick"><ShellIcon v-if="isOn(option)" name="check" :size="13" /></span>
                    <span v-if="option.color" class="evr__dot" :style="{ background: option.color }" aria-hidden="true"></span>
                    <span class="evr__option-label">{{ option.label }}</span>
                </button>
                <div v-if="!shown.length" class="evr__pop-empty">{{ $t('Everything.no_options') }}</div>
            </div>
            <button v-if="modelValue.length" type="button" class="ah-pop__item evr__clear" data-test="evr-clear" @click="clear">{{ $t('Everything.clear') }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "EverythingFilterChip" });

const SEARCH_FROM = 8;

const props = defineProps({
    name: { type: String, required: true },
    label: { type: String, required: true },
    options: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
    single: { type: Boolean, default: false }
});
const emit = defineEmits(["update:modelValue"]);

const anchor = ref(null);
const open = ref(false);
const needle = ref("");

const isOn = (option) => props.modelValue.includes(option.value);
const shown = computed(() => {
    const text = needle.value.trim().toLowerCase();
    return text ? props.options.filter((option) => String(option.label).toLowerCase().includes(text)) : props.options;
});
const summary = computed(() => {
    if (props.modelValue.length > 1) return String(props.modelValue.length);
    return props.options.find((option) => option.value === props.modelValue[0])?.label || "1";
});

function pick(option) {
    if (props.single) {
        emit("update:modelValue", isOn(option) ? [] : [option.value]);
        open.value = false;
        return;
    }
    emit("update:modelValue", isOn(option) ? props.modelValue.filter((value) => value !== option.value) : [...props.modelValue, option.value]);
}

function clear() {
    emit("update:modelValue", []);
    open.value = false;
}

const onOutside = (event) => { if (anchor.value && !anchor.value.contains(event.target)) open.value = false; };
const onEscape = (event) => { if (event.key === "Escape") open.value = false; };
const listen = (on) => {
    document[on ? "addEventListener" : "removeEventListener"]("click", onOutside);
    document[on ? "addEventListener" : "removeEventListener"]("keydown", onEscape);
};
watch(open, (isOpen) => {
    listen(isOpen);
    if (!isOpen) needle.value = "";
});
onBeforeUnmount(() => listen(false));
</script>
