<template>
    <div>
        <div v-if="error" class="in-banner in-banner--danger"><ShellIcon name="alert" :size="15" /><span>{{ error }}</span></div>
        <div v-else-if="!summary" class="ah-empty">{{ $t('Instance.loading') }}</div>
        <template v-else>
            <div v-if="actionError" class="in-banner in-banner--danger" data-test="action-error"><ShellIcon name="alert" :size="15" /><span>{{ actionError }}</span></div>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('InstructionPatterns.title') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="load">
                        <ShellIcon name="refresh" :size="14" />{{ $t('Instance.refresh') }}
                    </button>
                </div>
                <p class="ah-small">{{ $t('InstructionPatterns.lead') }}</p>
                <p class="ah-small" data-test="cache-note">{{ $t('InstructionPatterns.cache_note', { seconds: summary.cacheTtlSeconds }) }}</p>
            </section>

            <section class="ah-card in-card">
                <div class="in-card__head"><span class="in-card__title">{{ $t('InstructionPatterns.added_title') }}</span></div>
                <p v-if="!summary.added.length" class="ah-small" data-test="no-added">{{ $t('InstructionPatterns.no_added') }}</p>
                <ul v-else class="ip-list">
                    <li v-for="p in summary.added" :key="p.id" class="ip-row" :data-test="`added-${p.id}`">
                        <code class="ah-mono ip-source">{{ p.source }}</code>
                        <span v-if="p.note" class="ah-small ip-note">{{ p.note }}</span>
                        <span class="ah-small ip-meta">{{ $t('InstructionPatterns.added_by') }} <strong>{{ nameOf(p.addedBy, p.addedByName) }}</strong> · {{ formatWhen(p.addedAt) }}</span>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm ip-remove" :aria-label="$t('InstructionPatterns.remove')" :title="$t('InstructionPatterns.remove')" :disabled="busy" :data-test="`remove-${p.id}`" @click="remove(p)">
                            <ShellIcon name="x" :size="14" />
                        </button>
                    </li>
                </ul>

                <form class="ip-form" data-test="add-form" @submit.prevent="add">
                    <span class="in-card__title">{{ $t('InstructionPatterns.add_title') }}</span>
                    <label class="ah-small" for="ip-source">{{ $t('InstructionPatterns.source_label') }}</label>
                    <input id="ip-source" v-model="source" type="text" class="ah-input ah-mono" autocomplete="off" spellcheck="false" :maxlength="summary.limits.maxLength" :placeholder="$t('InstructionPatterns.source_placeholder')" :disabled="busy" data-test="source-input" @input="sourceError = ''" />
                    <p v-if="sourceError" class="ah-small ip-error" data-test="source-error">{{ sourceError }}</p>
                    <label class="ah-small" for="ip-note">{{ $t('InstructionPatterns.note_label') }}</label>
                    <input id="ip-note" v-model="note" type="text" class="ah-input" autocomplete="off" :maxlength="summary.limits.maxNote || 200" :placeholder="$t('InstructionPatterns.note_placeholder')" :disabled="busy" data-test="note-input" />
                    <p class="ah-small">{{ $t('InstructionPatterns.format_help', limitParams) }}</p>
                    <div class="in-actions">
                        <button type="submit" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy || !source.trim()">{{ $t('InstructionPatterns.add') }}</button>
                    </div>
                </form>
            </section>

            <section class="ah-card in-card">
                <div class="in-card__head">
                    <span class="in-card__title">{{ $t('InstructionPatterns.builtin_title') }}</span>
                </div>
                <p class="ah-small">{{ $t('InstructionPatterns.builtin_help') }}</p>
                <ul class="ip-list" data-test="builtin-list">
                    <li v-for="p in summary.builtIn" :key="p.id" class="ip-row" data-test="builtin-pattern">
                        <code class="ah-mono ip-source">{{ p.source }}</code>
                        <span class="ah-chip ah-chip--mono">{{ $t('InstructionPatterns.builtin_locked') }}</span>
                    </li>
                </ul>
            </section>

            <section v-if="summary.history.length" class="ah-card in-card" data-test="history">
                <div class="in-card__head"><span class="in-card__title">{{ $t('InstructionPatterns.history_title') }}</span></div>
                <ul class="ip-list">
                    <li v-for="(h, i) in summary.history" :key="`${h.at}-${i}`" class="ip-row">
                        <span class="ah-small">{{ $t(h.action === REMOVED_ACTION ? 'InstructionPatterns.history_removed' : 'InstructionPatterns.history_added') }} <strong>{{ nameOf(h.actorId, h.actorName) }}</strong></span>
                        <code class="ah-mono ip-source">{{ h.source }}</code>
                        <span class="ah-small ip-meta">{{ formatWhen(h.at) }}</span>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useInstanceApi, formatWhen } from "./useInstanceApi";

