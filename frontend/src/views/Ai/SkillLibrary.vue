<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('Ai.skills') }}</div>
            </div>
            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('Ai.skills_library_lead') }}</p>

                <div v-if="loading" class="ah-empty">{{ $t('Ai.loading') }}</div>
                <EmptyState v-else-if="loadError" :title="$t('Ai.load_failed')" :message="loadError" :action-label="$t('Ai.retry')" @action="load" />
                <EmptyState v-else-if="!actions.length" :title="$t('Ai.no_actions_title')" :message="$t('Ai.no_actions_body')" />

                <div v-else class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('Ai.available_actions') }}</div>
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
                    <p class="ai-lead" style="margin:6px 0 10px">{{ $t('Ai.never_note') }}</p>
                    <div class="ai-agent__skills">
                        <span v-for="key in never" :key="key" class="ah-chip ah-chip--danger ah-chip--mono">{{ key }}</span>
                    </div>
                </div>

                <div v-if="!loading && !loadError" class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('Ai.cli_agents') }}</div>
                    <p class="ai-lead" style="margin:6px 0 10px">{{ $t('Ai.cli_lead') }}</p>
                    <pre class="ai-code">{{ cliCommand }}</pre>
                    <p class="ah-small">{{ $t('Ai.cli_tools', { tools: mcpTools }) }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import EmptyState from "@/components/atom/EmptyState/EmptyState.vue";
import AiSidebar from "./AiSidebar.vue";
import { useAgents, reasonOf } from "./useAgents";
import { mcpAddCommand } from "./mcpUrl";
import { apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "SkillLibraryPage" });

const companyId = inject("$companyId");
const { registryManifest, loadRegistry } = useAgents();
const mcp = ref({ tools: [] });
const loading = ref(true);
const loadError = ref("");

const actions = computed(() => registryManifest.value.actions || []);
const never = computed(() => registryManifest.value.never || []);
const mcpTools = computed(() => (mcp.value.tools || []).map((t) => t.name).join(", "));
const cliCommand = computed(() => mcpAddCommand(companyId.value));

const riskChip = (risk) => (risk === "high" ? "ah-chip--danger" : risk === "medium" ? "ah-chip--warn" : "ah-chip--ok");

const load = async () => {
    loading.value = true;
    loadError.value = "";
    try {
        await loadRegistry();
        const res = await apiRequestWithoutCompnay("get", env.MCP_MANIFEST).catch(() => null);
        if (res?.data?.status) mcp.value = res.data.data;
    } catch (error) {
        loadError.value = reasonOf(error, "Ai.load_failed");
    } finally {
        loading.value = false;
    }
};

onMounted(load);
</script>

<style>
@import "./style.css";
.ai-table { width: 100%; border-collapse: collapse; margin-top: 10px; font: var(--text-small); }
.ai-table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--hairline); }
.ai-table td { padding: 9px 10px; border-bottom: 1px solid var(--hairline); vertical-align: top; color: var(--ink); }
.ai-table tr:last-child td { border-bottom: 0; }
.ai-code { font: 400 12px/1.6 var(--font-mono); background: var(--rail); color: #fff; padding: 12px 14px; border-radius: var(--r-input); overflow-x: auto; margin: 0 0 10px; }
</style>
