<template>
    <teleport to="body">
        <div v-show="open" class="pft-sheet" data-test="filters-sheet" @click.self="close">
            <div
                ref="panel"
                class="pft-sheet__panel"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                @keydown.esc.stop="close"
            >
                <div class="pft-sheet__grab" aria-hidden="true"></div>
                <div class="pft-sheet__head">
                    <h2 :id="titleId" class="pft-sheet__title">{{ $t('Projects.filters') }}</h2>
                    <button type="button" class="pft-sheet__close" :aria-label="$t('Projects.filters_close')" @click="close">
                        <ShellIcon name="x" :size="16" />
                    </button>
                </div>
                <div class="pft pft-sheet__body">
                    <slot />
                </div>
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { computed, ref, useId } from 'vue';
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import { useFocusTrap } from '@/composable/useFocusTrap';

defineOptions({ name: 'ProjectFiltersSheet' });

const props = defineProps({
    open: { type: Boolean, default: false },
});
const emit = defineEmits(['update:open']);

const panel = ref(null);
const titleId = `pft-sheet-title-${useId()}`;

useFocusTrap(panel, computed(() => props.open));

const close = () => emit('update:open', false);
</script>
