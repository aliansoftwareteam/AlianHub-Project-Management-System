<template>
    <kbd v-if="text" class="ah-kbd ah-kbd--hint" aria-hidden="true">{{ text }}</kbd>
</template>

<script setup>
import { computed, defineProps } from "vue";
import { useI18n } from "vue-i18n";
import { shortcutHint } from "@/composable/shortcuts";

defineOptions({ name: "KeyHint" });

const props = defineProps({
    shortcut: { type: String, required: true }
});

const { t } = useI18n();
const text = computed(() => shortcutHint(props.shortcut, t));
</script>
