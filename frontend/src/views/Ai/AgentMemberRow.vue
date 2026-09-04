<template>
    <div class="member-row member-row--agent">
        <AgentIdentity :name="agent.name" :sub="ownerLine" size="lg" />
        <span class="member-row__role">{{ $t('Parity.role_agent') }}</span>
        <span class="member-row__access">{{ accessLine }}</span>
        <span class="member-row__active ah-mono">{{ activeLine }}</span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AgentIdentity from "./AgentIdentity.vue";

// The agent row for the Members table (13b). It lives here rather than in
// Settings/Members so the members list, the Team board and the picker all draw
// an agent the same way; Members imports it.
defineOptions({ name: "AgentMemberRow" });

const props = defineProps({
    agent: { type: Object, required: true },
    ownerName: { type: String, default: "" },
    lastActive: { type: String, default: "" }
});

const { t } = useI18n();

const ownerLine = computed(() => {
    const bits = [];
    if (props.ownerName) bits.push(t("Parity.owned_by", { name: props.ownerName }));
    bits.push(`L${Number(props.agent.autonomy || 0)}`);
    if (!props.agent.paused) bits.push(t("Parity.assignable"));
    return bits.join(" · ");
});

const accessLine = computed(() => {
    const ids = props.agent.projectIds || [];
    const scope = ids.length ? t("Parity.n_projects", { n: ids.length }) : t("Parity.all_projects");
    const skills = (props.agent.skills || []).length;
    const writes = (props.agent.allowedActions || []).filter((a) => !a.startsWith("tasks.") && a !== "task.get" && a !== "docs.read").length;
    return skills ? `${scope} · ${t("Parity.n_skills", { n: skills })}` : `${scope} · ${writes ? t("Parity.n_actions", { n: writes }) : t("Parity.read_only")}`;
});

const activeLine = computed(() => props.lastActive || (props.agent.paused ? t("Parity.paused") : t("Parity.idle")));
</script>

<style>
@import "./parity.css";
</style>
