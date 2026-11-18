<template>
    <Teleport to="body">
        <div class="apw-backdrop" @click.self="$emit('close')">
            <div
                ref="box"
                class="ah-card apw"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                data-test="proposal-why-dialog"
                @keydown.esc.stop.prevent="$emit('close')"
            >
                <div class="apw__head">
                    <span :id="titleId" class="ah-h3 apw__title">{{ $t('Time.why_title', { name: proposal.agentName }) }}</span>
                    <button ref="closer" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Time.why_close')" data-test="why-close" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>
                <div class="apw__body">
                    <p class="apw__what">{{ proposal.summary }}</p>
                    <div>
                        <div class="ah-label">{{ $t('Time.why_reason') }}</div>
                        <p class="apw__why">{{ proposal.detail || $t('Time.why_no_reason') }}</p>
                    </div>
                    <div v-if="proposal.changes.length">
                        <div class="ah-label">{{ $t('Time.why_changes') }}</div>
                        <ul class="apw__changes">
                            <li v-for="(change, i) in proposal.changes" :key="i" class="apw__change">
                                <span class="apw__change-label">{{ change.label }}</span>
                                <span v-if="!change.reversible" class="ah-chip ah-chip--warn" data-test="why-change-permanent">{{ $t('Time.why_permanent') }}</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { onMounted, ref, useId } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useFocusTrap } from "@/composable/useFocusTrap";

defineOptions({ name: "ProposalWhyDialog" });

defineProps({
    proposal: { type: Object, required: true }
});
defineEmits(["close"]);

const titleId = `proposal-why-${useId()}`;
const box = ref(null);
const closer = ref(null);

useFocusTrap(box, ref(true), { returnFocus: false });

onMounted(() => { if (closer.value) closer.value.focus(); });
</script>

<style>
.apw-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; }
.apw { width: 520px; max-width: 100%; max-height: 86dvh; display: flex; flex-direction: column; border-radius: var(--r-modal); box-shadow: var(--shadow-modal); outline: none; }
.apw__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.apw__title { min-width: 0; overflow-wrap: anywhere; }
.apw__head .ah-btn { margin-left: auto; flex: none; }
.apw__body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.apw__what { margin: 0; font: 600 14px/1.4 var(--font-ui); color: var(--ink); overflow-wrap: anywhere; }
.apw__why { margin: 6px 0 0; font: var(--text-body); color: var(--ink-label); line-height: 1.5; overflow-wrap: anywhere; white-space: pre-line; }
.apw__changes { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.apw__change { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: var(--text-body); color: var(--ink); }
.apw__change-label { min-width: 0; overflow-wrap: anywhere; }
</style>
