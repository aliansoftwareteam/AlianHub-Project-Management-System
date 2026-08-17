<!-- =========================================================================================
    Comment : Where a project came from — 'upwork' | 'fiverr' | 'other'. Stored as a
    slug; the label is translated at render time.

    Two modes so each context keeps its own conventions: `inline` mirrors the
    ProjectType / BillingPeriod rows in the details sidebar (text that opens the
    searchable Sidebar), `field` uses the same DropDown + bordered trigger as
    SkillsSelect so the two sit identically in the create forms.
========================================================================================== -->
<template>
    <div class="source-select">
        <template v-if="mode === 'inline'">
            <span
                class="black project-type-name text-ellipsis"
                :class="[{'font-size-13 font-weight-400': clientWidth > 767, 'font-size-16': clientWidth <= 767}, editable ? 'cursor-pointer' : 'cursor-default']"
                :title="label"
                @click="editable ? isVisible = true : null">{{ label }}</span>
            <Sidebar
                v-if="editable"
                v-model:visible="isVisible"
                :title="$t('Projects.select_source')"
                :enable-search="false"
                :options="options.map((o) => ({label: o.label, value: o.value}))"
                :listenKeys="true"
                @selected="onSidebarSelected"
            />
        </template>
        <DropDown
            v-else-if="editable"
            :maxHeight="'200px'"
            :bodyClassHeader="{'w-100': true}"
            :title="$t('Projects.select_source')">
            <template #button>
                <div class="source-select__field d-flex align-items-center">
                    <span v-if="selectedOption" class="source-select__value text-ellipsis">{{ selectedOption.label }}</span>
                    <span v-else class="source-select__placeholder">{{ $t('Projects.select_source') }}</span>
                </div>
            </template>
            <template #options>
                <div v-for="option in options" :key="option.value"
                    class="source-select__option d-flex align-items-center cursor-pointer"
                    :class="{'source-select__option--active': option.value === modelValue}"
                    @click.stop="pick(option.value)">
                    <span class="text-ellipsis">{{ option.label }}</span>
                </div>
            </template>
        </DropDown>
        <div v-else class="source-select__field d-flex align-items-center">
            <span class="source-select__value text-ellipsis">{{ label }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, inject, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import { PROJECT_SOURCES } from '@/utils/projectSource';

const { t } = useI18n();
const clientWidth = inject('$clientWidth');

const props = defineProps({
    modelValue: {
        type: String,
        default: ''
    },
    editable: {
        type: Boolean,
        default: true
    },
    mode: {
        type: String,
        default: 'field'
    }
});

const emit = defineEmits(['update:modelValue', 'changed']);

const isVisible = ref(false);
const options = computed(() => PROJECT_SOURCES.map((value) => ({ value, label: t(`Projects.source_${value}`) })));
const selectedOption = computed(() => options.value.find((o) => o.value === props.modelValue) || null);
const label = computed(() => (selectedOption.value ? selectedOption.value.label : t('Projects.select_source')));

const pick = (value) => {
    if (!value || value === props.modelValue) return;
    emit('update:modelValue', value);
    emit('changed', value);
};

// The Sidebar hands back the whole option; match on value, falling back to the
// rendered label.
const onSidebarSelected = (option) => {
    const picked = options.value.find((o) => o.value === (option && option.value))
        || options.value.find((o) => o.label === (option && option.label));
    if (picked) pick(picked.value);
    isVisible.value = false;
};
</script>

<style scoped>
/* Same chrome as SkillsSelect's bordered trigger, so Source and Skills are
   indistinguishable as form fields. */
.source-select__field {
    border: 1px solid #DFE1E6;
    border-radius: 6px;
    height: 30px;
    padding: 0 10px;
    box-sizing: border-box;
    background: #ffffff;
    cursor: pointer;
    width: 100%;
}
.source-select__value {
    font-size: 13px;
    color: #535358;
}
.source-select__placeholder {
    font-size: 13px;
    color: #818181;
}
.source-select__option {
    padding: 6px 4px;
    font-size: 13px;
    color: #535358;
}
.source-select__option--active {
    color: #2F3990;
    font-weight: 500;
}
</style>
