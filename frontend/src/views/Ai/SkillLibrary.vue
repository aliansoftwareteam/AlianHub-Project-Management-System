<template>
    <div class="ah-page ai-page">
        <AiSidebar />
        <div class="ai-page__main">
            <div class="ah-toolbar">
                <div class="ah-toolbar__title">{{ $t('AiV2.skills') }}</div>
            </div>
            <div class="ai-page__body ah-scroll">
                <p class="ai-lead">{{ $t('AiV2.skills_library_lead') }}</p>

                <div class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('AiV2.available_actions') }}</div>
                    <table class="ai-table">
                        <thead>
                            <tr>
                                <th>{{ $t('AiV2.action') }}</th>
                                <th>{{ $t('AiV2.what_it_does') }}</th>
                                <th>{{ $t('AiV2.risk') }}</th>
                                <th>{{ $t('AiV2.undoable') }}</th>
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
                                <td><span class="ah-chip" :class="action.undoable ? 'ah-chip--ok' : ''">{{ action.undoable ? $t('AiV2.yes') : $t('AiV2.no') }}</span></td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('AiV2.never_available') }}</div>
                    <p class="ai-lead" style="margin:6px 0 10px">{{ $t('AiV2.never_note') }}</p>
                    <div class="ai-agent__skills">
                        <span v-for="key in never" :key="key" class="ah-chip ah-chip--danger ah-chip--mono">{{ key }}</span>
                    </div>
                </div>

                <div class="ah-card ai-agent">
                    <div class="ah-label">{{ $t('AiV2.cli_agents') }}</div>
                    <p class="ai-lead" style="margin:6px 0 10px">{{ $t('AiV2.cli_lead') }}</p>
                    <pre class="ai-code">{{ cliCommand }}</pre>
                    <p class="ah-small">{{ $t('AiV2.cli_tools', { tools: mcpTools }) }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import AiSidebar from "./AiSidebar.vue";
import { useAgents } from "./useAgents";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

defineOptions({ name: "SkillLibraryPage" });

const { registryManifest, loadRegistry } = useAgents();
const mcp = ref({ tools: [] });

const actions = computed(() => registryManifest.value.actions || []);
const never = computed(() => registryManifest.value.never || []);
const mcpTools = computed(() => (mcp.value.tools || []).map((t) => t.name).join(", "));
const cliCommand = computed(() => `claude mcp add alianhub --transport http ${env.API_URI}/mcp \\\n  --header "Authorization: Bearer <your token>"`);

const riskChip = (risk) => (risk === "high" ? "ah-chip--danger" : risk === "medium" ? "ah-chip--warn" : "ah-chip--ok");

onMounted(async () => {
    await loadRegistry();
    const res = await apiRequest("get", "/mcp/manifest").catch(() => null);
    if (res?.data?.status) mcp.value = res.data.data;
});
</script>

<style>
@import "./style.css";
.ai-table { width: 100%; border-collapse: collapse; margin-top: 10px; font: var(--text-small); }
.ai-table th { text-align: left; font: var(--text-label); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); padding: 6px 10px; border-bottom: 1px solid var(--hairline); }
.ai-table td { padding: 9px 10px; border-bottom: 1px solid var(--hairline); vertical-align: top; color: var(--ink); }
.ai-table tr:last-child td { border-bottom: 0; }
.ai-code { font: 400 12px/1.6 var(--font-mono); background: var(--rail); color: #fff; padding: 12px 14px; border-radius: var(--r-input); overflow-x: auto; margin: 0 0 10px; }
</style>
