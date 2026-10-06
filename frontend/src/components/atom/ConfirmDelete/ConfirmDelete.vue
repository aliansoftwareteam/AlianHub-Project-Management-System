<template>
    <!-- Teleported so no ancestor's overflow or stacking context can clip or bury
         it. That also puts it outside #app, which owns the app font, so the font
         is set explicitly below. -->
    <Teleport to="body">
        <div class="cd__wrap" @click.self="$emit('cancel')">
            <div class="cd" role="dialog" aria-modal="true" :aria-label="title">
                <span class="cd__icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                    </svg>
                </span>
                <h3 class="cd__title">{{ title }}</h3>
                <p v-if="description" class="cd__desc">{{ description }}</p>
                <div class="cd__actions">
                    <button ref="cancelBtn" type="button" class="cd__btn" @click="$emit('cancel')">
                        {{ cancelLabel || $t('Projects.cancel') }}
                    </button>
                    <button type="button" class="cd__btn cd__btn--danger" :disabled="busy"
                        @click="$emit('confirm')">
                        {{ busy ? '…' : confirmLabel }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, defineProps, defineEmits } from 'vue';

defineProps({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    confirmLabel: { type: String, required: true },
    cancelLabel: { type: String, default: '' },
    busy: { type: Boolean, default: false },
});
const emit = defineEmits(['confirm', 'cancel']);

// Cancel is focused, not the destructive button: a stray Enter should not delete.
const cancelBtn = ref(null);
const onKey = (e) => { if (e.key === 'Escape') emit('cancel'); };

onMounted(() => {
    document.addEventListener('keydown', onKey);
    if (cancelBtn.value) cancelBtn.value.focus();
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<style scoped>
/* Same visual spec as the Notepad and Clips confirmations, which each carry their
   own copy of this markup. */
.cd__wrap { position: fixed; inset: 0; z-index: 1300; display: flex; align-items: center;
    justify-content: center; padding: 16px; background: rgba(23, 24, 36, .45);
    font-family: 'Roboto', sans-serif; }
.cd { width: 100%; max-width: 384px; padding: 20px; background: #fff; border-radius: 12px;
    box-shadow: 0 18px 50px rgba(23, 24, 36, .28); }
.cd__icon { display: inline-flex; align-items: center; justify-content: center; width: 34px;
    height: 34px; margin-bottom: 12px; color: #9B2C2C; background: #FBEBEB; border-radius: 9px; }
.cd__title { margin: 0 0 4px; font-size: 14.5px; font-weight: 600; color: #191A2B; }
.cd__desc { margin: 0 0 18px; font-size: 12.5px; color: #6B6B70; line-height: 1.55; }
.cd__actions { display: flex; gap: 10px; }
.cd__btn { flex: 1; padding: 8px 14px; font-family: inherit; font-size: 13px; font-weight: 600;
    color: #191A2B; background: #fff; border: 1px solid #D3D5E4; border-radius: 8px; cursor: pointer; }
.cd__btn:hover { background: #F4F4FA; }
.cd__btn--danger { color: #fff; background: #DC4C4C; border-color: #DC4C4C; }
.cd__btn--danger:hover:not(:disabled) { background: #C43D3D; }
.cd__btn:disabled { opacity: .7; cursor: default; }
</style>
