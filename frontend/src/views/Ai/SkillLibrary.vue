<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.skills') }}</div>
                <div class="ah-toolbar__spacer"></div>
                <label class="sk-lib__toggle ah-small">
                    <input v-model="showRetired" type="checkbox" class="ah-check" @change="load" />
                    {{ $t('Ai.skill_show_retired') }}
                </label>
                <button v-if="canManage" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="startCreate">{{ $t('Ai.skill_new') }}</button>
            </div>
            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('Ai.skills_library_lead') }}</p>

                <div v-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <EmptyState v-else-if="loadError" :title="$t('Ai.load_failed')" :message="loadError" :action-label="$t('Ai.retry')" @action="load" />
                <EmptyState v-else-if="!skills.length" :title="$t('Ai.no_skills_title')" :message="$t('Ai.no_skills_body')" />

                <div v-else class="ai-grid">
                    <div v-for="skill in skills" :key="skill.key" class="ah-card ai-agent sk-lib__card" :class="{ 'sk-lib__card--off': skill.retiredAt || skill.enabled === false }">
                        <div class="ai-agent__top">
                            <div class="ai-agent__id">
                                <div class="ai-agent__name">
                                    <strong>{{ skill.name }}</strong>
                                    <span class="ah-chip ah-chip--mono ah-chip--sm">{{ skill.key }}</span>
                                    <span class="ah-chip ah-chip--sm" :class="skill.source === 'data' ? 'ah-chip--brand' : ''">
                                        {{ skill.source === 'data' ? $t('Ai.skill_source_yours') : $t('Ai.skill_source_builtin') }}
                                    </span>
                                    <span class="ah-chip ah-chip--sm" :class="riskChip(skill.risk)">{{ $t('Ai.risk') }}: {{ skill.risk }}</span>
                                    <span v-if="skill.retiredAt" class="ah-chip ah-chip--sm ah-chip--danger">{{ $t('Ai.skill_retired') }}</span>
                                    <span v-else-if="skill.enabled === false" class="ah-chip ah-chip--sm">{{ $t('Ai.off') }}</span>
                                    <span v-if="skill.unavailable" class="ah-chip ah-chip--sm ah-chip--warn">{{ $t('Ai.skill_unavailable') }}</span>
                                </div>
                                <p class="ai-agent__scope">{{ skill.description || $t('Ai.skill_no_description') }}</p>
                            </div>
                        </div>

                        <p v-if="skill.unavailable" class="ah-small sk-lib__needs">{{ skill.unavailable.reason }}</p>
                        <p class="ah-small sk-lib__needs">{{ $t('Ai.skill_needs', { what: $t(`Ai.req_${skill.requires ? skill.requires.code : 'task'}`) }) }}</p>

                        <div class="ai-agent__skills">
                            <span v-for="action in skill.emits" :key="action" class="ah-chip ah-chip--mono ah-chip--sm">{{ action }}</span>
                        </div>

                        <div class="ai-agent__foot">
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="startDryRun(skill)">{{ $t('Ai.skill_dry_run') }}</button>
                            <button v-if="canManage && skill.source === 'data'" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="startEdit(skill)">{{ $t('Ai.skill_edit') }}</button>
                            <button v-if="canManage && skill.source === 'data' && !skill.retiredAt" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="retiring = skill" >{{ $t('Ai.skill_retire') }}</button>
                            <span v-if="skill.version" class="ai-agent__trigger">v{{ skill.version }}</span>
                        </div>

                        <div v-if="retiring && retiring.key === skill.key" class="sk-lib__confirm">
                            <span class="ah-small">{{ $t('Ai.skill_retire_confirm') }}</span>
                            <div class="ah-toolbar__spacer"></div>
                            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="retiring = null">{{ $t('Ai.cancel') }}</button>
                            <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" @click="retire(skill)">{{ $t('Ai.skill_retire') }}</button>
                        </div>
                    </div>
                </div>

                <div v-if="!loading && !loadError" class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('Ai.available_actions') }}</div>
                    <p class="ai-lead sk-lib__note">{{ $t('Ai.available_actions_note') }}</p>
                    <table class="ai-table">
                        <thead>
                            <tr>
                                <th>{{ $t('Ai.action') }}</th>
                                <th>{{ $t('Ai.what_it_does') }}</th>
                                <th>{{ $t('Ai.risk') }}</th>
                                <th>{{ $t('Ai.undoable') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="action in actions" :key="action.key">
                                <td class="ah-mono">{{ action.key }}</td>
                                <td>
                                    {{ action.label }}
                                    <div v-if="action.constraint" class="ah-small">{{ action.constraint }}</div>
                                </td>
                                <td><span class="ah-chip" :class="riskChip(action.risk)">{{ action.risk }}</span></td>
                                <td><span class="ah-chip" :class="action.undoable ? 'ah-chip--ok' : ''">{{ action.undoable ? $t('Ai.yes') : $t('Ai.no') }}</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div v-if="!loading && !loadError" class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('Ai.never_available') }}</div>
                    <p class="ai-lead sk-lib__note">{{ $t('Ai.never_note') }}</p>
                    <div class="ai-agent__skills">
                        <span v-for="key in never" :key="key" class="ah-chip ah-chip--danger ah-chip--mono">{{ key }}</span>
                    </div>
                </div>

                <div v-if="!loading && !loadError" class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('Ai.cli_agents') }}</div>
                    <p class="ai-lead sk-lib__note">{{ $t('Ai.cli_lead') }}</p>
                    <pre class="ai-code">{{ cliCommand }}</pre>
                    <p class="ah-small">{{ $t('Ai.cli_tools', { tools: mcpTools }) }}</p>
                </div>
            </div>
        </div>

        <SkillEditor v-if="editing" :skill="editingDoc" :catalogues="catalogues" @close="editing = false" @saved="onSaved" />
        <RunTaskPicker
            v-if="dryRunFor"
            :title="$t('Ai.skill_dry_run_on', { name: dryRunFor.name })"
            :cta="$t('Ai.skill_dry_run')"
            :requirement-codes="[dryRunFor.requires ? dryRunFor.requires.code : 'task']"
            :busy="busy"
            :error="dryRunError"
            @close="dryRunFor = null"
            @run="runDry"
        />
        <SkillDryRunPanel v-if="dryRunResult" :result="dryRunResult" @close="dryRunResult = null" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiSidebar from "./AiSidebar.vue";
