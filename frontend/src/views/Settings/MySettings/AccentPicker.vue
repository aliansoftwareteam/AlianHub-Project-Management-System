<template>
    <div class="ah-card__body ms-accent" data-test="accent">
        <div class="ms-accent__text">
            <h2 id="ms-accent-label" class="ah-h3">{{ $t('Settings.accent') }}</h2>
            <div class="ah-small">{{ highContrast ? $t('Settings.accent_high_contrast') : $t('Settings.accent_hint') }}</div>
        </div>
        <div class="ms-accent__swatches" role="radiogroup" aria-labelledby="ms-accent-label">
            <label
                v-for="opt in options"
                :key="opt.value"
                class="ms-accent__swatch"
                :data-accent-swatch="opt.value"
                :title="$t(opt.label)"
            >
                <input
                    type="radio"
                    class="ms-accent__input"
                    name="ah-accent"
                    :value="opt.value"
                    :checked="shellState.accent === opt.value"
                    :aria-label="$t(opt.label)"
                    @change="applyAccent(opt.value)"
                />
                <span class="ms-accent__dot" aria-hidden="true"></span>
            </label>
        </div>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { shellState, applyAccent, resolveContrast } from "@/components/organisms/Shell/shellState.js";
import { ACCENT_CHOICES } from "@/components/organisms/Shell/accents.js";

defineOptions({ name: "AccentPicker" });

const LABEL = {
    indigo: "Settings.accent_indigo",
    blue: "Settings.accent_blue",
    purple: "Settings.accent_purple",
    teal: "Settings.accent_teal",
    green: "Settings.accent_green",
    orange: "Settings.accent_orange",
    pink: "Settings.accent_pink"
};
const options = ACCENT_CHOICES.map((value) => ({ value, label: LABEL[value] }));

const highContrast = computed(() => resolveContrast(shellState.contrast) === "high");
</script>

<style>
.ms-accent { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--hairline); }
.ms-accent__text { flex: 1; min-width: 200px; }
.ms-accent__swatches { display: flex; flex-wrap: wrap; gap: 4px; }
.ms-accent__swatch {
    position: relative; display: inline-grid; place-items: center; margin: 0; cursor: pointer;
    width: max(28px, var(--hit-min, 24px)); height: max(28px, var(--hit-min, 24px));
}
.ms-accent__input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.ms-accent__dot {
    display: grid; place-content: center; width: 20px; height: 20px; border-radius: 50%;
    background: var(--brand);
    transition: box-shadow var(--motion-fast) var(--ease-out);
}
.ms-accent__input:checked + .ms-accent__dot { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--brand); }
.ms-accent__input:checked + .ms-accent__dot::after {
    content: ""; width: 9px; height: 5px;
    border: 2px solid var(--on-brand); border-top: 0; border-right: 0;
    transform: rotate(-45deg) translate(1px, -1px);
}
.ms-accent__input:focus-visible + .ms-accent__dot { outline: 2px solid var(--ink); outline-offset: 5px; }
</style>
