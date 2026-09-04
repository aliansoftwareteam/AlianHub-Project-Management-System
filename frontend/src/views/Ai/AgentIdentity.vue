<template>
    <span class="agent-id" :class="{ 'agent-id--stacked': Boolean(sub) }">
        <span class="ah-avatar ah-avatar--agent" :class="avatarSize"><ShellIcon name="agent" :size="glyph" /></span>
        <span class="agent-id__text">
            <span class="agent-id__name">
                <strong>{{ name }}</strong>
                <span class="ah-chip ah-chip--agent ah-chip--mono agent-id__tag">{{ $t('Parity.agent_tag') }}</span>
            </span>
            <span v-if="sub" class="agent-id__sub">{{ sub }}</span>
        </span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// The one place an agent is drawn as an actor. People are circles, agents are
// rounded squares with an AGENT tag — an accessibility rule, not a style choice,
// so every surface that names an agent renders it through this component.
defineOptions({ name: "AgentIdentity" });

const props = defineProps({
    name: { type: String, required: true },
    sub: { type: String, default: "" },
    size: { type: String, default: "md" }
});

const avatarSize = computed(() => (props.size === "sm" ? "ah-avatar--sm" : (props.size === "lg" ? "ah-avatar--lg" : "")));
const glyph = computed(() => ({ sm: 11, md: 14, lg: 16 }[props.size] || 14));
</script>

<style>
@import "./parity.css";
</style>
