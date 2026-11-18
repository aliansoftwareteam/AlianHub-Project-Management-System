<template>
    <div class="ah-card__body ms-navmode" data-test="nav-mode">
        <div>
            <h2 id="ms-navmode-label" class="ah-h3">{{ $t('Settings.nav_mode') }}</h2>
            <div class="ah-small">{{ $t('Settings.nav_mode_hint') }}</div>
        </div>
        <div class="ms-navmode__cards" role="radiogroup" aria-labelledby="ms-navmode-label">
            <label
                v-for="opt in options"
                :key="opt.value"
                class="ms-navmode__card"
                :class="{ 'is-active': mode === opt.value }"
            >
                <input
                    type="radio"
                    class="ah-check"
                    name="ah-nav-mode"
                    :value="opt.value"
                    :checked="mode === opt.value"
                    :data-nav-mode="opt.value"
                    @change="pick(opt.value)"
                />
                <span class="ms-navmode__text">
                    <span class="ms-navmode__name">{{ $t(opt.label) }}</span>
                    <span class="ah-small">{{ $t(opt.hint) }}</span>
                </span>
            </label>
        </div>
        <div v-if="failed" class="ah-field__error" role="alert" data-test="nav-mode-error">{{ $t('Settings.nav_mode_failed') }}</div>
    </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { shellState, applyNavMode } from "@/components/organisms/Shell/shellState.js";
import { navModeOf } from "@/components/organisms/Shell/navMode.js";

defineOptions({ name: "NavModePicker" });

const options = [
    { value: "simple", label: "Settings.nav_mode_simple", hint: "Settings.nav_mode_simple_hint" },
    { value: "full", label: "Settings.nav_mode_full", hint: "Settings.nav_mode_full_hint" }
];

const mode = computed(() => navModeOf(shellState.nav?.mode));
const failed = ref(false);

async function pick(value) {
    failed.value = false;
    failed.value = !(await applyNavMode(value));
}
</script>

<style>
.ms-navmode { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--hairline); }
.ms-navmode__cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ms-navmode__card {
    display: flex; align-items: flex-start; gap: 10px; margin: 0; padding: 12px;
    border: 1px solid var(--border); border-radius: var(--r-input); background: var(--surface); cursor: pointer;
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.ms-navmode__card:hover { background: var(--surface-hover); }
.ms-navmode__card.is-active { border-color: var(--brand); background: var(--brand-tint); }
.ms-navmode__card .ah-check { margin-top: 2px; }
.ms-navmode__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ms-navmode__name { font: var(--text-h3); color: var(--ink); }

@media (max-width: 767px) {
    .ms-navmode__cards { grid-template-columns: minmax(0, 1fr); }
    .ms-navmode__card { min-height: 44px; }
}
</style>
