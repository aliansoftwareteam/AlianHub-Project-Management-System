<template>
    <section v-if="shown" class="gsm" :aria-label="$t('Goals.summary_title')" data-test="gsm">
        <template v-if="summary">
            <p class="gsm__text" data-test="gsm-text">{{ summary.text }}</p>
            <p class="gsm__meta" data-test="gsm-meta">
                <span>{{ $t('Goals.summary_from', { time: madeAt }) }}</span>
                <span v-if="summary.stale" class="gsm__behind" data-test="gsm-stale">{{ $t('Goals.summary_behind') }}</span>
            </p>
        </template>
        <p v-if="error" class="gsm__error" role="alert" data-test="gsm-error">{{ error }}</p>
        <button v-if="canAsk" type="button" class="ah-btn ah-btn--secondary ah-btn--sm gsm__ask" :disabled="busy" :aria-busy="busy ? 'true' : null" data-test="gsm-ask" @click="ask">
            {{ label }}
        </button>
    </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { aiUsable } from "@/composable/aiAvailability";
import { hourCycleOption } from "@/utils/clockText";

defineOptions({ name: "GoalSummary" });

const ERROR_KEYS = { ai_budget_exhausted: "Goals.summary_budget", budget_unavailable: "Goals.summary_budget_unavailable", ai_unavailable: "Goals.summary_unavailable" };

const props = defineProps({
    goal: { type: Object, required: true }
});

const store = useStore();
const { t, locale } = useI18n();
const busy = ref(false);
const error = ref("");

const summary = computed(() => props.goal.summary || null);
const canAsk = computed(() => aiUsable.value && props.goal.canEdit === true && !props.goal.archived && (!summary.value || summary.value.stale));
const shown = computed(() => Boolean(summary.value || canAsk.value || error.value));
const label = computed(() => t(busy.value ? "Goals.summarising" : summary.value ? "Goals.regenerate" : "Goals.summarise"));
const madeAt = computed(() => new Date(summary.value.madeAt).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "short", ...hourCycleOption() }));

/* The only way a summary is made: the model is never asked on open, on a poll or on a change from elsewhere. */
async function ask() {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
        await store.dispatch("goals/summarise", props.goal._id);
    } catch (refused) {
        error.value = t(ERROR_KEYS[refused.code] || "Goals.summary_failed");
    } finally {
        busy.value = false;
    }
}

watch(() => props.goal._id, () => { error.value = ""; });
</script>

<style scoped>
.gsm { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: var(--r-md, 6px); background: var(--surface); }
.gsm__text { margin: 0; font: var(--text-body); color: var(--ink); overflow-wrap: anywhere; }
.gsm__meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; font: var(--text-small); color: var(--ink-2); }
.gsm__behind { color: var(--ink); }
.gsm__error { margin: 0; font: var(--text-small); color: var(--ink); }
.gsm__ask { max-width: 100%; }
</style>
