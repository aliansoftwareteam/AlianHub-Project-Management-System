<template>
    <section class="hc-next" data-test="home-next" :data-kind="next.kind" :data-count="next.count" :aria-labelledby="labelId">
        <span :id="labelId" class="hc-next__label">{{ $t('Home.next_label') }}</span>
        <p class="hc-next__line" data-test="home-next-line">{{ $t(`Home.next_${next.kind}`, { n: next.count }, next.count) }}</p>
        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm hc-next__act" @click="$emit('act', next.kind)">{{ $t(`Home.next_${next.kind}_action`) }}</button>
    </section>
</template>

<script setup>
import { useId } from "vue";

defineOptions({ name: "HomeWhatNext" });
defineProps({ next: { type: Object, required: true } });
defineEmits(["act"]);

const labelId = `hc-next-${useId()}`;
</script>

<style scoped>
.hc-next {
    display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-4, 8px) var(--sp-6, 12px); min-width: 0;
    padding: var(--card-pad-y, 14px) var(--card-pad-x, 16px);
    background: var(--surface); border: 1px solid var(--hairline); border-left: 3px solid var(--brand); border-radius: var(--r-lg, 12px);
}
.hc-next__label { flex: none; font: 600 var(--fs-xs, 10.5px)/var(--lh-tight, 1.2) var(--font-ui); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); }
.hc-next__line { flex: 1 1 220px; min-width: 0; margin: 0; font: var(--fw-title, 600) var(--fs-lg, 13.5px)/var(--lh-snug, 1.3) var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.hc-next__act { flex: none; }
@media (max-width: 767px) {
    .hc-next__label { flex-basis: 100%; }
    .hc-next__act { flex: 1 1 100%; min-height: 44px; }
}
</style>
