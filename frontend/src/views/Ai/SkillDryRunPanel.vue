<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw sk-dry" role="dialog" aria-modal="true" :aria-label="$t('Ai.skill_dry_run_title', { name: result.skill.name })">
                <div class="aw__head">
                    <span class="ah-h3">{{ $t('Ai.skill_dry_run_title', { name: result.skill.name }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('Ai.close')" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="aw__body">
                    <p class="ai-lead">{{ $t('Ai.skill_dry_run_lead', { task: result.task.key || result.task.name }) }}</p>

                    <div class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_risk_preview') }}</span>
                        <div class="sk-dry__chips">
                            <span class="ah-chip" :class="riskChip(result.risk)">{{ $t('Ai.risk') }}: {{ result.risk }}</span>
                            <span v-for="action in result.actions" :key="action.key" class="ah-chip ah-chip--mono ah-chip--sm" :class="{ 'sk-dry__outside': result.outsideAgent.includes(action.key) }">
                                {{ action.key }}
                            </span>
                        </div>
                        <span class="ah-field__hint">{{ $t('Ai.skill_effective_actions', { list: result.effectiveActions.join(', ') || $t('Ai.none') }) }}</span>
                        <span v-if="result.outsideAgent.length" class="ah-field__hint">{{ $t('Ai.skill_outside_agent', { list: result.outsideAgent.join(', ') }) }}</span>
                    </div>

                    <div v-if="!result.ran" class="ah-field">
                        <span class="ah-field__label">{{ $t('Ai.skill_would_skip') }}</span>
                        <p class="ah-small sk-dry__skip">{{ result.skipped }}</p>
                    </div>

                    <template v-else>
                        <div class="ah-field">
                            <span class="ah-field__label">{{ $t('Ai.skill_would_read') }}</span>
                            <pre class="sk-dry__code">{{ pretty(result.gathered) }}</pre>
                        </div>
                        <div v-if="result.prompt" class="ah-field">
                            <span class="ah-field__label">{{ $t('Ai.skill_would_ask') }}</span>
                            <pre class="sk-dry__code">{{ result.prompt.system }}</pre>
                            <pre class="sk-dry__code">{{ result.prompt.user }}</pre>
                        </div>
                    </template>

                    <p class="ah-small">{{ $t('Ai.skill_dry_run_note') }}</p>
                </div>

                <div class="aw__foot">
                    <span v-if="result.skill.model" class="ah-small ah-mono">{{ result.skill.model }}</span>
                    <div class="ah-toolbar__spacer"></div>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Ai.close') }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "SkillDryRunPanel" });

defineProps({ result: { type: Object, required: true } });
defineEmits(["close"]);

const riskChip = (risk) => (risk === "high" ? "ah-chip--danger" : risk === "medium" ? "ah-chip--warn" : "ah-chip--ok");
const pretty = (value) => JSON.stringify(value, null, 2);
</script>

<style>
.sk-dry { width: 720px; }
.sk-dry__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sk-dry__outside { opacity: .5; text-decoration: line-through; }
.sk-dry__skip { margin: 0; color: var(--warn-ink); }
.sk-dry__code { font: 400 11.5px/1.55 var(--font-mono); background: var(--track); color: var(--ink); padding: 10px 12px; border-radius: var(--r-input); overflow: auto; max-height: 220px; margin: 0 0 8px; white-space: pre-wrap; }
</style>
