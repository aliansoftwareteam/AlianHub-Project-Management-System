<template>
    <div class="mention">
        <label class="ah-field__label" for="mention-body">{{ $t('ParityV2.comment_label') }}</label>
        <textarea
            id="mention-body"
            ref="box"
            v-model="draft"
            class="mention__box"
            :placeholder="$t('ParityV2.comment_placeholder')"
            @keydown.esc="open = false"
        ></textarea>

        <div v-if="open && suggestions.length" class="ah-pop mention__pop">
            <div class="ah-pop__label ah-label">{{ $t('ParityV2.agents') }}</div>
            <button v-for="agent in suggestions" :key="agent._id" type="button" class="ah-pop__item" @click="pick(agent)">
                <span class="ah-avatar ah-avatar--agent ah-avatar--sm"><ShellIcon name="agent" :size="11" /></span>
                <span>
                    <span class="mention__who">{{ agent.name }}</span>
                    <span class="ah-chip ah-chip--agent ah-chip--mono agent-id__tag" style="margin-left:6px">{{ $t('ParityV2.agent_tag') }}</span>
                </span>
            </button>
        </div>

        <p v-if="mentioned" class="mention__hint">{{ $t('ParityV2.mention_will_run', { name: mentioned.name }) }}</p>
        <p v-else-if="draft.includes('@')" class="mention__hint">{{ $t('ParityV2.mention_no_match') }}</p>
        <p v-if="error" class="ah-field__error">{{ error }}</p>

        <div class="mention__foot">
            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="!canSend || busy" @click="send">
                {{ busy ? $t('ParityV2.starting') : (mentioned ? $t('ParityV2.comment_and_run') : $t('ParityV2.comment')) }}
            </button>
            <span class="mention__hint">{{ $t('ParityV2.mention_hint') }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// @mention an agent in a comment and it starts a run (13b). The mention is the
// trigger and the comment text is the brief the run carries, so what the person
// typed is what the run records as its reason.
defineOptions({ name: "AgentMentionBox" });

const props = defineProps({
    agents: { type: Array, default: () => [] },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" },
    disabled: { type: Boolean, default: false }
});

const emit = defineEmits(["send"]);

const draft = ref("");
const open = ref(false);
const box = ref(null);

const term = computed(() => {
    const match = /@([\w-]*)$/.exec(draft.value);
    return match ? match[1].toLowerCase() : null;
});

const suggestions = computed(() => {
    if (term.value === null) return [];
    return props.agents.filter((a) => !a.paused && String(a.name || "").toLowerCase().includes(term.value)).slice(0, 6);
});

const mentioned = computed(() => props.agents.find((a) => {
    const handle = String(a.name || "").replace(/\s+/g, "");
    return handle && new RegExp(`@${handle}\\b`, "i").test(draft.value);
}) || null);

watch(term, (value) => { open.value = value !== null; });

const pick = (agent) => {
    draft.value = draft.value.replace(/@([\w-]*)$/, `@${String(agent.name).replace(/\s+/g, "")} `);
    open.value = false;
    if (box.value) box.value.focus();
};

const canSend = computed(() => Boolean(draft.value.trim()) && !props.disabled);

const send = () => {
    if (!canSend.value) return;
    emit("send", { body: draft.value.trim(), agent: mentioned.value });
    draft.value = "";
};
</script>

<style>
@import "./parity.css";
</style>
