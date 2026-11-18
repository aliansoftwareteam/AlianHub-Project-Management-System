<template>
    <section class="ask-starters" :aria-label="$t('Ask.starters_label')">
        <button
            v-for="starter in STARTERS"
            :key="starter.key"
            type="button"
            class="ask-starter"
            :data-key="starter.key"
            data-test="ask-starter"
            @click="$emit('pick', starterPrompt(starter.key, { t, projectName }))"
        >
            <span class="ask-starter__icon"><ShellIcon :name="starter.icon" :size="15" /></span>
            <strong>{{ $t(`Ask.starter_${starter.key}_title`) }}</strong>
            <span>{{ starter.key === 'status' && projectName ? $t('Ask.starter_status_body_project', { project: projectName }) : $t(`Ask.starter_${starter.key}_body`) }}</span>
        </button>
    </section>
</template>

<script setup>
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { STARTERS, starterPrompt } from "./askComposer";

defineOptions({ name: "AskStarters" });

defineProps({ projectName: { type: String, default: "" } });
defineEmits(["pick"]);

const { t } = useI18n();
</script>

<style>
.ask-starters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-3); }
.ask-starter {
    display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2);
    padding: var(--sp-4); text-align: left; cursor: pointer; min-width: 0;
    border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); color: var(--ink);
    transition: border-color var(--t-state) var(--ease), background var(--t-state) var(--ease);
}
.ask-starter:hover { background: var(--surface-hover); border-color: var(--brand-border); }
.ask-starter:focus-visible { outline: none; box-shadow: var(--focus); }
.ask-starter__icon { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--brand-tint); color: var(--brand); }
.ask-starter strong { font: 600 13px/1.3 var(--font-ui); }
.ask-starter span:last-child { font: var(--text-small); color: var(--ink-2); line-height: 1.45; overflow-wrap: anywhere; }
@media (max-width: 760px) {
    .ask-starters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 340px) {
    .ask-starters { grid-template-columns: minmax(0, 1fr); }
}
</style>
