<template>
    <Sidebar themed :title="$t('Shell.new_workspace')" :visible="visible" width="460px" @update:visible="close">
        <template #body>
            <div class="cws" data-test="create-workspace-sidebar">
                <div v-if="creating" class="cws__progress" role="status">
                    <strong>{{ form.name }}</strong>
                    <p class="ah-small">{{ statusText }}</p>
                    <div class="cws__bar"><div class="cws__bar-fill" :style="{ width: progress + '%' }"></div></div>
                    <p class="ah-small ah-mono">{{ progress }}%</p>
                </div>

                <form v-else novalidate @submit.prevent="submit">
                    <p class="ah-small cws__lead">{{ $t('Shell.new_workspace_lead') }}</p>
                    <p v-if="room && room.limit !== null" class="ah-small" data-test="workspace-count">{{ $t('Plan.workspaces_count', { count: room.count, limit: room.limit }) }}</p>
                    <div v-if="atLimit" class="cws__note cws__note--warn" role="alert" data-test="workspace-limit">
                        <span>{{ $t('Plan.workspace_limit_reached', { limit: room.limit }) }}</span>
                        <a v-if="room.portalUrl" :href="room.portalUrl" target="_blank" rel="noopener">{{ $t('Plan.banner.add_workspaces') }}</a>
                    </div>
                    <div v-if="banner" class="cws__note cws__note--danger" role="alert"><ShellIcon name="alert" :size="15" /><span>{{ banner }}</span></div>

                    <fieldset :disabled="atLimit" class="cws__fields">
                        <div class="ah-field">
                            <label class="ah-field__label" for="cws-name">{{ $t('Setup.company') }}</label>
                            <input
                                id="cws-name"
                                ref="nameInput"
                                v-model.trim="form.name"
                                type="text"
                                class="ah-input"
                                :class="{ 'ah-input--error': nameErr }"
                                maxlength="60"
                                autocomplete="organization"
                                :placeholder="$t('Auth.workspace_placeholder')"
                                :aria-invalid="!!nameErr"
                                @input="nameErr = ''"
                            />
                            <div v-if="nameErr" class="ah-field__error"><ShellIcon name="x" :size="12" />{{ nameErr }}</div>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="cws-size">{{ $t('Auth.team_size') }}</label>
                            <select id="cws-size" v-model="form.teamSize" class="ah-input">
                                <option v-for="size in TEAM_SIZES" :key="size.value" :value="size.value">{{ size.label }}</option>
                            </select>
                        </div>
                        <div class="ah-field">
                            <label class="ah-field__label" for="cws-focus">{{ $t('Setup.focus') }}</label>
                            <select id="cws-focus" v-model="form.focus" class="ah-input">
                                <option value="">{{ $t('Setup.focus_unsure') }}</option>
                                <option v-for="f in FOCUSES" :key="f" :value="f">{{ $t(`Auth.focus_${f}`) }}</option>
                            </select>
                            <span class="ah-field__hint">{{ $t('Setup.focus_hint') }}</span>
                        </div>
                        <label class="cws__toggle">
                            <input v-model="form.sample" type="checkbox" class="ah-check" />
                            <span>
                                <strong>{{ $t('Setup.sample_title') }}</strong>
                                <span class="ah-small">{{ $t('Setup.sample_hint') }}</span>
                            </span>
                        </label>
                    </fieldset>

                    <div class="cws__actions">
                        <button type="button" class="ah-btn ah-btn--secondary" @click="close(false)">{{ $t('Common.cancel') }}</button>
                        <button type="submit" class="ah-btn ah-btn--primary" :disabled="atLimit" data-test="create-workspace-submit">{{ $t('Setup.create') }}</button>
                    </div>
                </form>
            </div>
        </template>
    </Sidebar>
</template>

<script setup>
import { computed, inject, nextTick, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useGetterFunctions } from "@/composable";
import { useCreateWorkspace } from "@/composable/useCreateWorkspace";

const props = defineProps({ visible: { type: Boolean, default: false } });
const emit = defineEmits(["update:visible"]);

const { t } = useI18n();
const userId = inject("$userId");
const { getUser } = useGetterFunctions();
const { room, progress, statusText, banner, loadRoom, nameError, create } = useCreateWorkspace(userId);

const TEAM_SIZES = [
    { value: "1", label: t("Auth.size_just_me") },
    { value: "2-15", label: "2–15" },
    { value: "16-50", label: "16–50" },
    { value: "50+", label: "50+" }
];
const FOCUSES = ["software", "design", "marketing", "agency", "operations", "support", "other"];

const form = reactive({ name: "", teamSize: "2-15", focus: "", sample: true });
const nameErr = ref("");
const creating = ref(false);
const nameInput = ref(null);
const atLimit = computed(() => Boolean(room.value && !room.value.canCreate));

// Each opening reads the plan afresh: a workspace made or removed elsewhere changes the room.
watch(() => props.visible, (open) => {
    if (!open) return;
    Object.assign(form, { name: "", teamSize: "2-15", focus: "", sample: true });
    nameErr.value = "";
    banner.value = "";
    loadRoom().then(() => nextTick(() => nameInput.value?.focus()));
}, { immediate: true });

const close = (open) => {
    if (creating.value) return;
    emit("update:visible", open);
};

const submit = async () => {
    nameErr.value = nameError(form.name);
    if (nameErr.value || atLimit.value) return;
    creating.value = true;
    const opened = await create({
        name: form.name,
        teamSize: form.teamSize,
        // A sample project needs a focus to pick from; "Not sure yet" gets the general one.
        teamFocus: form.focus || "other",
        withSample: form.sample,
        email: getUser(userId.value)?.Employee_Email || ""
    });
    if (!opened) creating.value = false;
};
</script>

<style scoped>
.cws { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.cws__lead { margin: 0 0 12px; color: var(--ink-2); }
.cws__fields { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.cws__fields:disabled { opacity: .55; }
.cws__note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; padding: 10px 12px; border-radius: var(--r-input); font: var(--text-small); }
.cws__note a { color: inherit; font-weight: 600; text-decoration: underline; }
.cws__note--warn { background: var(--warn-bg); color: var(--warn-ink); }
.cws__note--danger { background: var(--danger-bg); color: var(--danger-ink); }
.cws__toggle { display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: var(--r-input); cursor: pointer; }
.cws__toggle > span { display: flex; flex-direction: column; gap: 2px; }
.cws__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.cws__progress { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.cws__bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.cws__bar-fill { height: 100%; background: var(--brand); transition: width .3s ease; }
</style>
