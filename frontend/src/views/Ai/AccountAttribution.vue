<template>
    <span class="attrib" :class="[`attrib--${kind}`, compact ? 'attrib--compact' : '']">
        <span class="attrib__mark">
            <span class="ah-avatar" :class="avatarClass">{{ initial }}</span>
            <span v-if="kind === 'personal'" class="attrib__badge"><ShellIcon name="agent" :size="9" /></span>
        </span>
        <span class="attrib__text">
            <span class="attrib__name">{{ name }}</span>
            <span v-if="sub" class="attrib__sub">{{ sub }}</span>
        </span>
        <span class="attrib__tag ah-mono" :class="`attrib__tag--${kind}`">{{ $t(`Accounts.tag_${kind}`) }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

// Renders one row of Modules/Agents/actor.js `attribution()` — the shape the
// audit log, the task panel and Members all store in meta. Person, tool, then
// account type, in that order, everywhere (27c).
defineOptions({ name: "AccountAttribution" });

const props = defineProps({
    attribution: { type: Object, default: () => ({}) },
    sub: { type: String, default: "" },
    compact: { type: Boolean, default: false }
});

const { t } = useI18n();

const kind = computed(() => {
    const a = props.attribution || {};
    if (a.actorType !== "agent") return "human";
    return ["personal", "workspace", "local"].includes(a.viaAccount) ? a.viaAccount : "workspace";
});

const name = computed(() => {
    const a = props.attribution || {};
    if (a.label) return a.label;
    if (kind.value === "human") return a.personName || t("Accounts.attrib_member");
    if (kind.value === "personal" && a.onBehalfOf) return t("Accounts.attrib_via", { who: a.personName || t("Accounts.attrib_member"), tool: a.agentName || a.provider || t("Accounts.attrib_agent") });
    return a.agentName || t("Accounts.attrib_agent");
});

const initial = computed(() => String(name.value || "?").trim().charAt(0).toUpperCase() || "?");

const avatarClass = computed(() => (kind.value === "workspace" || kind.value === "local" ? "ah-avatar--agent" : ""));
</script>

<style>
.attrib { display: inline-flex; align-items: center; gap: 10px; min-width: 0; width: 100%; }
.attrib__mark { position: relative; flex: none; display: inline-flex; }
.attrib__mark .ah-avatar { width: 30px; height: 30px; font-size: 11px; }
.attrib--compact .attrib__mark .ah-avatar { width: 22px; height: 22px; font-size: 9.5px; }
.attrib--human .ah-avatar { background: var(--brand); }
.attrib--personal .ah-avatar { background: var(--ok); }
.attrib--workspace .ah-avatar { background: var(--brand-tint); color: var(--brand); }
.attrib--local .ah-avatar { background: var(--ok-bg); color: var(--ok-ink); }

.attrib__badge {
    position: absolute; right: -4px; bottom: -4px;
    width: 17px; height: 17px; border-radius: 5px;
    background: var(--rail); color: #fff;
    display: grid; place-items: center;
    border: 2px solid var(--surface);
}
.attrib--compact .attrib__badge { width: 13px; height: 13px; border-radius: 4px; border-width: 1.5px; right: -3px; bottom: -3px; }

.attrib__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.attrib__name { font: 600 13px/1.3 var(--font-ui); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.attrib__sub { font: var(--text-small); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.attrib__tag {
    flex: none; font-size: 8.5px; font-weight: 600; letter-spacing: .05em;
    padding: 2px 6px; border-radius: 4px;
    background: var(--surface-hover); color: var(--ink-label);
}
.attrib__tag--workspace { background: var(--brand-tint); color: var(--brand); }
.attrib__tag--local { background: var(--ok-bg); color: var(--ok-ink); }
</style>
