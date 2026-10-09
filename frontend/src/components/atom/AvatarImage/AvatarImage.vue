<template>
    <img v-if="resolved" v-bind="$attrs" :src="resolved" :alt="alt" @error="failed = true" />
    <slot v-else />
</template>

<script setup>
import { inject, ref, watch } from "vue";
import { isStoredProfilePath, signedProfileUrl } from "@/composable/useSignedProfileUrl";

defineOptions({ name: "AvatarImage", inheritAttrs: false });

const props = defineProps({
    src: { type: String, default: "" },
    alt: { type: String, default: "" }
});

const companyId = inject("$companyId", null);
const resolved = ref("");
const failed = ref(false);
let request = 0;

watch(() => props.src, (src) => {
    const run = ++request;
    failed.value = false;
    if (!isStoredProfilePath(src)) {
        resolved.value = src;
        return;
    }
    resolved.value = "";
    signedProfileUrl(src, companyId?.value || "")
        .then((url) => { if (run === request) resolved.value = url; })
        .catch(() => {});
}, { immediate: true });

watch(failed, (isFailed) => { if (isFailed) resolved.value = ""; });
</script>
