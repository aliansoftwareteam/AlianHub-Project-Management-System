<template>
    <div class="member-row">
        <span class="member-row__person">
            <span class="ah-avatar">{{ person.name.slice(0, 1).toUpperCase() }}</span>
            <span class="member-row__who">
                <strong class="member-row__name" :title="person.name">{{ person.name }}</strong>
                <span class="member-row__mail" :title="person.email">{{ person.email }}</span>
            </span>
        </span>
        <span class="member-row__role">{{ $t(roleKeys.role) }}</span>
        <span class="member-row__access">{{ $t(roleKeys.access) }}</span>
        <span class="member-row__active ah-mono">{{ person.status }}</span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { teammateRoleKeys } from "./teammateRoles";

defineOptions({ name: "PersonMemberRow" });

const props = defineProps({
    person: { type: Object, required: true }
});

const roleKeys = computed(() => teammateRoleKeys(props.person.roleType));
</script>

<style>
@import "./parity.css";
</style>
