<template>
    <span class="apv">
        <template v-if="kind === 'options'">
            <span v-for="option in choices" :key="option.id" class="apv__chip" data-ai-chip :style="chipStyle(option)">{{ option.label || option.value }}</span>
        </template>
        <span
            v-else-if="kind === 'rating'"
            class="apv__rating"
            data-ai-rating
            role="img"
            :aria-label="$t('AiFields.rating_value', { n: rating, max: RATING_MAX })"
        >{{ stars }}</span>
        <span v-else-if="kind === 'date'" data-ai-date>{{ dateText }}</span>
        <span v-else class="apv__text">{{ proposal.text }}</span>
    </span>
</template>

<script setup>
import { computed, inject, ref } from "vue";
import moment from "moment";
import { RATING_MAX, aiOutputOf } from "@/views/Projects/composables/aiFields";
import { dropdownChoices } from "@/views/Projects/composables/projectCustomFields";

defineOptions({ name: "AiProposalValue" });

const props = defineProps({
    field: { type: Object, required: true },
    proposal: { type: Object, required: true }
});

const dateFormat = inject("$dateFormat", ref("DD/MM/YYYY"));

const KINDS = { dropdown: "options", labels: "options", rating: "rating", date: "date" };

const kind = computed(() => KINDS[aiOutputOf(props.field)] || "text");
const choices = computed(() => dropdownChoices(props.field, props.proposal.fieldValue));
const rating = computed(() => Math.min(Math.max(Math.round(Number(props.proposal.fieldValue) || 0), 0), RATING_MAX));
const stars = computed(() => "★".repeat(rating.value) + "☆".repeat(RATING_MAX - rating.value));

const dateText = computed(() => {
    const day = moment(props.proposal.text, "YYYY-MM-DD", true);
    return day.isValid() ? day.format(dateFormat.value) : props.proposal.text;
});

const chipStyle = (option) => (option.color ? { color: option.color, backgroundColor: `${option.color}20` } : {});
</script>

<style scoped>
.apv { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.apv__chip { padding: 1px 8px; border-radius: 999px; font-size: 11.5px; background: var(--surface-hover); color: var(--ink); }
.apv__rating { color: var(--warn); letter-spacing: 1px; font-size: 14px; }
.apv__text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
