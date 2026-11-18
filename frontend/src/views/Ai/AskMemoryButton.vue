<template>
    <button
        ref="opener"
        type="button"
        class="ah-btn ah-btn--ghost ah-btn--sm"
        aria-haspopup="dialog"
        :aria-expanded="open ? 'true' : 'false'"
        data-test="ask-memory-open"
        @click="open = true"
    >
        <ShellIcon name="user" :size="13" />{{ $t('AskMemory.open') }}
    </button>
    <AskMemoryDialog v-if="open" @close="close" />
</template>

<script setup>
import { nextTick, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AskMemoryDialog from "./AskMemoryDialog.vue";

defineOptions({ name: "AskMemoryButton" });

const open = ref(false);
const opener = ref(null);

const close = async () => {
    open.value = false;
    await nextTick();
    opener.value?.focus();
};
</script>
