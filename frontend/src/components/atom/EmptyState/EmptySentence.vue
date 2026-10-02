<template>
    <p v-if="canCopy || canAsk" class="empty-say" data-test="empty-say">
        <span class="empty-say__label">{{ $t('EmptyState.say_label') }}</span>
        <q class="empty-say__sentence" data-test="empty-say-sentence">{{ sentence }}</q>
        <button v-if="canCopy" type="button" class="empty-say__act" data-test="empty-say-copy" @click="copy">{{ copied ? $t('EmptyState.say_copied') : $t('EmptyState.say_copy') }}</button>
        <button v-if="canAsk" type="button" class="empty-say__act" data-test="empty-say-ask" @click="ask">{{ $t('EmptyState.say_ask') }}</button>
    </p>
</template>

<script setup>
import { computed, getCurrentInstance, inject, onMounted, ref, unref } from 'vue';
import { AI_STATE, aiAvailability, aiReachable } from '@/composable/aiAvailability';
import { aiConnection, loadAiConnection } from '@/composable/aiConnection';

defineOptions({ name: 'EmptySentence' });

const props = defineProps({ sentence: { type: String, required: true } });

const COPIED_MS = 1600;
const ASK_ROUTE = 'AiAsk';

// Read off the app rather than imported, so a screen whose spec replaces vue-router still mounts.
const router = getCurrentInstance()?.appContext.config.globalProperties.$router;
const companyId = inject('$companyId', '');
const copied = ref(false);

const canCopy = computed(() => aiReachable.value && aiConnection.connected === true);
/* Ask only writes the sentence into the question box; the person sends it. */
const canAsk = computed(() => aiAvailability.state === AI_STATE.ON && aiAvailability.planAllowsAi !== false && Boolean(router?.hasRoute(ASK_ROUTE)));

async function copy() {
    try {
        await navigator.clipboard.writeText(props.sentence);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, COPIED_MS);
    } catch (error) {
        copied.value = false;
    }
}

const ask = () => router.push({ name: ASK_ROUTE, params: { cid: unref(companyId) }, query: { q: props.sentence } }).catch(() => {});

onMounted(() => {
    const cid = unref(companyId);
    if (aiReachable.value && !(aiConnection.loaded && aiConnection.companyId === cid)) loadAiConnection(cid);
});
</script>

<style scoped>
.empty-say {
    display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: var(--sp-2, 4px) var(--sp-4, 8px);
    max-width: 520px; margin: var(--sp-5, 10px) 0 0; font: var(--text-small); color: var(--ink-2);
}
.empty-say__sentence { color: var(--ink); overflow-wrap: anywhere; }
.empty-say__act {
    display: inline-flex; align-items: center; min-height: var(--hit-min, 24px); padding: 0 var(--sp-2, 4px);
    border: 0; border-radius: var(--r-chip); background: transparent; color: var(--brand); font: inherit; font-weight: 600; cursor: pointer;
}
.empty-say__act:hover { text-decoration: underline; }
.empty-say__act:focus-visible { outline: none; box-shadow: var(--focus); }
@media (max-width: 767px) {
    .empty-say__act { min-height: 44px; }
}
</style>
