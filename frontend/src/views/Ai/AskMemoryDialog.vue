<template>
    <Teleport to="body">
        <div class="amd-backdrop" @click.self="$emit('close')">
            <div
                ref="box"
                class="ah-card amd"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                :aria-describedby="leadId"
                tabindex="-1"
                data-test="ask-memory-dialog"
                @keydown.esc.stop.prevent="$emit('close')"
            >
                <div class="amd__head">
                    <span :id="titleId" class="ah-h3 amd__title">{{ $t('AskMemory.title') }}</span>
                    <button ref="closer" type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('AskMemory.close')" data-test="memory-close" @click="$emit('close')">
                        <ShellIcon name="x" :size="15" />
                    </button>
                </div>

                <div class="amd__body">
                    <p :id="leadId" class="ah-small amd__lead">{{ $t('AskMemory.lead') }}</p>
                    <p v-if="loadError" class="ah-field__error" role="alert">{{ loadError }}</p>
                    <p v-else-if="!loaded" class="ah-small">{{ $t('AskMemory.loading') }}</p>

                    <template v-else>
                        <div class="amd__switch">
                            <AhSwitch v-model="form.enabled" :label="$t('AskMemory.use_label')" data-test="memory-enabled" />
                            <span class="amd__switch-text">
                                <span class="amd__strong">{{ $t('AskMemory.use_label') }}</span>
                                <span class="ah-small">{{ form.enabled ? $t('AskMemory.use_on') : $t('AskMemory.use_off') }}</span>
                            </span>
                        </div>

                        <div class="amd__row">
                            <div class="ah-field">
                                <label class="ah-field__label" :for="`${uid}-nick`">{{ $t('AskMemory.nickname') }}</label>
                                <input :id="`${uid}-nick`" v-model="form.nickname" type="text" class="ah-input" :maxlength="limits.nickname" :placeholder="$t('AskMemory.nickname_hint')" data-test="memory-nickname" />
                            </div>
                            <div class="ah-field">
                                <label class="ah-field__label" :for="`${uid}-role`">{{ $t('AskMemory.role') }}</label>
                                <input :id="`${uid}-role`" v-model="form.role" type="text" class="ah-input" :maxlength="limits.role" :placeholder="$t('AskMemory.role_hint')" data-test="memory-role" />
                            </div>
                        </div>

                        <div class="ah-field">
                            <label class="ah-field__label" :for="`${uid}-prefs`">{{ $t('AskMemory.preferences') }}</label>
                            <textarea :id="`${uid}-prefs`" v-model="form.preferences" class="ah-input ah-textarea" :maxlength="limits.preferences" :placeholder="$t('AskMemory.preferences_hint')" data-test="memory-preferences"></textarea>
                        </div>

                        <fieldset class="amd__facts">
                            <legend class="ah-field__label">{{ $t('AskMemory.facts_title') }}</legend>
                            <p class="ah-small">{{ $t('AskMemory.facts_count', { n: form.facts.length, max: limits.facts }) }}</p>
                            <p v-if="!form.facts.length" class="ah-small">{{ $t('AskMemory.facts_empty') }}</p>
                            <ul v-else class="amd__fact-list">
                                <li v-for="(fact, i) in form.facts" :key="fact.key" class="amd__fact" data-test="memory-fact">
                                    <input v-model="fact.text" type="text" class="ah-input" :maxlength="limits.fact" :aria-label="$t('AskMemory.fact_label', { n: i + 1 })" />
                                    <span v-if="fact.source === 'import'" class="ah-chip">{{ $t('AskMemory.fact_imported') }}</span>
                                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :aria-label="$t('AskMemory.fact_delete', { text: fact.text })" data-test="memory-fact-delete" @click="removeFact(i)">
                                        <ShellIcon name="trash" :size="13" />
                                    </button>
                                </li>
                            </ul>
                            <div class="amd__fact-add">
                                <input v-model="newFact" type="text" class="ah-input" :maxlength="limits.fact" :aria-label="$t('AskMemory.fact_new')" :placeholder="$t('AskMemory.fact_new_hint')" data-test="memory-new-fact" @keydown.enter.prevent="addFact" />
                                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="!newFact.trim() || form.facts.length >= limits.facts" data-test="memory-add-fact" @click="addFact">
                                    <ShellIcon name="plus" :size="13" />{{ $t('AskMemory.fact_add') }}
                                </button>
                            </div>
                        </fieldset>

                        <AskMemoryImport :limit="limits.importText" @imported="mergeImported" />

                        <div class="amd__foot">
                            <template v-if="confirmingForget">
                                <span class="ah-small">{{ $t('AskMemory.forget_confirm_text') }}</span>
                                <button type="button" class="ah-btn ah-btn--danger ah-btn--sm" :disabled="busy" data-test="memory-forget-confirm" @click="forget">{{ $t('AskMemory.forget_confirm') }}</button>
                                <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="memory-forget-cancel" @click="confirmingForget = false">{{ $t('AskMemory.cancel') }}</button>
                            </template>
                            <button v-else type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" data-test="memory-forget" @click="confirmingForget = true">{{ $t('AskMemory.forget') }}</button>
                            <span class="ah-toolbar__spacer"></span>
                            <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-test="memory-save" @click="save">{{ busy ? $t('AskMemory.saving') : $t('AskMemory.save') }}</button>
                        </div>
                        <p class="ah-small amd__status" aria-live="polite" data-test="memory-status">{{ status }}</p>
                        <p v-if="saveError" class="ah-field__error" role="alert">{{ saveError }}</p>
                    </template>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { onMounted, reactive, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import { useFocusTrap } from "@/composable/useFocusTrap";
import AskMemoryImport from "./AskMemoryImport.vue";
import { memoryErrorKey } from "./askMemory";

defineOptions({ name: "AskMemoryDialog" });
defineEmits(["close"]);

const { t } = useI18n();
const uid = `ask-memory-${useId()}`;
const titleId = `${uid}-title`;
const leadId = `${uid}-lead`;
const box = ref(null);
const closer = ref(null);

const limits = reactive({ nickname: 60, role: 120, preferences: 1000, fact: 280, facts: 50, importText: 20000 });
const form = reactive({ enabled: true, nickname: "", role: "", preferences: "", facts: [] });
const saved = ref({ preferences: "" });
const deleted = new Set();
const loaded = ref(false);
const loadError = ref("");
const saveError = ref("");
const status = ref("");
const busy = ref(false);
const newFact = ref("");
const confirmingForget = ref(false);
let keySeq = 0;

useFocusTrap(box, ref(true), { returnFocus: false });

const rowOf = (fact) => ({ key: `k${keySeq += 1}`, id: fact.id || "", text: fact.text || "", source: fact.source || "manual" });

const applyProfile = (profile = {}) => {
    form.enabled = profile.enabled !== false;
    form.nickname = profile.nickname || "";
    form.role = profile.role || "";
    form.preferences = profile.preferences || "";
    form.facts = (profile.facts || []).map(rowOf);
    saved.value = { preferences: form.preferences };
    deleted.clear();
};

const errorOf = (error) => t(memoryErrorKey(error?.response?.data?.code || error?.data?.code));

const load = async () => {
    try {
        const res = await apiRequest("get", env.AI_MEMORY);
        if (!res?.data?.status) throw { data: res?.data };
        Object.assign(limits, res.data.data.limits || {});
        applyProfile(res.data.data.profile);
        loaded.value = true;
    } catch (error) {
        loadError.value = errorOf(error);
    }
};

const addFact = () => {
    const text = newFact.value.trim();
    if (!text || form.facts.length >= limits.facts) return;
    form.facts.push(rowOf({ text }));
    newFact.value = "";
};

const removeFact = (index) => {
    const [gone] = form.facts.splice(index, 1);
    if (gone?.id) deleted.add(gone.id);
};

const bodyOf = () => ({
    enabled: form.enabled,
    nickname: form.nickname.trim(),
    role: form.role.trim(),
    preferences: form.preferences.trim(),
    facts: form.facts.filter((f) => f.text.trim()).map((f) => ({ id: f.id, text: f.text.trim() }))
});

const save = async () => {
    busy.value = true;
    saveError.value = "";
    status.value = "";
    try {
        const res = await apiRequest("put", env.AI_MEMORY, bodyOf());
        if (!res?.data?.status) throw { data: res?.data };
        applyProfile(res.data.data.profile);
        const stripped = Number(res.data.data.stripped) || 0;
        status.value = stripped ? t("AskMemory.saved_stripped", { n: stripped }) : t("AskMemory.saved");
    } catch (error) {
        saveError.value = errorOf(error);
    } finally {
        busy.value = false;
    }
};

const forget = async () => {
    busy.value = true;
    saveError.value = "";
    try {
        const res = await apiRequest("delete", env.AI_MEMORY);
        if (!res?.data?.status) throw { data: res?.data };
        applyProfile(res.data.data.profile);
        confirmingForget.value = false;
        status.value = t("AskMemory.forgotten");
    } catch (error) {
        saveError.value = errorOf(error);
    } finally {
        busy.value = false;
    }
};

/* The import saved straight to the server; unsaved edits in the form stay as they are. */
const mergeImported = ({ profile, added, skipped }) => {
    const have = new Set(form.facts.map((f) => f.id).filter(Boolean));
    (profile?.facts || []).filter((f) => !have.has(f.id) && !deleted.has(f.id)).forEach((f) => form.facts.push(rowOf(f)));
    const before = new Set(saved.value.preferences.split("\n"));
    const newLines = String(profile?.preferences || "").split("\n").filter((line) => line && !before.has(line));
    if (newLines.length) form.preferences = [form.preferences, ...newLines].filter(Boolean).join("\n");
    saved.value = { preferences: profile?.preferences || "" };
    status.value = skipped ? t("AskMemory.imported_skipped", { n: added, skipped }) : t("AskMemory.imported", { n: added });
};

onMounted(async () => {
    closer.value?.focus();
    await load();
});
</script>

<style>
.amd-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; }
.amd { width: 620px; max-width: 100%; max-height: 90dvh; display: flex; flex-direction: column; border-radius: var(--r-modal); box-shadow: var(--shadow-modal); outline: none; }
.amd__head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--hairline); }
.amd__title { min-width: 0; overflow-wrap: anywhere; }
.amd__head .ah-btn { margin-left: auto; flex: none; }
.amd__body { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.amd__lead { margin: 0; }
.amd__switch { display: flex; align-items: flex-start; gap: 10px; }
.amd__switch-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.amd__strong { font: 600 13px/1.4 var(--font-ui); color: var(--ink); }
.amd__row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.amd__facts { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.amd__fact-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.amd__fact, .amd__fact-add { display: flex; align-items: center; gap: 6px; min-width: 0; }
.amd__fact .ah-input, .amd__fact-add .ah-input { flex: 1; min-width: 0; }
.amd__fact .ah-btn, .amd__fact .ah-chip, .amd__fact-add .ah-btn { flex: none; }
.amd__foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--hairline); }
.amd__status { margin: 0; min-height: 1em; }
@media (max-width: 480px) {
    .amd-backdrop { padding: 8px; align-items: stretch; }
    .amd { max-height: none; }
    .amd__row { grid-template-columns: 1fr; }
}
</style>
