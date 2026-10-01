<template>
    <div v-if="canPreview" class="ah-card__body ms-variant" data-test="variant-preview">
        <div class="ms-variant__head">
            <div>
                <h2 id="ms-variant-label" class="ah-h3">{{ $t('Settings.variant_title') }}</h2>
                <div class="ah-small">{{ $t('Settings.variant_note') }}</div>
            </div>
            <button
                v-if="shellState.variant"
                type="button"
                class="ah-btn ah-btn--secondary ah-btn--sm"
                data-test="variant-off"
                @click="applyVariant('')"
            >{{ $t('Settings.variant_off') }}</button>
        </div>
        <div class="ms-variant__cards" role="radiogroup" aria-labelledby="ms-variant-label">
            <label
                v-for="opt in options"
                :key="opt.value"
                class="ms-variant__card"
                :class="{ 'is-active': shellState.variant === opt.value }"
            >
                <input
                    type="radio"
                    class="ah-check"
                    name="ah-variant"
                    :value="opt.value"
                    :checked="shellState.variant === opt.value"
                    @change="applyVariant(opt.value)"
                />
                <span class="ms-variant__text">
                    <span class="ms-variant__name">{{ $t(opt.label) }}</span>
                    <span class="ah-small">{{ $t(opt.hint) }}</span>
                </span>
            </label>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";
import { shellState, applyVariant } from "@/components/organisms/Shell/shellState.js";
import { isOwnerOrAdmin } from "@/utils/roles";

defineOptions({ name: "DesignVariantPicker" });

const { getters } = useStore();

const options = [
    { value: "a", label: "Settings.variant_a", hint: "Settings.variant_a_hint" },
    { value: "b", label: "Settings.variant_b", hint: "Settings.variant_b_hint" },
    { value: "c", label: "Settings.variant_c", hint: "Settings.variant_c_hint" }
];

const canPreview = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
</script>

<style>
.ms-variant { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--hairline); }
.ms-variant__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ms-variant__cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.ms-variant__card {
    display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px;
    border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); cursor: pointer;
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.ms-variant__card:hover { background: var(--surface-hover); }
.ms-variant__card.is-active { border-color: var(--brand); background: var(--brand-tint); }
.ms-variant__card .ah-check { margin-top: 2px; }
.ms-variant__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ms-variant__name { font: var(--text-h3); color: var(--ink); }

@media (max-width: 767px) {
    .ms-variant__cards { grid-template-columns: minmax(0, 1fr); }
    .ms-variant__card { min-height: 44px; }
}
</style>
