<template>
    <div class="bs">
        <div v-if="loading" class="bs__status" role="status" aria-live="polite">
            <span class="bs__spinner" aria-hidden="true"></span>
            <div>
                <p class="bs__status-title">{{ $t('AiProject.brief_drafting') }}</p>
                <p class="bs__status-sub">{{ $t('AiProject.brief_drafting_sub') }}</p>
            </div>
        </div>

        <div v-else-if="errorMessage" class="bs__error">
            <p class="bs__error-title">{{ $t('AiProject.brief_failed') }}</p>
            <p class="bs__error-msg">{{ errorMessage }}</p>
            <div class="bs__row">
                <button type="button" class="bs__btn bs__btn--ghost" @click="$emit('retry')">{{ $t('AiProject.try_again') }}</button>
                <button type="button" class="bs__btn bs__btn--primary" @click="$emit('skip')">{{ $t('AiProject.brief_skip') }}</button>
            </div>
        </div>

        <template v-else>
            <div class="bs__head">
                <h3 class="bs__title">{{ $t('AiProject.brief_title') }}</h3>
                <p class="bs__lead">{{ $t('AiProject.brief_lead') }}</p>
            </div>

            <div class="bs__columns">
                <section class="bs__col">
                    <label class="bs__label">{{ $t('AiProject.brief_original') }}</label>
                    <pre class="bs__original">{{ original }}</pre>
                </section>
                <section class="bs__col">
                    <label class="bs__label" for="aipg-brief-draft">
                        {{ $t('AiProject.brief_draft') }}
                        <span v-if="approved" class="bs__approved">✓ {{ $t('AiProject.brief_approved') }}</span>
                    </label>
                    <textarea
                        id="aipg-brief-draft"
                        class="bs__draft"
                        :value="draft"
                        :disabled="generating"
                        rows="16"
                        @input="$emit('update:draft', $event.target.value)"></textarea>
                </section>
            </div>

            <section class="bs__assumptions">
                <h4 class="bs__sub-title">{{ $t('AiProject.assumptions_title') }}</h4>
                <p class="bs__lead">{{ $t('AiProject.assumptions_lead') }}</p>
                <ul v-if="assumptions.length" class="bs__list">
                    <li v-for="(a, i) in assumptions" :key="i">
                        <span v-if="a.point" class="bs__point">{{ $t(`AiProject.point_${a.point}`) }}</span>
                        {{ a.text }}
                    </li>
                </ul>
                <p v-else class="bs__lead">{{ $t('AiProject.no_assumptions') }}</p>
            </section>

            <p v-if="editedSinceApproval" class="bs__notice">{{ $t('AiProject.brief_reapprove') }}</p>

            <div v-if="planError" class="bs__error bs__error--inline">{{ planError }}</div>

            <div v-if="generating" class="bs__status" role="status" aria-live="polite">
                <span class="bs__spinner" aria-hidden="true"></span>
                <div>
                    <p class="bs__status-title">{{ $t('AiProject.generating_plan') }}</p>
                    <p class="bs__status-sub">{{ $t('AiProject.generating_plan_sub') }}</p>
                </div>
            </div>

            <footer class="bs__foot">
                <button type="button" class="bs__btn bs__btn--ghost" :disabled="generating" @click="$emit('back')">{{ $t('AiProject.back') }}</button>
                <span class="bs__spacer"></span>
                <button type="button" class="bs__btn bs__btn--link" :disabled="generating" @click="$emit('regenerate')">{{ $t('AiProject.brief_redraft') }}</button>
                <button
                    type="button"
                    class="bs__btn"
                    :class="approved ? 'bs__btn--approved' : 'bs__btn--ghost'"
                    :disabled="generating || approved || !draft.trim()"
                    data-test="approve-brief"
                    @click="$emit('approve')">
                    {{ approved ? '✓ ' + $t('AiProject.brief_approved') : $t('AiProject.approve_brief') }}
                </button>
                <button
                    type="button"
                    class="bs__btn bs__btn--primary"
                    :disabled="!approved || generating"
                    data-test="generate-plan"
                    @click="$emit('generate')">
                    {{ $t('AiProject.generate_plan') }}
                </button>
            </footer>
        </template>
    </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

