<template>
    <span v-if="badge" class="pv" :class="{ 'pv--unchecked': badge === BADGES.UNCHECKED }">
        <span v-if="actors && stack.length" class="pv__actors">
            <span
                v-for="actor in stack"
                :key="actor.key"
                class="ah-avatar ah-avatar--sm"
                :class="{ 'ah-avatar--agent': actor.isAgent }"
                :title="actor.name"
            >{{ actor.initials }}</span>
        </span>
        <span v-if="line && lineParts.length" class="pv__line">
            <template v-for="(part, index) in lineParts" :key="part.text">
                <span v-if="index" class="pv__sep">·</span>
                <strong v-if="part.strong">{{ part.text }}</strong>
                <span v-else>{{ part.text }}</span>
            </template>
        </span>
        <span class="ah-chip pv-badge" :class="chipClass" :title="$t(`Provenance.badge_${badge.toLowerCase()}_hint`)">{{ $t(`Provenance.badge_${badge.toLowerCase()}`) }}</span>
    </span>
</template>

<script setup>
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { BADGES, CHIP_CLASS, badgeOf, deriveBadge, normalize } from "./provenance";
import { useProvenanceActors } from "./useProvenanceActors";
import "./style.css";

// The badge on a finished task (29b). Quiet, on the right, and it only ever
// says which pattern the work followed — which model ran is one click deeper,
// in the completion record itself.
defineOptions({ name: "ProvenanceBadge" });

const props = defineProps({
    task: { type: Object, default: null },
    completion: { type: Object, default: null },
    done: { type: Boolean, default: false },
    line: { type: Boolean, default: false },
    actors: { type: Boolean, default: false }
});

const { t } = useI18n();
const { ensureAgents, personName, agentName, initialsOf } = useProvenanceActors();

const record = computed(() => normalize(props.task ? props.task.completion : props.completion));
const badge = computed(() => (props.task ? badgeOf(props.task) : (props.done ? deriveBadge(props.completion) : null)));
const chipClass = computed(() => CHIP_CLASS[badge.value] || "");

const nameOfActor = (actorId) => personName(actorId) || t("Provenance.someone");

/* "Ken via Claude Code" for a personal CLI run, the agent's own name for a
 * workspace agent, the person's name otherwise. */
const labelOf = (entry) => {
    if (entry.actorType !== "agent") return nameOfActor(entry.actorId);
    const named = agentName(entry);
    if (entry.viaAccount === "personal") {
        return t("Provenance.via", { name: nameOfActor(entry.actorId), agent: named || t("Provenance.cli_agent") });
    }
    return named || t("Provenance.an_agent");
};

const stack = computed(() => record.value.workBy.slice(0, 3).map((entry, index) => {
    const isAgent = entry.actorType === "agent";
    const short = isAgent ? (agentName(entry) || t("Provenance.an_agent")) : nameOfActor(entry.actorId);
    return {
        key: `${entry.actorId}-${entry.agentId || ""}-${index}`,
        name: labelOf(entry),
        isAgent,
        initials: initialsOf(short) || "?"
    };
}));

/* "Ken via Claude Code · checked Ava · closed Priya" — only the parts the
 * record actually holds. */
const lineParts = computed(() => {
    const parts = [];
    const worked = record.value.workBy.slice(0, 2).map(labelOf).join(t("Provenance.work_join"));
    if (worked) parts.push({ text: worked });
    if (record.value.checkedBy) parts.push({ text: t("Provenance.checked_by", { name: nameOfActor(record.value.checkedBy.actorId) }) });
    else if (badge.value === BADGES.UNCHECKED) parts.push({ text: t("Provenance.not_checked"), strong: true });
    if (record.value.closedBy) parts.push({ text: t("Provenance.closed_by", { name: nameOfActor(record.value.closedBy.actorId) }) });
    return parts;
});

onMounted(() => {
    if (record.value.workBy.some((entry) => entry.actorType === "agent" && entry.agentId)) ensureAgents();
});
</script>
