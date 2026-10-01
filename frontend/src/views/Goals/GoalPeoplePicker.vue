<template>
    <div class="gpp">
        <input
            v-if="people.length > SEARCH_FROM"
            v-model="needle"
            type="search"
            class="ah-input gpp__search"
            :placeholder="$t('Goals.people_search')"
            :aria-label="$t('Goals.people_search')"
            data-test="glp-people-search"
        />
        <ul class="gpp__list ah-scroll" role="group" :aria-label="$t('Goals.people_label')">
            <li v-for="person in shown" :key="person.id">
                <label class="gpp__person" data-test="glp-person" :data-user="person.id">
                    <input type="checkbox" class="ah-check" :checked="modelValue.includes(person.id)" @change="toggle(person.id, $event.target.checked)" />
                    <span class="ah-avatar ah-avatar--sm" aria-hidden="true">
                        <img v-if="person.image" :src="person.image" alt="" />
                        <template v-else>{{ person.initial }}</template>
                    </span>
                    <span class="gpp__name">{{ person.name }}</span>
                    <span v-if="person.guest" class="ah-chip ah-chip--sm">{{ $t('Goals.guest') }}</span>
                </label>
            </li>
            <li v-if="!shown.length" class="gpp__none">{{ $t('Goals.people_none') }}</li>
        </ul>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";

defineOptions({ name: "GoalPeoplePicker" });

const SEARCH_FROM = 8;

const props = defineProps({
    people: { type: Array, default: () => [] },
    modelValue: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);

const needle = ref("");
const shown = computed(() => {
    const text = needle.value.trim().toLowerCase();
    return text ? props.people.filter((person) => person.name.toLowerCase().includes(text)) : props.people;
});

function toggle(id, on) {
    const others = props.modelValue.filter((entry) => entry !== id);
    emit("update:modelValue", on ? [...others, id] : others);
}
</script>
