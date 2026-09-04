<template>
    <div v-if="checkPermission('settings.settings_team_list') !== null" class="tm">
        <div v-if="!currentCompany.planFeature?.team">
            <UpgradePlan
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('Upgrades.to_unlock_team')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />
        </div>
        <template v-else>
            <div class="tm__head">
                <h2 class="ah-h3 tm__title">{{ $t('Filters.teams') }}</h2>
                <span class="ah-label">{{ teams.length }} · {{ $t('Settings.people_count', { n: peopleCount }) }}</span>
            </div>

            <div v-if="!teams.length" class="ah-empty">{{ $t('Settings.teams_empty') }}</div>

            <div v-else class="tm__grid">
                <div v-for="row in teams" :key="row._id" class="ah-card tm__card">
                    <div class="tm__card-head">
                        <div class="tm__mark-wrap" tabindex="0" @blur="row.isPopupOpen = false">
                            <button
                                type="button"
                                class="tm__mark"
                                :style="{ color: row.teamColor?.color || '#fff', background: row.teamColor?.bgColor || 'var(--brand)' }"
                                :aria-label="$t('Settings.team_color')"
                                :disabled="editPermission !== true"
                                @click="row.isPopupOpen = !row.isPopupOpen"
                            >{{ row.name.charAt(0).toUpperCase() }}</button>
                            <div v-if="row.isPopupOpen && editPermission === true" class="ah-pop tm__colors">
                                <button v-for="color in colors" :key="color" type="button" class="tm__swatch" :class="{ 'is-active': color === row.teamColor?.bgColor }" :style="{ background: color }" :aria-label="color" @mousedown.prevent="setColor(row, color)"></button>
                            </div>
                        </div>
                        <div class="tm__name-wrap">
                            <template v-if="row.isEdit && editPermission === true">
                                <input class="ah-input tm__name-input" v-model.trim="existingValue" :aria-label="$t('Settings.team_name')" @keydown.enter.prevent="saveTeamName(row)" @keydown.esc="row.isEdit = false" @blur="row.isEdit = false" v-focus />
                            </template>
                            <button v-else type="button" class="tm__name" :disabled="editPermission !== true" @click="openInput(row)">{{ row.name }}</button>
                            <div class="ah-small">{{ $t('Settings.people_count', { n: (row.assigneeUsersArray || []).length }) }}</div>
                        </div>
                    </div>
                    <Assignee
                        class="tm__assignee"
                        :users="row.assigneeUsersArray"
                        :options="users.map((x) => x.userId)"
                        :imageWidth="'26px'"
                        :showDot="false"
                        :addUser="editPermission"
                        :isDisplayTeam="false"
                        :allowGhost="true"
                        @selected="changeAssignee('add', $event, row)"
                        @removed="changeAssignee('remove', $event, row)"
                    />
                    <div v-if="nameError[row._id]" class="ah-field__error">{{ nameError[row._id] }}</div>
                </div>
            </div>

            <div class="ah-card tm__note">{{ $t('Settings.teams_note') }}</div>
        </template>
    </div>
    <div v-else class="ah-empty">{{ $t('Settings.access_denied') }}</div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import * as env from "@/config/env";
import { apiRequest } from "@/services";
import { useCustomComposable } from "@/composable";
import Assignee from "@/components/molecules/Assignee/Assignee.vue";
import UpgradePlan from "@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue";

defineOptions({ name: "TeamsSettings" });

const vFocus = { mounted: (el) => el.focus() };
const $toast = useToast();
const { t } = useI18n();
const { getters, commit } = useStore();
const { checkPermission } = useCustomComposable();

const editPermission = computed(() => checkPermission("settings.settings_team_list"));
const users = computed(() => getters["settings/companyUsers"]);
const teams = computed(() => getters["settings/teams"]);
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const peopleCount = computed(() => new Set(teams.value.flatMap((x) => x.assigneeUsersArray || [])).size);

const existingValue = ref("");
const nameError = ref({});
const colors = [
    "#40BC86", "#1ABC9C", "#27AE60", "#00D717", "#F31D2F", "#EC555C", "#FC575E", "#FCB410", "#B17E22", "#F24D16",
    "#FF8600", "#EC6F32", "#2980B9", "#3498DB", "#528CCB", "#03A2FD", "#7B68EE", "#BF4ACC", "#074354", "#34495E",
    "#181D21", "#0918EC", "#199EC7"
];

function updateTeam(row, updateObject, key) {
    return apiRequest("put", `${env.TEAMS}/updateTeam`, { updateObject, key, id: row._id }).then((res) => {
        if (res.data) commit("settings/mutateTeams", { data: Object.assign(res.data, { isEdit: false, isPopupOpen: false }), op: "modified" });
        $toast.success(t("Toast.Updated_successfully"), { position: "top-right" });
    }).catch((error) => {
        $toast.error(error?.response?.data?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    });
}

const changeAssignee = (type, user, row) => updateTeam(row, { assigneeUsersArray: user.id }, type === "add" ? "$addToSet" : "$pull");

function setColor(row, color) {
    row.isPopupOpen = false;
    updateTeam(row, { teamColor: { bgColor: color, color: row.teamColor?.color || "#fff" } }, "$set");
}

function openInput(row) {
    teams.value.forEach((x) => { x.isEdit = x._id === row._id; });
    existingValue.value = row.name;
    nameError.value = {};
}

function saveTeamName(row) {
    const name = existingValue.value;
    if (name === row.name) { row.isEdit = false; return; }
    const value = name.replaceAll(" ", "_").toUpperCase();
    if (!value) nameError.value = { [row._id]: t("Toast.Team_name_is_required") };
    else if (value.length < 3) nameError.value = { [row._id]: t("Toast.Minimum_3_character_required") };
    else if (teams.value.some((x) => x.value === value)) nameError.value = { [row._id]: t("Toast.Team_name_already_exist") };
    else {
        nameError.value = {};
        updateTeam(row, { name, value, updatedAt: new Date() }, "$set").then(() => { row.isEdit = false; });
        return;
    }
    row.isEdit = true;
}
</script>

<style src="./style.css"></style>
