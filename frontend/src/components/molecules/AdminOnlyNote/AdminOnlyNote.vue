<template>
    <p class="ah-admin-only" role="note" :data-test="`admin-only-${what}`">{{ sentence }}</p>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { adminNames } from "./adminNames";

defineOptions({ name: "AdminOnlyNote" });
const props = defineProps({ what: { type: String, required: true, validator: (value) => ["projects", "invite"].includes(value) } });

const { getters } = useStore();
const { t } = useI18n();

const names = computed(() => adminNames(getters["settings/companyUsers"], getters["users/users"]));
const asked = computed(() => {
    const [first, second] = names.value;
    if (!first) return t("AdminOnly.an_admin");
    return second ? t("AdminOnly.either", { first, second }) : first;
});
const sentence = computed(() => t(`AdminOnly.${props.what}`, { names: asked.value }));
</script>

<style scoped>
.ah-admin-only { margin: 0; padding: var(--sp-4, 8px) var(--sp-6, 12px); border: 1px solid var(--hairline); border-radius: var(--r-md); background: var(--surface-2); color: var(--ink-2); font: 400 var(--fs-sm)/1.4 var(--font-ui); }
</style>