defineOptions({ name: "InstanceInstructionPatterns" });

const { t } = useI18n();
const $toast = useToast();
const { get, post, del, message, env } = useInstanceApi();

const ADMIN_KEY_ACTOR = "instance-admin-key";
const REMOVED_ACTION = "ai.instruction_pattern_removed";
const REASONS = ["empty", "too_short", "too_long", "invalid", "backreference", "lookaround", "nested_repeat", "too_many_repeats", "repeat_too_large", "matches_empty", "builtin", "duplicate"];
const CODES = ["too_many", "builtin_locked", "unknown_pattern", "invalid_id", "server_error"];

const summary = ref(null);
const error = ref("");
const actionError = ref("");
const sourceError = ref("");
const busy = ref(false);
const source = ref("");
const note = ref("");

const limitParams = computed(() => {
    const limits = summary.value?.limits || {};
    return { length: limits.maxLength, repeats: limits.maxRepeats, bound: limits.maxRepeatBound, max: limits.maxPatterns };
});

const nameOf = (id, name) => (id === ADMIN_KEY_ACTOR ? t("InstructionPatterns.added_by_admin_key") : name || id);

const load = async () => {
    try {
        summary.value = await get(env.INSTANCE_INSTRUCTION_PATTERNS);
        error.value = "";
    } catch (e) {
        error.value = message(e);
    }
};

const refusal = (e) => {
    const body = e?.response?.data || {};
    const reason = body.data?.reason;
    if (reason && REASONS.includes(reason)) return { field: true, text: t(`InstructionPatterns.reason_${reason}`, limitParams.value) };
    if (CODES.includes(body.code)) return { field: false, text: t(`InstructionPatterns.code_${body.code}`, limitParams.value) };
    return { field: false, text: message(e) };
};

const add = async () => {
    const wanted = source.value.trim();
    if (!wanted) return;
    busy.value = true;
    actionError.value = "";
    sourceError.value = "";
    try {
        await post(env.INSTANCE_INSTRUCTION_PATTERNS, { source: wanted, note: note.value.trim() });
        source.value = "";
        note.value = "";
        $toast.success(t("InstructionPatterns.added"));
        await load();
    } catch (e) {
        const { field, text } = refusal(e);
        if (field) sourceError.value = text;
        else actionError.value = text;
    } finally {
        busy.value = false;
    }
};

const remove = async (pattern) => {
    if (!window.confirm(t("InstructionPatterns.remove_confirm"))) return;
    busy.value = true;
    actionError.value = "";
    try {
        await del(`${env.INSTANCE_INSTRUCTION_PATTERNS}/${pattern.id}`);
        $toast.success(t("InstructionPatterns.removed"));
    } catch (e) {
        actionError.value = refusal(e).text;
    } finally {
        busy.value = false;
        await load();
    }
};

onMounted(load);
</script>

<style scoped>
.ip-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.ip-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--hairline); }
.ip-row:last-child { border-bottom: 0; }
.ip-source { overflow-wrap: anywhere; }
.ip-note { color: var(--ink); }
.ip-meta { color: var(--ink-2); }
.ip-remove { margin-left: auto; }
.ip-form { display: flex; flex-direction: column; gap: 6px; max-width: 560px; padding-top: 8px; }
.ip-error { color: var(--danger-ink); margin: 0; }
</style>
