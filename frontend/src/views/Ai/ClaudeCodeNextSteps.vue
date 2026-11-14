<template>
    <section class="ccn" data-test="claude-code-next-steps" :aria-labelledby="headingId">
        <h4 :id="headingId" class="ccn__title">{{ $t('ClaudeCodeSetup.title') }}</h4>
        <p class="ccn__lead">{{ $t('ClaudeCodeSetup.lead') }}</p>
        <ol class="ccn__steps">
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_window_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_window_body') }}</p>
            </li>
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_command_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_command_body') }}</p>
                <code class="ccn__code">{{ REMOVE_OLD }}</code>
            </li>
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_check_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_check_body') }}</p>
                <code class="ccn__code">{{ CHECK }}</code>
            </li>
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_teach_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_teach_body', { windowsPath: WINDOWS_PATH, macPath: MAC_PATH }) }}</p>
                <pre class="ccn__code ccn__code--block" data-test="developer-instructions">{{ instructions }}</pre>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" data-test="copy-instructions" @click="copyInstructions">
                    {{ copied ? $t('ClaudeCodeSetup.copied') : $t('ClaudeCodeSetup.copy_instructions') }}
                </button>
            </li>
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_hand_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_hand_body', { at: '@' }) }}</p>
            </li>
            <li>
                <strong>{{ $t('ClaudeCodeSetup.step_run_title') }}</strong>
                <p>{{ $t('ClaudeCodeSetup.step_run_body') }}</p>
                <code class="ccn__code">{{ $t('ClaudeCodeSetup.run_sentence') }}</code>
            </li>
        </ol>
        <a class="ccn__guide" :href="guideHref" target="_blank" rel="noopener" data-test="claude-code-guide-link">{{ $t('ClaudeCodeSetup.guide_link') }}</a>
    </section>
</template>

<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { GUIDE, useDocsLink } from "@/composable/docsLink";

defineOptions({ name: "ClaudeCodeNextSteps" });

const REMOVE_OLD = "claude mcp remove alianhub -s local";
const CHECK = "claude mcp list";
const WINDOWS_PATH = "C:\\Users\\<your name>\\.claude\\CLAUDE.md";
const MAC_PATH = "~/.claude/CLAUDE.md";

const { t } = useI18n();
const headingId = `ccn-${Math.random().toString(36).slice(2, 8)}`;
const guideHref = useDocsLink(GUIDE.CLAUDE_CODE_DEVELOPER);
const instructions = computed(() => t("ClaudeCodeSetup.instructions"));
const copied = ref(false);

const copyInstructions = async () => {
    try {
        await navigator.clipboard.writeText(instructions.value);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1600);
    } catch (error) {
        copied.value = false;
    }
};
</script>

<style scoped>
.ccn {
    margin-top: var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    background: var(--surface);
    padding: var(--sp-4);
}
.ccn__title { margin: 0 0 var(--sp-1); font: var(--fw-strong) var(--fs-md)/1.3 var(--font-ui); color: var(--ink); }
.ccn__lead { margin: 0 0 var(--sp-3); font-size: var(--fs-sm); color: var(--ink-2); }
.ccn__steps { margin: 0; padding-left: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-3); }
.ccn__steps li { font-size: var(--fs-sm); color: var(--ink); }
.ccn__steps p { margin: 2px 0 6px; color: var(--ink-2); overflow-wrap: anywhere; }
.ccn__code {
    display: block;
    font: 12px/1.6 var(--font-mono);
    color: var(--ink);
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
    padding: 6px 10px;
    overflow-x: auto;
    user-select: all;
}
.ccn__code--block { white-space: pre-wrap; margin: 0 0 var(--sp-2); max-height: 220px; overflow-y: auto; }
.ccn__guide { display: inline-block; margin-top: var(--sp-3); font-size: var(--fs-sm); color: var(--brand-deep); }
</style>
