<!-- =========================================================================================
    Comment : Multi-select for a project's required skills. v-model is an array of
    skill SLUGS (see Modules/settings/ProjectSkills) — never names or keys — so the
    value survives a rename and joins straight to reporting.

    Used by the project details panel, the create-project forms and the AI wizard,
    so it renders read-only when the caller has no edit rights and stays silent
    when the company has no skills configured yet.
========================================================================================== -->
<template>
    <div class="skills-select">
        <DropDown
            v-if="editable"
            :maxHeight="'240px'"
            :bodyClass="{'skills-select__menu': true}"
            :bodyClassHeader="{'w-100': true}"
            :title="$t('ProjectDetails.skills')"
            @isVisible="onVisibilityChange">
            <template #button>
                <div class="skills-select__chips d-flex align-items-center" :class="{'skills-select__chips--field': bordered, 'skills-select__chips--wrap': showAll}">
                    <span v-for="skill in visible" :key="skill.slug" class="skills-select__chip text-ellipsis" :title="skill.name">
                        {{ skill.name }}
                    </span>
                    <span v-if="hiddenCount" class="skills-select__chip skills-select__chip--count" :title="hiddenNames">
                        +{{ hiddenCount }}
                    </span>
                    <span v-if="!selected.length" class="skills-select__placeholder">{{ $t('PlaceHolder.Select_Skills') }}</span>
                </div>
            </template>
            <template #options>
                <div v-for="skill in options" :key="skill.slug"
                    class="skills-select__option d-flex align-items-center cursor-pointer"
                    :class="{'skills-select__option--disabled': !isSelected(skill.slug) && atLimit}"
                    @click.stop="toggle(skill.slug)">
                    <input type="checkbox" class="cursor-pointer" :checked="isSelected(skill.slug)"
                        :disabled="!isSelected(skill.slug) && atLimit"/>
                    <span class="skills-select__option-name text-ellipsis" :title="skill.slug">{{ skill.name }}</span>
                </div>
                <div v-if="!options.length" class="skills-select__empty font-size-12">{{ $t('ProjectDetails.no_skills_configured') }}</div>
                <div v-if="atLimit" class="skills-select__empty font-size-12">{{ $t('ProjectDetails.skills_limit', {count: maxSkills}) }}</div>
            </template>
        </DropDown>
        <div v-else class="skills-select__chips d-flex align-items-center" :class="{'skills-select__chips--field': bordered, 'skills-select__chips--wrap': showAll}">
            <span v-for="skill in visible" :key="skill.slug" class="skills-select__chip text-ellipsis" :title="skill.name">
                {{ skill.name }}
            </span>
            <span v-if="hiddenCount" class="skills-select__chip skills-select__chip--count" :title="hiddenNames">
                +{{ hiddenCount }}
            </span>
            <span v-if="!selected.length" class="skills-select__placeholder">{{ $t('ProjectDetails.no_skills') }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';

// Mirrors MAX_SKILLS_PER_PROJECT in skillRules.js; the server enforces it.
const maxSkills = 15;

const props = defineProps({
    modelValue: {
        type: Array,
        default: () => ([])
    },
    editable: {
        type: Boolean,
        default: true
    },
    // Chips shown before collapsing the rest into "+N".
    maxVisible: {
        type: Number,
        default: 2
    },
    // Input-shaped field for forms. The chrome sits on the chips row so the
    // whole box is the hit area; off in the borderless details sidebar.
    bordered: {
        type: Boolean,
        default: false
    },
    // Wrap and grow instead of collapsing to "+N". Ignores `maxVisible`, and
    // needs a surrounding row that can grow (the details sidebar can't).
    showAll: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue', 'changed']);
const { getters } = useStore();

// Ticks edit a local draft; the parent is told once, on close — one request per
// finalisation instead of one per skill.
const draft = ref([...props.modelValue]);
const isOpen = ref(false);

const sameSlugs = (a, b) => a.length === b.length && a.every((slug, i) => slug === b[i]);

// Callers bind `:modelValue="project.skills || []"`, a new array identity every
// re-render. Reset on content change only, never mid-edit.
watch(() => props.modelValue, (val) => {
    const next = [...(val || [])];
    if (isOpen.value || sameSlugs(next, draft.value)) return;
    draft.value = next;
}, { deep: true });

const onVisibilityChange = (open) => {
    isOpen.value = open;
    if (open) {
        // Fresh snapshot, so an abandoned edit doesn't leak into the next one.
        draft.value = [...(props.modelValue || [])];
        return;
    }
    if (sameSlugs(draft.value, props.modelValue || [])) return;
    emit('update:modelValue', draft.value);
    emit('changed', draft.value);
};

const allSkills = computed(() => getters['settings/projectSkills']);
// Active skills, plus already-tagged ones since deactivated so they stay removable.
const options = computed(() => {
    const active = allSkills.value.filter((s) => s.active !== false);
    const staleTagged = allSkills.value.filter((s) => s.active === false && draft.value.includes(s.slug));
    return [...active, ...staleTagged];
});

// Slugs to display names, keeping the project's ordering. Unmatched slugs show as-is.
const selected = computed(() => draft.value.map((slug) => {
    const match = allSkills.value.find((s) => s.slug === slug);
    return { slug, name: match ? match.name : slug };
}));

const visible = computed(() => (props.showAll ? selected.value : selected.value.slice(0, props.maxVisible)));
const hiddenCount = computed(() => (props.showAll ? 0 : Math.max(0, selected.value.length - props.maxVisible)));
const hiddenNames = computed(() => selected.value.slice(props.maxVisible).map((s) => s.name).join(', '));

const atLimit = computed(() => draft.value.length >= maxSkills);
const isSelected = (slug) => draft.value.includes(slug);

const toggle = (slug) => {
    const next = isSelected(slug)
        ? draft.value.filter((s) => s !== slug)
        : [...draft.value, slug];
    if (next.length > maxSkills) return;
    draft.value = next;
};
</script>

<style scoped>
.skills-select__chips {
    gap: 4px;
    min-height: 24px;
    /* Never wrap: a second line would overlap the fields below. */
    flex-wrap: nowrap;
    overflow: hidden;
    max-width: 100%;
}
.skills-select__chip {
    background: #EEF0FB;
    color: #2F3990;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 12px;
    max-width: 110px;
    flex: 0 1 auto;
    white-space: nowrap;
}
.skills-select__chip--count {
    flex: 0 0 auto;     /* the count is never what gets squeezed out */
    max-width: none;
}
/* Matches the sibling .form-control inputs in the create-project form. */
.skills-select__chips--field {
    border: 1px solid #DFE1E6;
    border-radius: 6px;
    height: 30px;
    padding: 0 10px;
    box-sizing: border-box;
    background: #ffffff;
    cursor: pointer;
}
.skills-select__chips--field:hover {
    border-color: #B3B9C4;
}
/* Must come after --field so height: auto beats its fixed height. */
.skills-select__chips--wrap {
    flex-wrap: wrap;
    overflow: visible;
    height: auto;
    row-gap: 4px;
}
.skills-select__chips--wrap.skills-select__chips--field {
    min-height: 30px;   /* empty state still matches a single-line input */
    padding: 3px 10px;
}
.skills-select__chips--wrap .skills-select__chip {
    max-width: 100%;
}
.skills-select__placeholder {
    color: #818181;
    font-size: 13px;
}
.skills-select__option {
    gap: 8px;
    padding: 6px 4px;
}
.skills-select__option--disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.skills-select__option-name {
    font-size: 13px;
    max-width: 220px;
}
.skills-select__empty {
    color: #818181;
    padding: 6px 4px;
}
</style>
