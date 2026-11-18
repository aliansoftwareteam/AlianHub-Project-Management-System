<template>
    <span class="au-assign">
        <DropDown
            mode="listbox"
            multiselectable
            :title="$t('Automations.notify_recipients')"
            :maxHeight="'240px'"
            @isVisible="search = ''"
        >
            <template #button>
                <span class="au__slot au-assign__people" data-test="notify-recipients">{{ summary || $t('Automations.notify_pick_recipients') }}</span>
            </template>
            <template #search>
                <input
                    v-model="search"
                    type="text"
                    class="au-assign__search"
                    data-test="notify-search"
                    :placeholder="$t('Automations.notify_search')"
                    :aria-label="$t('Automations.notify_search')"
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
                <p v-if="!filtered.length" class="ah-small au-assign__empty">{{ $t('Automations.notify_no_people') }}</p>
            </template>
        </DropDown>

        <input
            type="text"
            class="au__slot au__slot--text au-notify__message"
            data-test="notify-message"
            :maxlength="MAX_MESSAGE"
            :value="message"
            :placeholder="$t('Automations.notify_message_placeholder')"
            :aria-label="$t('Automations.notify_message')"
            @input="setMessage($event.target.value, false)"
            @change="setMessage($event.target.value, true)"
        />

        <label class="au-assign__turns">
            <input type="checkbox" data-test="notify-include-actor" :checked="modelValue.includeActor === true" @change="setIncludeActor($event.target.checked)" />
            {{ $t('Automations.notify_include_actor') }}
        </label>
    </span>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

defineOptions({ name: 'NotifyActionEditor' });

const ROLES = ['task_assignees', 'task_creator', 'task_watchers'];
const MAX_MESSAGE = 500;

const props = defineProps({
    modelValue: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['update:modelValue', 'change']);

const { getters } = useStore();
const { t } = useI18n({ useScope: 'global' });
const search = ref('');

const chosen = computed(() => (Array.isArray(props.modelValue.recipients) ? props.modelValue.recipients.map(String) : []));
const message = computed(() => (typeof props.modelValue.message === 'string' ? props.modelValue.message : ''));

const members = computed(() => {
    const names = new Map((getters['users/users'] || []).map((u) => [String(u._id), u.Employee_Name]));
    return (getters['settings/companyUsers'] || [])
        .filter((seat) => seat && seat.isDelete === false && names.get(String(seat.userId)))
        .map((seat) => ({ id: String(seat.userId), label: names.get(String(seat.userId)) }))
        .sort((a, b) => a.label.localeCompare(b.label));
});

const everyone = computed(() => [...ROLES.map((role) => ({ id: role, label: t(`Automations.notify_role_${role}`) })), ...members.value]);
const filtered = computed(() => {
    const wanted = search.value.trim().toLowerCase();
    return wanted ? everyone.value.filter((p) => p.label.toLowerCase().includes(wanted)) : everyone.value;
});

const labelOf = (id) => everyone.value.find((p) => p.id === id)?.label || t('Automations.assign_unknown_person');
const summary = computed(() => chosen.value.map(labelOf).join(', '));
const isSelected = (id) => chosen.value.includes(id);

/* Typing updates the rule; only a finished edit asks the page to rewrite its sentence. */
const publish = (next, settled = true) => {
    const config = { recipients: next.recipients, message: next.message, ...(next.includeActor === true ? { includeActor: true } : {}) };
    emit('update:modelValue', config);
    if (settled) emit('change', config);
};

const current = () => ({ recipients: chosen.value, message: message.value, includeActor: props.modelValue.includeActor === true });
const toggle = (id) => publish({ ...current(), recipients: isSelected(id) ? chosen.value.filter((x) => x !== id) : [...chosen.value, id] });
const setMessage = (value, settled) => publish({ ...current(), message: String(value).slice(0, MAX_MESSAGE) }, settled);
const setIncludeActor = (on) => publish({ ...current(), includeActor: on });
</script>
