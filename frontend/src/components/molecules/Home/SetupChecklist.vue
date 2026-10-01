<template>
    <section class="hc-setup" aria-labelledby="hc-setup-title">
        <div class="hc-setup__ring" :style="{ '--pct': `${Math.round(doneCount / steps.length * 100)}%` }">
            <span>{{ doneCount }}/{{ steps.length }}</span>
        </div>
        <div class="hc-setup__body">
            <div id="hc-setup-title" class="hc-setup__title">{{ title || $t('Home.setup_title', { company: companyName }) }}</div>
            <p v-if="active" class="hc-setup__next">
                <span>{{ $t('Home.setup_next') }}</span> <strong>{{ $t(active.label) }}</strong><span v-if="active.note">&nbsp;{{ $t(active.note) }}</span>
            </p>
            <button type="button" class="hc-setup__toggle" :aria-expanded="expanded ? 'true' : 'false'" aria-controls="hc-setup-steps" @click="expanded = !expanded">
                {{ expanded ? $t('Home.setup_hide_steps') : $t('Home.setup_show_steps') }}
                <ShellIcon name="chevronDown" :size="12" />
            </button>
        </div>
        <button v-if="active" type="button" class="hc-setup__cta" @click="$emit('action', active.key)">{{ $t(active.cta) }}</button>
        <button v-if="active?.alt" type="button" class="hc-setup__alt" data-test="setup-alt" @click="$emit('action', active.alt.key)">{{ $t(active.alt.label) }}</button>
        <button type="button" class="hc-setup__dismiss" @click="$emit('dismiss')">{{ $t('Home.dismiss') }}</button>
        <ol v-if="expanded" id="hc-setup-steps" class="hc-setup__steps">
            <li v-for="step in steps" :key="step.key" class="hc-setup__step" :class="{ 'is-done': step.done, 'is-active': step.key === active?.key }">
                <span v-if="step.done" class="hc-setup__mark" role="img" :aria-label="$t('Home.done')"><ShellIcon name="check" :size="13" /></span>
                <span v-else class="hc-setup__mark hc-setup__mark--todo" aria-hidden="true"></span>
                <span class="hc-setup__label">
                    <span v-if="step.done">{{ $t(step.label) }}</span>
                    <button v-else type="button" :aria-current="step.key === active?.key ? 'step' : null" @click="$emit('action', step.key)">{{ $t(step.label) }}</button>
                    <span v-if="step.note && !step.done" class="hc-setup__note">&nbsp;{{ $t(step.note) }}</span>
                </span>
            </li>
        </ol>
        <p v-if="sample" class="hc-setup__sample">
            <span>{{ $t('Home.sample_note') }}</span>
            <button type="button" data-test="setup-remove-sample" @click="$emit('action', 'remove_sample')">{{ $t('Home.remove_sample') }}</button>
        </p>
        <WorkspaceImportDialog v-if="workspaceImport.open" @close="closeWorkspaceImport" @imported="markImported" />
    </section>
</template>

<script setup>
import { computed, defineAsyncComponent, defineEmits, defineProps, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { workspaceImport, closeWorkspaceImport } from "@/components/organisms/WorkspaceImport/workspaceImportState";
import { saveOnboarding } from "@/composable/onboardingState";
import "./style.css";

const WorkspaceImportDialog = defineAsyncComponent(() => import("@/components/organisms/WorkspaceImport/WorkspaceImportDialog.vue"));

defineOptions({ name: "SetupChecklist" });

const props = defineProps({
    companyName: { type: String, default: "" },
    title: { type: String, default: "" },
    steps: { type: Array, default: () => [] },
    sample: { type: Boolean, default: false }
});
defineEmits(["action", "dismiss"]);

const expanded = ref(true);
const doneCount = computed(() => props.steps.filter((s) => s.done).length);
const active = computed(() => props.steps.find((s) => !s.done) || null);
const markImported = () => saveOnboarding({ importedWork: true });
</script>
