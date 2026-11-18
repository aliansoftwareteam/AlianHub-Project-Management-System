<template>
    <span class="au-assign">
        <select :value="mode" class="au__slot" data-test="assign-mode" :aria-label="$t('Automations.assign_mode')" @change="setMode($event.target.value)">
            <option v-for="m in MODES" :key="m" :value="m">{{ $t(`Automations.assign_mode_${m}`) }}</option>
        </select>

        <DropDown
            v-if="mode !== 'clear'"
            mode="listbox"
            multiselectable
            :title="$t('Automations.assign_people')"
            :maxHeight="'240px'"
            @isVisible="search = ''"
        >
            <template #button>
                <span class="au__slot au-assign__people" data-test="assign-people">{{ summary || $t('Automations.assign_pick_people') }}</span>
            </template>
            <template #search>
                <input
                    v-model="search"
                    type="text"
                    class="au-assign__search"
                    data-test="assign-search"
                    :placeholder="$t('Automations.assign_search')"
                    :aria-label="$t('Automations.assign_search')"
                    @click.stop
                />
            </template>
            <template #options>
                <DropDownOption v-for="person in filtered" :key="person.id" :selected="isSelected(person.id)" @click="toggle(person.id)">
                    <span class="au-assign__option">
                        <input type="checkbox" tabindex="-1" aria-hidden="true" :checked="isSelected(person.id)" />
                        <span>{{ person.label }}</span>
                    </span>
                </DropDownOption>
                <p v-if="!filtered.length" class="ah-small au-assign__empty">{{ $t('Automations.assign_no_people') }}</p>
            </template>
        </DropDown>

        <label v-if="canRotate" class="au-assign__turns">
            <input type="checkbox" data-test="assign-round-robin" :checked="modelValue.roundRobin === true" @change="setRoundRobin($event.target.checked)" />
            {{ $t('Automations.assign_round_robin') }}
        </label>
    </span>
</template>

<script setup>
import { computed, defineEmits, defineProps, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

defineOptions({ name: 'AssignActionEditor' });

const MODES = ['add', 'replace', 'remove', 'clear'];
const ROTATING = ['add', 'replace'];
const TASK_CREATOR = 'task_creator';
const FORM_SUBMITTER = 'form_submitter';

const props = defineProps({
    modelValue: { type: Object, default: () => ({}) },
    trigger: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue', 'change']);

const { getters } = useStore();
const { t } = useI18n({ useScope: 'global' });
const search = ref('');

const mode = computed(() => (MODES.includes(props.modelValue.mode) ? props.modelValue.mode : 'add'));
const chosen = computed(() => (Array.isArray(props.modelValue.userIds) ? props.modelValue.userIds.map(String) : []));

const members = computed(() => {
    const names = new Map((getters['users/users'] || []).map((u) => [String(u._id), u.Employee_Name]));
    return (getters['settings/companyUsers'] || [])
        .filter((seat) => seat && seat.isDelete === false && names.get(String(seat.userId)))
        .map((seat) => ({ id: String(seat.userId), label: names.get(String(seat.userId)) }))
        .sort((a, b) => a.label.localeCompare(b.label));
});

const roles = computed(() => [
    { id: TASK_CREATOR, label: t('Automations.assign_task_creator') },
    ...(props.trigger === 'form.submitted' ? [{ id: FORM_SUBMITTER, label: t('Automations.assign_form_submitter') }] : []),
]);

const everyone = computed(() => [...roles.value, ...members.value]);
const filtered = computed(() => {
    const wanted = search.value.trim().toLowerCase();
    return wanted ? everyone.value.filter((p) => p.label.toLowerCase().includes(wanted)) : everyone.value;
});

const labelOf = (id) => everyone.value.find((p) => p.id === id)?.label || t('Automations.assign_unknown_person');
const summary = computed(() => chosen.value.map(labelOf).join(', '));
const canRotate = computed(() => ROTATING.includes(mode.value) && chosen.value.length >= 2);
const isSelected = (id) => chosen.value.includes(id);

/* Round robin is kept only while it can apply, so a saved rule never carries a turn it cannot take. */
const publish = (next) => {
    const rotates = next.roundRobin === true && ROTATING.includes(next.mode) && next.userIds.length >= 2;
    const config = { mode: next.mode, userIds: next.userIds, ...(rotates ? { roundRobin: true } : {}) };
    emit('update:modelValue', config);
    emit('change', config);
};

const setMode = (value) => publish({ ...props.modelValue, mode: value, userIds: value === 'clear' ? [] : chosen.value });
const toggle = (id) => publish({
    ...props.modelValue,
    mode: mode.value,
    userIds: isSelected(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id],
});
const setRoundRobin = (on) => publish({ ...props.modelValue, mode: mode.value, userIds: chosen.value, roundRobin: on });
</script>
