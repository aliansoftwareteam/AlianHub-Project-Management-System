<template>
    <div v-if="variant === 'select'" class="pv-filter__anchor" @click.stop>
        <button type="button" class="pv-filter__btn" :aria-expanded="open" aria-haspopup="menu" @click="open = !open">
            {{ $t('ProvenanceV2.done_by', { value: $t(`ProvenanceV2.opt_${selection}`) }) }}
            <ShellIcon name="chevronDown" :size="12" />
        </button>
        <transition name="ah-fade">
            <div v-if="open" class="ah-pop" role="menu">
                <div class="ah-pop__label ah-label">{{ $t('ProvenanceV2.filter_label') }}</div>
                <button
                    v-for="option in options"
                    :key="option"
                    type="button"
                    class="ah-pop__item"
                    :class="{ 'is-active': selection === option }"
                    role="menuitem"
                    @click="choose(option)"
                >
                    {{ $t(`ProvenanceV2.opt_${option}`) }}
                    <span class="pv-filter__count ah-mono">{{ counts[option] || 0 }}</span>
                </button>
            </div>
        </transition>
    </div>

    <section v-else class="ah-card pv-filter">
        <div class="ah-label">{{ $t('ProvenanceV2.filter_label') }}</div>
        <div class="pv-filter__row">
            <button
                v-for="option in options"
                :key="option"
                type="button"
                class="pv-filter__chip"
                :class="[`pv-filter__chip--${option}`, { 'is-active': selection === option }]"
                @click="set(option)"
            >
                {{ $t(`ProvenanceV2.opt_${option}`) }} {{ counts[option] || 0 }}
            </button>
        </div>
        <p v-if="hint" class="ah-small ah-muted pv-filter__hint">{{ $t('ProvenanceV2.filter_hint') }}</p>
    </section>
</template>

<script setup>
import { onMounted, onUnmounted, ref, toRef } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useProvenanceFilter } from "./useProvenanceFilter";
import "./style.css";

// "Done by" as a filter (29b): chips over a Done column, or a compact select in
// a toolbar. Both drive the one shared selection, which lives in the url.
defineOptions({ name: "ProvenanceFilter" });

const props = defineProps({
    tasks: { type: Array, default: () => [] },
    variant: { type: String, default: "chips" },
    hint: { type: Boolean, default: false }
});

const open = ref(false);
const { selection, set, counts, options } = useProvenanceFilter(toRef(props, "tasks"));

const choose = (option) => {
    set(option);
    open.value = false;
};

const close = () => { open.value = false; };
onMounted(() => document.addEventListener("click", close));
onUnmounted(() => document.removeEventListener("click", close));
</script>
