<template>
    <Teleport to="body">
        <div class="aw-backdrop" @click.self="$emit('close')">
            <div class="ah-card aw rtp" role="dialog" aria-modal="true">
                <div class="aw__head">
                    <span class="ah-avatar ah-avatar--agent"><ShellIcon name="agent" :size="13" /></span>
                    <span class="ah-h3">{{ $t('Ai.run_on_task', { name: agent.name }) }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="$emit('close')"><ShellIcon name="x" :size="15" /></button>
                </div>

                <div class="aw__body">
                    <p class="ai-lead">{{ $t('Ai.run_needs_task') }}</p>
                    <ul class="rtp__reqs">
                        <li v-for="code in requirements" :key="code" class="ah-small"><ShellIcon name="info" :size="13" />{{ $t(`Ai.req_${code}`) }}</li>
                    </ul>

                    <div class="ah-field">
                        <label class="ah-field__label" for="rtp-search">{{ $t('Ai.find_task') }}</label>
                        <input id="rtp-search" ref="searchField" v-model.trim="query" type="search" class="ah-input" autocomplete="off" :placeholder="$t('Ai.find_task_hint')" @input="onInput" />
                    </div>

                    <div v-if="searching" class="ah-empty">{{ $t('Ai.loading') }}</div>
                    <div v-else-if="searchError" class="ah-field__error">{{ searchError }}</div>
                    <p v-else-if="!results.length" class="ah-empty">{{ query.length >= 2 ? $t('Ai.no_tasks_found') : $t('Ai.no_open_tasks') }}</p>
                    <div v-else class="rtp__list ah-scroll">
                        <button
                            v-for="row in results"
                            :key="row._id"
                            type="button"
                            class="ah-pop__item rtp__row"
                            :class="{ 'is-chosen': chosen && chosen._id === row._id }"
                            @click="chosen = row"
                        >
                            <span class="ah-mono">{{ row.TaskKey || '—' }}</span>
                            <span class="rtp__name">{{ row.TaskName }}</span>
                        </button>
                    </div>

                    <div v-if="error" class="ah-field__error">{{ error }}</div>
                </div>

                <div class="aw__foot">
                    <span v-if="chosen" class="ah-small">{{ chosen.TaskKey || chosen.TaskName }}</span>
                    <div class="ah-toolbar__spacer"></div>
                    <button type="button" class="ah-btn ah-btn--secondary" @click="$emit('close')">{{ $t('Ai.cancel') }}</button>
                    <button type="button" class="ah-btn ah-btn--primary" :disabled="!chosen || busy" @click="$emit('run', chosen)">
                        {{ busy ? $t('Ai.starting') : $t('Ai.run_now') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { reasonOf } from "./useAgents";
import { requirementsOf } from "./skillInputs";

defineOptions({ name: "RunTaskPicker" });

const props = defineProps({
    agent: { type: Object, required: true },
    busy: { type: Boolean, default: false },
    error: { type: String, default: "" }
});
defineEmits(["run", "close"]);

const searchField = ref(null);
const query = ref("");
const results = ref([]);
const chosen = ref(null);
const searching = ref(false);
const searchError = ref("");
let debounce = null;

const requirements = computed(() => requirementsOf(props.agent));
const scopeIds = computed(() => (props.agent.projectIds || []).map(String));
const inScope = (task) => !scopeIds.value.length || scopeIds.value.includes(String(task.ProjectID || ""));

/* Without a query the open tasks the caller can see are offered; a query goes
 * through the same search the command palette uses. Both are cut to the
 * agent's projects, because the server refuses anything outside them. */
const loadOpen = async () => {
    const single = scopeIds.value.length === 1 ? `?projectId=${encodeURIComponent(scopeIds.value[0])}` : "";
    const res = await apiRequest("get", `${env.AGENT_ROUTABLE}${single}`);
    return res?.data?.status ? (res.data.data || []) : [];
};

const search = async () => {
    const res = await apiRequest("post", env.GLOBAL_SEARCH, { query: query.value });
    return res?.data?.status ? (res.data.data?.tasks || []) : [];
};

const refresh = async () => {
    searching.value = true;
    searchError.value = "";
    try {
        const rows = query.value.length >= 2 ? await search() : await loadOpen();
        results.value = rows.filter(inScope);
        if (chosen.value && !results.value.some((r) => r._id === chosen.value._id)) chosen.value = null;
    } catch (e) {
        searchError.value = reasonOf(e, "Ai.load_failed");
        results.value = [];
    } finally {
        searching.value = false;
    }
};

const onInput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, 250);
};

onMounted(async () => {
    await refresh();
    await nextTick();
    searchField.value?.focus();
});
</script>

<style>
.rtp__reqs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.rtp__reqs li { display: flex; align-items: center; gap: 6px; color: var(--ink-2); }
.rtp__list { max-height: 280px; overflow: auto; border: 1px solid var(--hairline); border-radius: 9px; }
.rtp__row { width: 100%; text-align: left; display: flex; gap: 10px; align-items: center; }
.rtp__row.is-chosen { background: var(--brand-tint); }
.rtp__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
