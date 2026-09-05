<template>
    <section class="gp">
        <div class="gp__head">
            <h4 class="gp__title">{{ $t('AiProject.guide_title') }}</h4>
            <p class="gp__lead">{{ $t('AiProject.guide_lead') }}</p>
        </div>

        <div v-if="loading" class="gp__status" role="status" aria-live="polite">
            <span class="gp__spinner" aria-hidden="true"></span>
            {{ $t('AiProject.guide_loading') }}
        </div>

        <div v-else-if="errorMessage" class="gp__error">
            <span>{{ $t('AiProject.guide_failed') }} — {{ errorMessage }}</span>
            <button type="button" class="gp__btn" @click="$emit('retry')">{{ $t('AiProject.try_again') }}</button>
        </div>

        <template v-else-if="guide">
            <div class="gp__grid">
                <div v-if="stages.length" class="gp__block">
                    <h5 class="gp__block-title">{{ $t('AiProject.guide_stages') }}</h5>
                    <ol class="gp__stages">
                        <li v-for="(s, i) in stages" :key="i">
                            <strong>{{ s.name }}</strong>
                            <span v-if="s.goal" class="gp__goal"> — {{ s.goal }}</span>
                        </li>
                    </ol>
                </div>
                <div v-if="essentials.length" class="gp__block">
                    <h5 class="gp__block-title">{{ $t('AiProject.guide_essentials') }}</h5>
                    <ul class="gp__list">
                        <li v-for="(e, i) in essentials" :key="i">{{ e }}</li>
                    </ul>
                </div>
                <div v-if="escalations.length" class="gp__block">
                    <h5 class="gp__block-title">{{ $t('AiProject.guide_escalations') }}</h5>
                    <ul class="gp__list">
                        <li v-for="(e, i) in escalations" :key="i">{{ e }}</li>
                    </ul>
                </div>
            </div>

            <details v-if="typeof markdown === 'string'" class="gp__edit">
                <summary class="gp__edit-trigger">{{ $t('AiProject.guide_edit') }}</summary>
                <textarea
                    class="gp__textarea"
                    :value="markdown"
                    rows="10"
                    @input="$emit('update:markdown', $event.target.value)"></textarea>
            </details>
        </template>
    </section>
</template>

<script setup>
import { computed, defineProps, defineEmits } from 'vue';

const props = defineProps({
    guide: { type: Object, default: null },
    markdown: { type: String, default: '' },
    loading: { type: Boolean, default: false },
    errorMessage: { type: String, default: '' },
});

defineEmits(['retry', 'update:markdown']);

const list = (v) => (Array.isArray(v) ? v : []);
const stages = computed(() => list(props.guide && props.guide.stages).filter((s) => s && s.name));
const essentials = computed(() => list(props.guide && props.guide.essentials));
const escalations = computed(() => list(props.guide && props.guide.escalations));
</script>

<style scoped>
.gp {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.gp__head { display: flex; flex-direction: column; gap: 2px; }
.gp__title { margin: 0; font-size: 14px; font-weight: 600; color: #0f172a; }
.gp__lead { margin: 0; font-size: 12px; color: #64748b; line-height: 1.5; }
.gp__grid { display: flex; flex-direction: column; gap: 10px; }
.gp__block-title {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: #94a3b8;
}
.gp__stages, .gp__list { margin: 0; padding-left: 18px; font-size: 13px; color: #1e293b; line-height: 1.5; }
.gp__stages li + li, .gp__list li + li { margin-top: 3px; }
.gp__goal { color: #64748b; }
.gp__status, .gp__error {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    border-radius: 8px;
    padding: 8px 12px;
}
.gp__status { background: #eef2ff; color: #2F3990; }
.gp__error { background: #fff5f5; color: #b91c1c; border: 1px solid #fecaca; justify-content: space-between; }
.gp__spinner {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 2px solid #c7d2fe;
    border-top-color: #2F3990;
    animation: gp-spin 0.8s linear infinite;
}
@keyframes gp-spin { to { transform: rotate(360deg); } }
.gp__btn {
    appearance: none;
    border: 1px solid #fecaca;
    background: #fff;
    color: #b91c1c;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
}
.gp__edit-trigger {
    cursor: pointer;
    font-size: 12px;
    color: #2F3990;
    font-weight: 500;
    list-style: none;
}
.gp__edit-trigger::-webkit-details-marker { display: none; }
.gp__textarea {
    width: 100%;
    margin-top: 8px;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.55;
    color: #0f172a;
    resize: vertical;
    outline: none;
}
.gp__textarea:focus { border-color: #2F3990; box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18); }
</style>
