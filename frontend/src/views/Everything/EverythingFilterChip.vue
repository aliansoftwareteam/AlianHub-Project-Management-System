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
                v-if="options.length + groups.length > SEARCH_FROM"
                v-model="needle"
                type="search"
                class="ah-input evr__pop-search"
                :placeholder="$t('Everything.find_option')"
                :aria-label="$t('Everything.find_option')"
            />
            <div v-if="bulk && !single && shown.length > 1" class="evr__bulk">
                <button type="button" class="tv-link evr__bulk-btn" :disabled="allShownOn" data-test="evr-select-all" @click="selectShown">{{ $t('Everything.select_all') }}</button>
                <button type="button" class="tv-link evr__bulk-btn" :disabled="!someShownOn" data-test="evr-deselect-all" @click="deselectShown">{{ $t('Everything.deselect_all') }}</button>
            </div>
            <div class="evr__pop-list ah-scroll">
                <div v-if="shownGroups.length" role="group" :aria-label="groupsLabel" data-test="evr-groups">
                    <div class="ah-label ah-pop__label" aria-hidden="true">{{ groupsLabel }}</div>
                    <button
                        v-for="group in shownGroups"
                        :key="group.value"
                        type="button"
                        class="ah-pop__item evr__option"
                        :class="{ 'is-active': highlightPicked && stateOf(group) === 'all' }"
                        role="option"
                        :aria-selected="stateOf(group) === 'all' ? 'true' : 'false'"
                        :aria-label="groupName(group)"
                        :data-state="stateOf(group)"
                        data-test="evr-group"
                        @click="pickGroup(group)"
                    >
                        <span class="evr__tick">
                            <ShellIcon v-if="stateOf(group) === 'all'" name="check" :size="13" />
                            <span v-else-if="stateOf(group) === 'some'" class="evr__tick-some"></span>
                        </span>
                        <ShellIcon name="users" :size="13" class="evr__group-mark" :style="group.color ? { color: group.color } : null" aria-hidden="true" />
                        <span class="evr__option-label">{{ group.label }}</span>
                        <span class="evr__option-count" aria-hidden="true">{{ group.members.length }}</span>
                    </button>
                </div>
                <div :role="shownGroups.length ? 'group' : null" :aria-label="shownGroups.length ? optionsLabel : null">
                    <div v-if="shownGroups.length && shown.length" class="ah-label ah-pop__label" aria-hidden="true">{{ optionsLabel }}</div>
                    <button
                        v-for="option in shown"
                        :key="option.value"
                        type="button"
                        class="ah-pop__item evr__option"
                        :class="{ 'is-active': highlightPicked && isOn(option) }"
                        role="option"
                        :aria-selected="isOn(option) ? 'true' : 'false'"
                        data-test="evr-option"
                        @click="pick(option)"
                    >
                        <span class="evr__tick"><ShellIcon v-if="isOn(option)" name="check" :size="13" /></span>
                        <span v-if="option.color" class="evr__dot" :style="{ background: option.color }" aria-hidden="true"></span>
                        <span class="evr__option-label">{{ option.label }}</span>
                    </button>
                </div>
                <div v-if="!shown.length && !shownGroups.length" class="evr__pop-empty">{{ $t('Everything.no_options') }}</div>
            </div>
            <button v-if="modelValue.length" type="button" class="ah-pop__item evr__clear" data-test="evr-clear" @click="clear">{{ $t('Everything.clear') }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { groupMatching, groupState, toggleGroup } from "./filterGroups";

defineOptions({ name: "EverythingFilterChip" });

const SEARCH_FROM = 8;

const props = defineProps({
    name: { type: String, required: true },
    label: { type: String, required: true },
    options: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] },
    single: { type: Boolean, default: false },
    highlightPicked: { type: Boolean, default: false },
    bulk: { type: Boolean, default: false },
    /* Shortcuts above the options, each picking several of them: { value, label, color, members, hint }. */
    groups: { type: Array, default: () => [] },
    groupsLabel: { type: String, default: "" },
    optionsLabel: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue"]);
const { t } = useI18n();

const anchor = ref(null);
const open = ref(false);
const needle = ref("");

const isOn = (option) => props.modelValue.includes(option.value);
const matches = (list) => {
    const text = needle.value.trim().toLowerCase();
    return text ? list.filter((item) => String(item.label).toLowerCase().includes(text)) : list;
};
const shown = computed(() => matches(props.options));
const shownGroups = computed(() => (props.single ? [] : matches(props.groups)));
const summary = computed(() => {
    const group = groupMatching(props.groups, props.modelValue);
    if (group) return group.label;
    if (props.modelValue.length > 1) return String(props.modelValue.length);
    return props.options.find((option) => option.value === props.modelValue[0])?.label || "1";
});

const stateOf = (group) => groupState(group, props.modelValue);
const groupName = (group) => [group.label, group.hint, stateOf(group) === "some" ? t("Everything.some_picked") : ""].filter(Boolean).join(", ");
function pickGroup(group) {
    emit("update:modelValue", toggleGroup(group, props.modelValue, props.groups));
}

function pick(option) {
    if (props.single) {
        emit("update:modelValue", isOn(option) ? [] : [option.value]);
        open.value = false;
        return;
    }
    emit("update:modelValue", isOn(option) ? props.modelValue.filter((value) => value !== option.value) : [...props.modelValue, option.value]);
}

/* Over the options in view, so a search first narrows what "all" means. */
const allShownOn = computed(() => shown.value.every(isOn));
const someShownOn = computed(() => shown.value.some(isOn));
function selectShown() {
    emit("update:modelValue", [...new Set([...props.modelValue, ...shown.value.map((option) => option.value)])]);
}
function deselectShown() {
    const off = new Set(shown.value.map((option) => option.value));
    emit("update:modelValue", props.modelValue.filter((value) => !off.has(value)));
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
