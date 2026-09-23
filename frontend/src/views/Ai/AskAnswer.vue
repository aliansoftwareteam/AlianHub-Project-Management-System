<template>
    <section class="ah-card">
        <div class="ah-card__head">
            <span class="ah-h3">{{ answer.mode === 'research' ? $t('Parity.report') : $t('Parity.answer') }}</span>
            <span v-if="answer.usage" class="parity-count">{{ answer.usage.model }}</span>
        </div>
        <div class="ah-card__body">
            <div class="ask__answer">{{ answer.answer }}</div>
            <div v-if="cited.length" class="ask__cites">
                <div class="ah-label">{{ $t('Parity.cited') }}</div>
                <div v-for="source in cited" :key="source.ref" class="ask__cite">
                    <router-link v-if="linkOf(source)" :to="linkOf(source)" class="ask__cite-ref">{{ source.ref }}</router-link>
                    <span v-else class="ask__cite-ref">{{ source.ref }}</span>
                    <span>{{ source.title }}<span v-if="source.project" class="ah-muted"> · {{ source.project }}</span></span>
                </div>
            </div>
            <div class="ask__why">
                <button
                    ref="opener"
                    type="button"
                    class="ah-btn ah-btn--secondary ah-btn--sm"
                    aria-haspopup="dialog"
                    :aria-expanded="open ? 'true' : 'false'"
                    data-test="why-open"
                    @click="open = true"
                >
                    <ShellIcon name="shield" :size="13" />{{ $t('Ask.why_open') }}
                </button>
            </div>
        </div>
        <AskWhyPanel v-if="open" :sources="sources" :cited="cited.map((source) => source.ref)" :privileged="privileged" @close="close" />
    </section>
</template>

<script setup>
import { computed, inject, nextTick, ref, unref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AskWhyPanel from "./AskWhyPanel.vue";
import { sourceLink } from "./askWhy";

defineOptions({ name: "AskAnswer" });

const props = defineProps({ answer: { type: Object, required: true } });

const companyId = inject("$companyId", "");
const linkOf = (source) => sourceLink(source, unref(companyId));

const open = ref(false);
const opener = ref(null);

const sources = computed(() => (Array.isArray(props.answer.sources) ? props.answer.sources.filter(Boolean) : []));
const privileged = computed(() => Boolean(props.answer.scope && props.answer.scope.privileged));

const cited = computed(() => {
    const retrieved = new Set(sources.value.map((source) => source.ref).filter(Boolean));
    return (props.answer.cited || []).filter((source) => source && retrieved.has(source.ref));
});

const close = async () => {
    open.value = false;
    await nextTick();
    if (opener.value) opener.value.focus();
};
</script>

<style>
.ask__why { display: flex; margin-top: 12px; }
</style>
