<!-- =========================================================================================
    Comment : Company-managed list of project skills. Projects reference these by
    `slug`, so an entry is deactivated rather than deleted — removing it outright
    would strip the tag from projects already using it and rewrite historical
    per-skill reporting.
========================================================================================== -->
<template>
    <div class="position-re">
        <SpinnerComp :is-spinner="isSpinner" class="setting_spinner"/>
        <div>
            <h2 class="task_priority_wrapper_value">{{ $t('Settings.project_skills') }}</h2>
            <div class="mySettingSection priorityWrapper">
                <div class="overflow-hidden">
                    <p class="skills__hint font-size-13">{{ $t('Settings.project_skills_hint') }}</p>
                    <form v-if="props.editPermission" @submit.prevent="saveData">
                        <div class="vs-component vs-con-input-label vs-input inputx vs-input-primary">
                            <div class="vs-con-input">
                                <input type="text" class="vs-inputx vs-input--input normal" name="skillName"
                                    :placeholder="$t('PlaceHolder.Enter_Skill_Name')"
                                    maxlength="60"
                                    v-model.trim="skillName"
                                    @input="errorMessage = ''"/>
                                <div class="invalid-feedback red" v-if="errorMessage">{{ errorMessage }}</div>
                            </div>
                        </div>
                        <div class="d-flex">
                            <button type="submit" class="blue_btn ml-0px" id="blue_btn">{{ $t('Projects.save') }}</button>
                            <button type="button" name="button" @click="cancel()"
                                class="vs-component vs-button white_btn vs-button-primary vs-button-filled">
                                {{ $t('Projects.cancel') }}
                            </button>
                        </div>
                    </form>
                    <div class="addExtentionWrapper d-flex flex-wrap">
                        <div v-for="skill in skills" :key="skill.key">
                            <div class="con-vs-chip vs-chip-null" :class="{'skills__chip-inactive': skill.active === false}">
                                <span class="text-chip vs-chip--text">
                                    <div class="priorityWrapper d-flex align-items-center">
                                        <span class="font_family_status" :title="skill.slug">{{ skill.name }}</span>
                                        <img class="cursor-pointer" :src="cancel_icon" alt="deactivate"
                                            v-if="skill.active !== false && props.editPermission"
                                            :title="$t('Settings.deactivate_skill')"
                                            @click="confirmDeactivate(skill)"/>
                                        <span class="skills__restore blue cursor-pointer font-size-12"
                                            v-else-if="props.editPermission"
                                            @click="setActive(skill, true)">{{ $t('Settings.restore') }}</span>
                                    </div>
                                </span>
                            </div>
                        </div>
                    </div>
                    <ConfirmModal
                        :modelValue="showConfirmModal"
                        :acceptButtonText="$t('Home.Confirm')"
                        :cancelButtonText="$t('Projects.cancel')"
                        maxlength="150"
                        :header="true"
                        :showCloseIcon="false"
                        @accept="setActive(selectedSkill, false)"
                        @close="showConfirmModal = false">
                        <template #header>
                            <h3 class="m-0">{{ $t('Home.Confirm') }}</h3>
                        </template>
                        <template #body>
                            <span>{{ $t('Settings.deactivate_skill_confirm') }}</span>
                        </template>
                    </ConfirmModal>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, defineProps } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from 'vue-toast-notification';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import { apiRequest } from "@/services";
import * as env from '@/config/env';

const { t } = useI18n();
const $toast = useToast();
const { getters, commit } = useStore();

const props = defineProps({
    editPermission: {
        type: [Boolean],
        default: false
    }
});

const cancel_icon = require('@/assets/images/svg/cancel_icon.svg');
const isSpinner = ref(false);
const skillName = ref('');
const errorMessage = ref('');
const showConfirmModal = ref(false);
const selectedSkill = ref({});

const skills = computed(() => getters['settings/projectSkills']);

// Pre-check only, to catch duplicates before a round trip. The server re-derives
// the slug and is the authority.
const toSlug = (name) => String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const errorFor = (reason) => ({
    SKILL_NAME_TOO_SHORT: t('Settings.skill_name_too_short'),
    SKILL_NAME_INVALID: t('Settings.skill_name_invalid'),
    SKILL_ALREADY_EXISTS: t('Settings.skill_already_exists'),
}[reason] || t('Toast.something_went_wrong'));

async function saveData() {
    if (isSpinner.value) return;
    const name = skillName.value.trim();
    if (name.length < 2) {
        errorMessage.value = t('Settings.skill_name_too_short');
        return;
    }
    const slug = toSlug(name);
    if (!slug) {
        errorMessage.value = t('Settings.skill_name_invalid');
        return;
    }
    if (skills.value.some((s) => s.slug === slug)) {
        errorMessage.value = t('Settings.skill_already_exists');
        return;
    }
    try {
        isSpinner.value = true;
        const result = await apiRequest("put", env.SETTING_PROJECT_SKILLS, { operation: 'add', name });
        if (result.status === 200) {
            commit("settings/mutateProjectSkills", { data: result.data.skill, op: "added" });
            $toast.success(t('Toast.Skill_added_successfully'), { position: 'top-right' });
            skillName.value = '';
            errorMessage.value = '';
        } else {
            errorMessage.value = errorFor(result?.data?.message);
        }
    } catch (error) {
        errorMessage.value = errorFor(error?.response?.data?.message);
        console.error("ERROR in adding the project skill: ", error);
    } finally {
        isSpinner.value = false;
    }
}

function cancel() {
    skillName.value = '';
    errorMessage.value = '';
}

function confirmDeactivate(skill) {
    selectedSkill.value = skill;
    showConfirmModal.value = true;
}

async function setActive(skill, active) {
    if (!skill || skill.key === undefined) return;
    try {
        isSpinner.value = true;
        const result = await apiRequest("put", env.SETTING_PROJECT_SKILLS, {
            operation: 'setActive', key: skill.key, active
        });
        if (result.status === 200) {
            commit("settings/mutateProjectSkills", { data: result.data.skill, op: "modified" });
            $toast.success(t(active ? 'Toast.Skill_restored_successfully' : 'Toast.Skill_deactivated_successfully'), { position: 'top-right' });
        } else {
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    } catch (error) {
        console.error("ERROR in updating the project skill: ", error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    } finally {
        isSpinner.value = false;
        showConfirmModal.value = false;
        selectedSkill.value = {};
    }
}
</script>

<style scoped>
@import './style.css';
.skills__hint {
    color: #818181;
    margin: 0 0 12px 0;
}
.vs-con-input-label .vs-con-input {
    margin-bottom: 10px;
}
.vs-con-input-label {
    width: 250px !important;
}
.font_family_status {
    margin: 0px 0px 0px 10px !important;
}
.skills__chip-inactive {
    opacity: 0.55;
}
.skills__restore {
    margin-left: 8px;
}
@media (max-width: 480px) {
    .vs-con-input-label {
        width: 100% !important;
    }
}
</style>