defineProps({
    original: { type: String, default: '' },
    draft: { type: String, default: '' },
    assumptions: { type: Array, default: () => [] },
    approved: { type: Boolean, default: false },
    editedSinceApproval: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    generating: { type: Boolean, default: false },
    errorMessage: { type: String, default: '' },
    planError: { type: String, default: '' },
});

defineEmits(['update:draft', 'approve', 'generate', 'regenerate', 'retry', 'skip', 'back']);
</script>

<style scoped>
.bs { display: flex; flex-direction: column; gap: 14px; }
.bs__head { display: flex; flex-direction: column; gap: 4px; }
.bs__title { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
.bs__sub-title { margin: 0 0 2px; font-size: 14px; font-weight: 600; color: #0f172a; }
.bs__lead { margin: 0; font-size: 12px; color: #64748b; line-height: 1.5; }

.bs__columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}
@media (max-width: 640px) {
    .bs__columns { grid-template-columns: 1fr; }
}
.bs__col {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
}
.bs__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 600;
    font-size: 13px;
    color: #0f172a;
}
.bs__approved {
    font-size: 11px;
    font-weight: 600;
    color: #15803d;
    background: #dcfce7;
    padding: 2px 8px;
    border-radius: 999px;
}
.bs__original {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.55;
    color: #475569;
    background: #f8fafc;
    border-radius: 8px;
    padding: 10px 12px;
    max-height: 420px;
    overflow: auto;
}
.bs__draft {
    width: 100%;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 10px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.55;
    color: #0f172a;
    background: #fff;
    resize: vertical;
    min-height: 260px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.bs__draft:focus {
    border-color: #2F3990;
    box-shadow: 0 0 0 3px rgba(47, 57, 144, 0.18);
}
.bs__draft:disabled { opacity: 0.7; cursor: not-allowed; }

.bs__assumptions {
    background: #f5f3ff;
    border: 1px solid #ddd6fe;
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.bs__list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: #1e1b4b; line-height: 1.5; }
.bs__list li + li { margin-top: 4px; }
.bs__point {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: #ede9fe;
    color: #5b21b6;
    font-size: 11px;
    font-weight: 600;
}

.bs__notice {
    margin: 0;
    font-size: 12px;
    color: #9a3412;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 8px;
    padding: 8px 12px;
}

.bs__status {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 12px;
    padding: 12px 16px;
}
.bs__status-title { margin: 0; font-weight: 600; font-size: 13px; color: #2F3990; }
.bs__status-sub { margin: 2px 0 0; font-size: 12px; color: #64748b; }
.bs__spinner {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid #c7d2fe;
    border-top-color: #2F3990;
    animation: bs-spin 0.8s linear infinite;
    flex-shrink: 0;
}
@keyframes bs-spin { to { transform: rotate(360deg); } }

.bs__error {
    background: #fff5f5;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: #b91c1c;
}
.bs__error--inline { padding: 10px 14px; }
.bs__error-title { margin: 0; font-size: 13px; font-weight: 600; color: #c5343a; }
.bs__error-msg { margin: 0; font-size: 12px; color: #4b5563; line-height: 1.5; }
.bs__row { display: flex; gap: 8px; margin-top: 4px; }

.bs__foot {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 12px;
    border-top: 1px solid #f0f1f3;
}
.bs__spacer { flex: 1; }
.bs__btn {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.bs__btn--ghost { background: transparent; border-color: #e5e7eb; color: #4b5563; }
.bs__btn--ghost:hover:not(:disabled) { background: #f4f5f7; border-color: #d1d5db; }
.bs__btn--link { background: transparent; color: #6b7280; padding: 6px 8px; }
.bs__btn--link:hover:not(:disabled) { color: #2F3990; }
.bs__btn--approved { background: #dcfce7; border-color: #bbf7d0; color: #15803d; }
.bs__btn--primary { background: #2F3990; border-color: #2F3990; color: #fff; }
.bs__btn--primary:hover:not(:disabled) { background: #252D75; border-color: #252D75; }
.bs__btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