import SkillEditor from "./SkillEditor.vue";
import SkillDryRunPanel from "./SkillDryRunPanel.vue";
import RunTaskPicker from "./RunTaskPicker.vue";
import { useAgents, reasonOf } from "./useAgents";
import { useAgentAccess } from "./agentAccess";
import { mcpAddCommand } from "./mcpUrl";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "SkillLibraryPage" });

const companyId = inject("$companyId");
const { registryManifest, skillManifest, loadRegistry, loadSkills, loadCatalogues, loadSkill, retireSkill, dryRunSkill } = useAgents();
const { canManage } = useAgentAccess();

const mcp = ref({ tools: [] });
const loading = ref(true);
const busy = ref(false);
const loadError = ref("");
const showRetired = ref(false);
const catalogues = ref({});
const editing = ref(false);
const editingDoc = ref(null);
const retiring = ref(null);
const dryRunFor = ref(null);
const dryRunError = ref("");
const dryRunResult = ref(null);

const skills = computed(() => skillManifest.value || []);
const actions = computed(() => registryManifest.value.actions || []);
const never = computed(() => registryManifest.value.never || []);
const mcpTools = computed(() => (mcp.value.tools || []).map((t) => t.name).join(", "));
const cliCommand = computed(() => mcpAddCommand(companyId.value));

const riskChip = (risk) => (risk === "high" ? "ah-chip--danger" : risk === "medium" ? "ah-chip--warn" : "ah-chip--ok");

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        await Promise.all([loadRegistry(), loadSkills({ includeRetired: showRetired.value })]);
        catalogues.value = await loadCatalogues();
        const res = await apiRequestWithoutCompnay("get", env.MCP_MANIFEST).catch(() => null);
        if (res?.data?.status) mcp.value = res.data.data;
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

const startCreate = () => { editingDoc.value = null; editing.value = true; };

/* The list carries the manifest entry; the editor needs the stored document. */
const startEdit = async (skill) => {
    busy.value = true;
    try {
        editingDoc.value = await loadSkill(skill.key);
        editing.value = true;
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.load_failed");
    } finally {
        busy.value = false;
    }
};

const onSaved = async () => {
    editing.value = false;
    await loadSkills({ includeRetired: showRetired.value });
};

const retire = async (skill) => {
    busy.value = true;
    try {
        await retireSkill(skill.key);
        retiring.value = null;
        await loadSkills({ includeRetired: showRetired.value });
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.skill_retire_failed");
    } finally {
        busy.value = false;
    }
};

const startDryRun = (skill) => { dryRunError.value = ""; dryRunFor.value = skill; };

const runDry = async (task) => {
    busy.value = true;
    dryRunError.value = "";
    try {
        dryRunResult.value = await dryRunSkill(dryRunFor.value.key, { taskId: task._id });
        dryRunFor.value = null;
    } catch (error) {
        dryRunError.value = reasonOf(error, "Ai.skill_dry_run_failed");
    } finally {
        busy.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./style.css";
.sk-lib__toggle { display: flex; align-items: center; gap: 7px; }
.sk-lib__card--off { opacity: .68; }
.sk-lib__needs { margin: 8px 0 0; }
.sk-lib__note { margin: 6px 0 10px; }
.sk-lib__confirm { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--hairline); }
.ai-table { width: 100%; border-collapse: collapse; margin-top: 10px; font: var(--text-small); }
.ai-table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--hairline); }
.ai-table td { padding: 9px 10px; border-bottom: 1px solid var(--hairline); vertical-align: top; color: var(--ink); }
.ai-table tr:last-child td { border-bottom: 0; }
.ai-code { font: 400 12px/1.6 var(--font-mono); background: var(--rail); color: #fff; padding: 12px 14px; border-radius: var(--r-input); overflow-x: auto; margin: 0 0 10px; }
</style>
