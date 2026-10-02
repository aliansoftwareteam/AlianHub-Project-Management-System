<template>
    <div v-if="canPreview" class="ah-card__body ms-variant" data-test="variant-preview">
        <div class="ms-variant__head">
            <div>
                <h2 id="ms-variant-label" class="ah-h3">{{ $t('Settings.look_title') }}</h2>
                <div class="ah-small">{{ $t('Settings.look_note') }}</div>
            </div>
            <button
                v-if="active !== DEFAULT_VARIANT"
                type="button"
                class="ah-btn ah-btn--secondary ah-btn--sm"
                data-test="variant-off"
                @click="applyVariant('')"
            >{{ $t('Settings.variant_default') }}</button>
        </div>
        <div class="ms-variant__cards" role="radiogroup" aria-labelledby="ms-variant-label">
            <label
                v-for="opt in options"
                :key="opt.value"
                class="ms-variant__card"
                :class="{ 'is-active': active === opt.value }"
            >
                <input
                    type="radio"
                    class="ah-check"
                    name="ah-variant"
                    :value="opt.value"
                    :checked="active === opt.value"
                    @change="pick(opt.value)"
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
import { DEFAULT_VARIANT, lookOf } from "@/components/organisms/Shell/looks.js";
import { isOwnerOrAdmin } from "@/utils/roles";

defineOptions({ name: "DesignVariantPicker" });

const { getters } = useStore();

const options = [
    { value: "b", label: "Settings.variant_dense", hint: "Settings.variant_b_hint" },
    { value: "a", label: "Settings.variant_regular", hint: "Settings.variant_regular_hint" },
    { value: "c", label: "Settings.variant_c", hint: "Settings.variant_c_hint" },
    { value: "classic", label: "Settings.variant_classic", hint: "Settings.variant_classic_hint" }
];

const active = computed(() => lookOf(shellState.variant));
/* Picking the default stores nothing, so this browser keeps following whatever the default is. */
const pick = (value) => applyVariant(value === DEFAULT_VARIANT ? "" : value);

const canPreview = computed(() => isOwnerOrAdmin(Number(getters["settings/companyUserDetail"]?.roleType)));
</script>

<style>
.ms-variant { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--hairline); }
.ms-variant__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ms-variant__cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
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
