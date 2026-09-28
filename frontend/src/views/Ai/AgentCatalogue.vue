<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw ac" role="dialog" aria-modal="true" aria-labelledby="ac-title" @keydown.esc.stop="$emit('close')">
                <div class="aw__head">
                    <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                    <span id="ac-title" class="ah-h3">{{ $t('Ai.new_agent') }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('AgentCatalogue.close')" @click="$emit('close')"><ShellIcon name="x" :size="15" /></button>
                </div>

                <div class="aw__body">
                    <section v-if="builderOpen" class="ac-builder">
                        <label class="ah-field__label" for="ac-describe">{{ $t('AgentCatalogue.builder_title') }}</label>
                        <textarea
                            id="ac-describe"
                            ref="describeField"
                            v-model="description"
                            data-test="builder-input"
                            class="ah-input ah-textarea"
                            maxlength="1000"
                            :placeholder="$t('AgentCatalogue.builder_placeholder')"
                            aria-describedby="ac-describe-hint"
                            @keydown.enter.ctrl.prevent="draft"
                            @keydown.enter.meta.prevent="draft"
                        ></textarea>
                        <div class="ac-builder__row">
                            <span id="ac-describe-hint" class="ah-field__hint">{{ $t('AgentCatalogue.builder_hint') }}</span>
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" data-test="builder-draft" :disabled="drafting || !canDraft" @click="draft">
                                {{ drafting ? $t('AgentCatalogue.builder_drafting') : $t('AgentCatalogue.builder_draft') }}
                            </button>
                        </div>
                        <div v-if="draftError" class="ah-field__error" role="alert">{{ draftError }}</div>
                    </section>
                    <p v-else class="ah-small ac-builder__off" data-test="builder-off">{{ builderOffText }}</p>

                    <div class="ac-browse">
                        <label class="ah-field__label" for="ac-search">{{ $t('AgentCatalogue.templates_title') }}</label>
                        <input id="ac-search" ref="searchField" v-model="query" data-test="catalogue-search" type="search" class="ah-input" :placeholder="$t('AgentCatalogue.search_placeholder')" />
                        <div class="ac-chips" role="group" :aria-label="$t('AgentCatalogue.categories')">
                            <button
                                v-for="option in categoryOptions"
                                :key="option.key || 'all'"
                                type="button"
                                class="ah-chip ac-chip"
                                :class="{ 'ac-chip--on': category === option.key }"
                                data-test="catalogue-chip"
                                :data-category="option.key"
                                :aria-pressed="category === option.key ? 'true' : 'false'"
                                @click="category = option.key"
                            >{{ option.label }}</button>
                        </div>
                    </div>

                    <p v-if="!shown.length" class="ah-empty">{{ $t('AgentCatalogue.no_match') }}</p>
                    <div v-else class="ac-grid">
                        <article v-for="tpl in shown" :key="tpl.slug" class="ac-card" :class="{ 'ac-card--blocked': blockOf(tpl, skillManifest) }" data-test="catalogue-card" :data-slug="tpl.slug">
                            <div class="ac-card__head">
                                <strong class="ac-card__name">{{ templateName(t, tpl) }}</strong>
                                <span class="ah-chip ah-chip--agent" :title="autonomyTip(t, tpl.autonomy)">{{ autonomyName(t, tpl.autonomy) }}</span>
                            </div>
                            <p class="ac-card__about">{{ templateAbout(t, tpl) }}</p>
                            <div v-if="tpl.skills.length" class="ac-card__skills">
                                <span v-for="key in tpl.skills" :key="key" class="ah-chip" :title="skillAbout(t, key)">{{ skillLabel(t, key) }}</span>
                            </div>
                            <p v-if="tpl.cadence" class="ah-small ac-card__line" data-test="catalogue-schedule">
                                <ShellIcon name="clock" :size="12" />{{ $t(`AgentCatalogue.cadence_${tpl.cadence}`) }} · {{ $t('AgentCatalogue.schedule_later') }}
                            </p>
                            <p v-if="needsOf(tpl).length" class="ah-small ac-card__line" data-test="catalogue-needs">{{ $t('Ai.needs_line', { what: needsOf(tpl).join(' · ') }) }}</p>
                            <p v-if="blockOf(tpl, skillManifest)" class="ah-small ac-card__blocked">{{ $t(`AgentCatalogue.blocked_${blockOf(tpl, skillManifest)}`) }}</p>
                            <div class="ac-card__foot">
                                <button
                                    type="button"
                                    class="ah-btn ah-btn--secondary ah-btn--sm"
                                    data-test="catalogue-use"
                                    :disabled="Boolean(blockOf(tpl, skillManifest))"
                                    :aria-label="$t('AgentCatalogue.use_named', { name: templateName(t, tpl) })"
                                    @click="$emit('pick', templateToPrefill(t, tpl))"
                                >{{ $t('AgentCatalogue.use') }}</button>
                            </div>
                        </article>
                    </div>
                </div>

                <div class="aw__foot">
                    <div class="ah-toolbar__spacer"></div>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Ai.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--ghost" data-test="start-blank" @click="$emit('pick', null)">{{ $t('AgentCatalogue.start_blank') }}</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { aiAvailability, AI_STATE } from "@/composable/aiAvailability";
import { useAgents } from "./useAgents";
import { autonomyName, autonomyTip, skillAbout, skillLabel } from "./plainLabels";
import { requirementsOf, indexSkills } from "./skillInputs";
import { CATALOGUE_CATEGORIES, CATALOGUE_TEMPLATES, blockOf, draftToPrefill, filterTemplates, templateAbout, templateName, templateToPrefill } from "./agentCatalogue";

defineOptions({ name: "AgentCatalogue" });

const emit = defineEmits(["close", "pick"]);

const MIN_DESCRIPTION = 12;

const { t } = useI18n();
const { skillManifest, loadSkills, draftAgent } = useAgents();

const query = ref("");
const category = ref("");
const description = ref("");
const drafting = ref(false);
const draftError = ref("");
const describeField = ref(null);
const searchField = ref(null);

const categoryOptions = computed(() => [
    { key: "", label: t("AgentCatalogue.category_all") },
    ...CATALOGUE_CATEGORIES.map((key) => ({ key, label: t(`AgentCatalogue.category_${key}`) }))
]);

const shown = computed(() => filterTemplates(t, CATALOGUE_TEMPLATES, { query: query.value, category: category.value }));

const NO_BUILDER = Object.freeze({
    [AI_STATE.OFF_INSTANCE]: "AgentCatalogue.builder_off",
    [AI_STATE.OFF_WORKSPACE]: "AgentCatalogue.builder_off",
    [AI_STATE.UNCONFIGURED]: "AgentCatalogue.builder_no_model"
});
const builderOpen = computed(() => !NO_BUILDER[aiAvailability.state]);
const builderOffText = computed(() => t(NO_BUILDER[aiAvailability.state] || "AgentCatalogue.builder_off"));
const canDraft = computed(() => description.value.trim().length >= MIN_DESCRIPTION);

const skillIndex = computed(() => indexSkills(skillManifest.value));
const needsOf = (tpl) => [
    ...(tpl.skills.length ? requirementsOf({ skills: tpl.skills }, skillIndex.value).map((code) => t(`Ai.req_${code}`)) : []),
    ...tpl.needs.map((code) => t(`AgentCatalogue.need_${code}`))
];

const draft = async () => {
    if (drafting.value || !canDraft.value) return;
    drafting.value = true;
    draftError.value = "";
    try {
        emit("pick", draftToPrefill(await draftAgent(description.value.trim())));
    } catch (error) {
        draftError.value = error.message;
    } finally {
        drafting.value = false;
    }
};

onMounted(async () => {
    await nextTick();
    (builderOpen.value ? describeField.value : searchField.value)?.focus();
    loadSkills().catch(() => []);
});
</script>

<style>
@import "./style.css";
.ac { width: 760px; }
.ac-builder { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface-2); }
.ac-builder__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-builder__row .ah-btn { margin-left: auto; }
.ac-builder__off { margin: 0; color: var(--ink-2); }
.ac-browse { display: flex; flex-direction: column; gap: 8px; }
.ac-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ac-chip { cursor: pointer; border: 1px solid var(--hairline); }
.ac-chip:focus-visible { outline: none; box-shadow: var(--focus); }
.ac-chip--on { background: var(--brand-tint); color: var(--brand); border-color: var(--brand); }
.ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.ac-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--surface); min-width: 0; }
.ac-card--blocked { background: var(--surface-2); }
.ac-card__head { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.ac-card__name { flex: 1; min-width: 0; color: var(--ink); }
.ac-card__about { margin: 0; font: var(--text-small); color: var(--ink-2); }
.ac-card__skills { display: flex; flex-wrap: wrap; gap: 4px; }
.ac-card__line { display: flex; align-items: center; gap: 4px; margin: 0; color: var(--ink-2); }
.ac-card__blocked { margin: 0; color: var(--warn-ink); }
.ac-card__foot { margin-top: auto; padding-top: 4px; display: flex; }
@media (max-width: 480px) {
    .ac-grid { grid-template-columns: 1fr; }
    .ac-builder__row .ah-btn { margin-left: 0; width: 100%; }
}
</style>
