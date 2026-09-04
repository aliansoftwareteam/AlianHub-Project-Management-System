<template>
    <div class="ms" :class="{ 'ms--busy': isSpinner }">
        <SpinnerComp :is-spinner="isSpinner" />

        <section class="ah-card">
            <div class="ah-card__body ms__profile">
                <button type="button" class="ms__avatar" :aria-label="$t('Settings.change_photo')" @click="openCropperTool()">
                    <img v-if="previewUrl" :src="previewUrl" alt="" class="ms__avatar-img" />
                    <WasabiImage v-else-if="formData.Employee_profileImageURL" class="ms__avatar-img" :data="{ url: formData.Employee_profileImageURL }" :thumbnail="'120x120'" :userImage="true" />
                    <span v-else class="ms__avatar-initial">{{ initial }}</span>
                </button>
                <div class="ms__identity">
                    <div class="ms__name">{{ fullName }}</div>
                    <div class="ah-small">{{ formData.email }} · {{ roleName }}<template v-if="joined"> · {{ $t('Settings.joined', { date: joined }) }}</template></div>
                </div>
                <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="openCropperTool()">{{ $t('Settings.change_photo') }}</button>
            </div>
            <div class="ah-card__body ms__grid">
                <div class="ah-field">
                    <label class="ah-field__label" for="ms-first">{{ $t('Auth.firstName') }}</label>
                    <input id="ms-first" class="ah-input" :class="{ 'ah-input--error': errors.firstName }" v-model.trim="formData.firstName" type="text" autocomplete="given-name" @input="errors.firstName = ''" />
                    <div v-if="errors.firstName" class="ah-field__error">{{ errors.firstName }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ms-last">{{ $t('Auth.lastName') }}</label>
                    <input id="ms-last" class="ah-input" :class="{ 'ah-input--error': errors.lastName }" v-model.trim="formData.lastName" type="text" autocomplete="family-name" @input="errors.lastName = ''" />
                    <div v-if="errors.lastName" class="ah-field__error">{{ errors.lastName }}</div>
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ms-email">{{ $t('Auth.email') }}</label>
                    <input id="ms-email" class="ah-input" :value="formData.email" type="email" disabled />
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ms-title">{{ $t('Settings.job_title') }}<span class="ah-small">{{ $t('Settings.job_title_hint') }}</span></label>
                    <input id="ms-title" class="ah-input" :value="designationName || $t('Settings.job_title_none')" type="text" disabled />
                </div>
                <div class="ah-field">
                    <label class="ah-field__label" for="ms-lang">{{ $t('Auth.selectLanguage') }}</label>
                    <select id="ms-lang" class="ah-input" v-model="selectedLanguageCode">
                        <option v-for="lang in languageOptions" :key="lang.code" :value="lang.code">{{ lang.title }}</option>
                    </select>
                </div>
                <div class="ah-field">
                    <span class="ah-field__label">{{ $t('Auth.time_format') }}</span>
                    <div class="ah-tabs ms__tabs" role="radiogroup" :aria-label="$t('Auth.time_format')">
                        <button type="button" class="ah-tab" :class="{ 'is-active': formData.Time_Format === '24' }" role="radio" :aria-checked="formData.Time_Format === '24'" @click="formData.Time_Format = '24'">{{ $t('Settings.hours_24') }}</button>
                        <button type="button" class="ah-tab" :class="{ 'is-active': formData.Time_Format === '12' }" role="radio" :aria-checked="formData.Time_Format === '12'" @click="formData.Time_Format = '12'">{{ $t('Settings.hours_12') }}</button>
                    </div>
                </div>
            </div>
        </section>

        <section class="ah-card">
            <div class="ah-card__head">
                <h2 class="ah-h3">{{ $t('Settings.working_hours') }}</h2>
                <span class="ah-small">{{ $t('Settings.working_hours_hint') }}</span>
            </div>
            <div class="ah-card__body ms__wh">
                <div class="ms__wh-row">
                    <label class="ms__wh-label" for="ms-tz">{{ $t('Auth.timezone') }}</label>
                    <select id="ms-tz" class="ah-input ms__wh-tz" v-model="formData.Time_Zone">
                        <option v-for="tz in timezoneArray" :key="tz" :value="tz">{{ tz }}</option>
                    </select>
                </div>
                <div class="ms__wh-row">
                    <span class="ms__wh-label" id="ms-days-label">{{ $t('Settings.days') }}</span>
                    <div class="ms__days" role="group" aria-labelledby="ms-days-label">
                        <button
                            v-for="day in dayOptions"
                            :key="day.value"
                            type="button"
                            class="ms__day"
                            :class="{ 'is-on': workingHours.days.includes(day.value) }"
                            :aria-pressed="workingHours.days.includes(day.value)"
                            :aria-label="day.name"
                            :title="day.name"
                            @click="toggleDay(day.value)"
                        >{{ day.letter }}</button>
                    </div>
                </div>
                <div class="ms__wh-row ms__wh-row--hours">
                    <label class="ms__wh-label" for="ms-start">{{ $t('Settings.hours') }}</label>
                    <input id="ms-start" class="ah-input ms__time" type="time" v-model="workingHours.start" />
                    <span class="ms__arrow" aria-hidden="true">→</span>
                    <input class="ah-input ms__time" type="time" v-model="workingHours.end" :aria-label="$t('Settings.hours_end')" />
                    <label class="ms__wh-label ms__wh-label--inline" for="ms-cap">{{ $t('Settings.capacity') }}</label>
                    <div class="ms__cap">
                        <input id="ms-cap" class="ah-input ms__cap-input" type="number" min="0" max="24" step="0.5" v-model.number="workingHours.capacity" />
                        <span class="ah-small">{{ $t('Settings.capacity_unit') }}</span>
                    </div>
                </div>
                <div v-if="errors.workingHours" class="ah-field__error">{{ errors.workingHours }}</div>
            </div>
        </section>

        <section class="ah-card">
            <div class="ah-card__body ms__theme">
                <div>
                    <h2 class="ah-h3">{{ $t('Settings.theme') }}</h2>
                    <div class="ah-small">{{ $t('Settings.theme_hint') }}</div>
                </div>
                <div class="ms__theme-opts" role="radiogroup" :aria-label="$t('Settings.theme')">
                    <button
                        v-for="opt in themeOptions"
                        :key="opt.value"
                        type="button"
                        class="ms__theme-opt"
                        :class="{ 'is-active': shellState.theme === opt.value }"
                        role="radio"
                        :aria-checked="shellState.theme === opt.value"
                        @click="applyTheme(opt.value)"
                    >
                        <ShellIcon :name="opt.icon" :size="14" />{{ $t(opt.label) }}
                    </button>
                </div>
            </div>
        </section>

        <section class="ah-card">
            <div class="ah-card__head">
                <h2 class="ah-h3">{{ $t('Settings.sessions') }}</h2>
                <span class="ah-small">{{ $t('Settings.sessions_hint') }}</span>
            </div>
            <div class="ah-card__body ms__sessions">
                <div v-if="sessionsError" class="ah-field__error">{{ sessionsError }}</div>
                <div v-else-if="!sessions.length && !sessionsLoading" class="ah-empty">{{ $t('Settings.no_sessions') }}</div>
                <div v-for="s in sessions" :key="s._id" class="ms__session">
                    <span class="ah-dot" :class="s.current ? 'ah-dot--ok' : 'ms__dot-idle'"></span>
                    <ShellIcon :name="s.device ? 'phone' : 'monitor'" :size="15" class="ms__session-icon" />
                    <span class="ms__session-text">
                        {{ sessionLabel(s) }}
                        <span v-if="s.current" class="ah-chip ah-chip--ok">{{ $t('Settings.this_device') }}</span>
                    </span>
                    <span class="ah-mono ms__session-when">{{ s.current ? $t('Settings.now') : whenLabel(s.lastActive) }}</span>
                    <button v-if="!s.current" type="button" class="ms__signout" :disabled="signingOut === s._id" @click="signOutSession(s)">{{ $t('Settings.sign_out') }}</button>
                </div>
            </div>
        </section>

        <div class="ms__actions">
            <button type="button" class="ah-btn ah-btn--primary" :disabled="isSpinner" @click="saveChanges()">{{ $t('Settings.save_changes') }}</button>
            <span v-if="savedAt" class="ah-small">{{ $t('Settings.saved') }}</span>
        </div>

        <CroppingTool
            :image="{ url: formData.Employee_profileImage, name: fileName }"
            :isVisible="isCropper"
            :title="$t('Settings.change_photo')"
            :stencilSize="stencilSize"
            :stencilProps="stencilProps"
            @updateVisible="(val) => isCropper = val"
            @getEditedImage="(val) => { formData.Employee_profileImage = val.url; fileName = val.fileName; }"
        />
    </div>
</template>

<script setup>
import { ref, inject, computed, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import Cookies from "js-cookie";
import * as env from "@/config/env";
import timeZoneOption from "./timezoneArray.js";
import languageOptions from "@/utils/languagesName.json";
import { useGetterFunctions, languageTranslateHelper } from "@/composable";
import { apiRequestWithoutCompnay } from "@/services";
import { storageQueryBuilder, generateFileName } from "@/utils/storageQueryBuild.js";
import { shellState, applyTheme } from "@/components/organisms/Shell/shellState.js";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import SpinnerComp from "@/components/atom/SpinnerComp/SpinnerComp.vue";
import WasabiImage from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue";
import CroppingTool from "@/components/atom/CroppingTool/CroppingTool.vue";

defineOptions({ name: "MySettingsView" });

const { t, locale, setLocaleMessage } = useI18n();
const $toast = useToast();
const { getters, commit } = useStore();
const { getUser } = useGetterFunctions();
const { selectedLanguageCode, changeLanguage } = languageTranslateHelper();
const userId = inject("$userId");

const DEFAULT_HOURS = { days: [1, 2, 3, 4, 5], start: "09:30", end: "18:00", capacity: 8 };
const TOKEN_TAIL = 6;

const isSpinner = ref(false);
const savedAt = ref(0);
const isCropper = ref(false);
const fileName = ref("");
const oldFileValue = ref("");
const timezoneArray = ref(timeZoneOption);
const errors = ref({ firstName: "", lastName: "", workingHours: "" });
const formData = ref({ firstName: "", lastName: "", email: "", Employee_profileImage: "", Employee_profileImageURL: "", Time_Zone: "Asia/Kolkata", Time_Format: "12" });
const workingHours = ref({ ...DEFAULT_HOURS, days: [...DEFAULT_HOURS.days] });
const sessions = ref([]);
const sessionsLoading = ref(false);
const sessionsError = ref("");
const signingOut = ref("");

const stencilSize = { width: 180, height: 180 };
const stencilProps = { handlers: {}, movable: false, resizable: false, aspectRatio: 1 };

const themeOptions = [
    { value: "light", label: "Settings.theme_light", icon: "sun" },
    { value: "dark", label: "Settings.theme_dark", icon: "moon" },
    { value: "system", label: "Settings.theme_system", icon: "monitor" }
];

const dayOptions = computed(() => {
    const letters = t("Settings.days_letters").split(" ");
    const names = t("Settings.days_names").split(",");
    return [1, 2, 3, 4, 5, 6, 0].map((value, i) => ({ value, letter: letters[i] || "", name: (names[i] || "").trim() }));
});

const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
const roleName = computed(() => {
    const role = (getters["settings/roles"] || []).find((r) => r.key === companyUser.value.roleType);
    return role?.name || "";
});
const designationName = computed(() => {
    const d = (getters["settings/designations"] || []).find((x) => x.key === companyUser.value.designation);
    return d?.name || "";
});
const joined = computed(() => {
    const raw = companyUser.value.createdAt || companyUser.value.sendInvitationTime;
    if (!raw) return "";
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
});
const fullName = computed(() => `${formData.value.firstName} ${formData.value.lastName}`.trim());
const initial = computed(() => (formData.value.firstName || formData.value.email || "?").charAt(0).toUpperCase());
const previewUrl = computed(() => (String(formData.value.Employee_profileImage || "").startsWith("data:") ? formData.value.Employee_profileImage : ""));

function init() {
    const user = getUser(userId.value, 1) || {};
    formData.value.firstName = user.Employee_FName || "";
    formData.value.lastName = user.Employee_LName || "";
    formData.value.email = user.Employee_Email || "";
    formData.value.Employee_profileImage = user.Employee_profileImage || "";
    formData.value.Employee_profileImageURL = user.Employee_profileImageURL || "";
    formData.value.Time_Format = String(user.Time_Format || "12");
    formData.value.Time_Zone = user.Time_Zone || "Asia/Kolkata";
    oldFileValue.value = user.Employee_profileImage || "";
    const wh = user.workingHours || {};
    workingHours.value = {
        days: Array.isArray(wh.days) ? wh.days.map(Number) : [...DEFAULT_HOURS.days],
        start: wh.start || DEFAULT_HOURS.start,
        end: wh.end || DEFAULT_HOURS.end,
        capacity: Number.isFinite(Number(wh.capacity)) ? Number(wh.capacity) : DEFAULT_HOURS.capacity
    };
}

function toggleDay(value) {
    const i = workingHours.value.days.indexOf(value);
    if (i === -1) workingHours.value.days.push(value); else workingHours.value.days.splice(i, 1);
}

function validate() {
    errors.value = { firstName: "", lastName: "", workingHours: "" };
    if (!formData.value.firstName) errors.value.firstName = t("Settings.required_field");
    if (!formData.value.lastName) errors.value.lastName = t("Settings.required_field");
    if (!workingHours.value.start || !workingHours.value.end || workingHours.value.end <= workingHours.value.start) errors.value.workingHours = t("Settings.hours_invalid");
    else if (!workingHours.value.days.length) errors.value.workingHours = t("Settings.days_required");
    return !errors.value.firstName && !errors.value.lastName && !errors.value.workingHours;
}

async function uploadPhotoIfChanged() {
    if (!previewUrl.value) return;
    const filePath = generateFileName(fileName.value || "profile.png", env.STORAGE_TYPE);
    const isServer = env.STORAGE_TYPE === "server";
    if (isServer && oldFileValue.value && !oldFileValue.value.startsWith("data:")) {
        await apiRequestWithoutCompnay("delete", `${env.REMOVE_FILE}/USER_PROFILES?filepath=${oldFileValue.value}&thubmkey=userProfile`).catch(() => {});
    }
    const payload = { path: filePath, key: "userProfile", base64String: formData.value.Employee_profileImage, isUserProfile: true };
    if (isServer) payload.companyId = "USER_PROFILES";
    const res = await apiRequestWithoutCompnay("post", storageQueryBuilder("upload_64").route, payload);
    if (!res?.data?.status) throw new Error(t("Toast.something_went_wrong"));
    const stored = isServer ? res.data.statusText : res.data.statusText[0];
    formData.value.Employee_profileImage = stored;
    formData.value.Employee_profileImageURL = stored;
    oldFileValue.value = stored;
}

async function applyLanguage() {
    const previous = localStorage.getItem("language");
    if (selectedLanguageCode.value === previous) return;
    const messages = await changeLanguage(selectedLanguageCode.value);
    if (!messages) {
        selectedLanguageCode.value = previous;
        throw new Error(t("Toast.Language_not_updated!"));
    }
    localStorage.setItem("language", selectedLanguageCode.value);
    locale.value = selectedLanguageCode.value;
    setLocaleMessage(selectedLanguageCode.value, messages);
}

async function saveChanges() {
    if (!validate()) return;
    isSpinner.value = true;
    try {
        await applyLanguage();
        await uploadPhotoIfChanged();
        const $set = {
            Employee_FName: formData.value.firstName,
            Employee_LName: formData.value.lastName,
            Employee_Name: fullName.value,
            Employee_profileImage: formData.value.Employee_profileImage,
            Employee_profileImageURL: formData.value.Employee_profileImageURL,
            Time_Format: formData.value.Time_Format,
            Time_Zone: formData.value.Time_Zone,
            languageCode: selectedLanguageCode.value,
            workingHours: { ...workingHours.value, days: [...workingHours.value.days].sort() },
            updatedAt: new Date()
        };
        const response = await apiRequestWithoutCompnay("put", env.USER_UPATE, { userId: userId.value, updateObject: { $set }, newObj: { returnDocument: "after" } });
        if (response?.data?.data) commit("users/mutateUsers", { data: response.data.data, op: "modified" });
        savedAt.value = Date.now();
        $toast.success(t("Toast.Profile_updated_successfully"), { position: "top-right" });
    } catch (error) {
        $toast.error(error?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        isSpinner.value = false;
    }
}

const myTokenTail = () => (Cookies.get("refreshToken") || "").slice(-TOKEN_TAIL);

async function loadSessions() {
    sessionsLoading.value = true;
    sessionsError.value = "";
    try {
        const res = await apiRequestWithoutCompnay("get", env.USER_SESSIONS);
        const tail = myTokenTail();
        sessions.value = (res?.data?.data || []).map((s) => ({ ...s, current: !!tail && s.tokenTail === tail }));
    } catch (error) {
        sessionsError.value = error?.response?.data?.message || t("Settings.sessions_error");
    } finally {
        sessionsLoading.value = false;
    }
}

async function signOutSession(session) {
    signingOut.value = session._id;
    try {
        await apiRequestWithoutCompnay("delete", `${env.USER_SESSIONS}/${session._id}`);
        sessions.value = sessions.value.filter((s) => s._id !== session._id);
    } catch (error) {
        $toast.error(error?.response?.data?.message || t("Toast.something_went_wrong"), { position: "top-right" });
    } finally {
        signingOut.value = "";
    }
}

const sessionLabel = (s) => [s.browser || s.device || t("Settings.unknown_device"), s.os, s.ip].filter(Boolean).join(" · ");

function whenLabel(date) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return t("Settings.now");
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
}

function openCropperTool() {
    isCropper.value = true;
    setTimeout(() => document.getElementById("cropping-input")?.click());
}

onMounted(() => {
    init();
    loadSessions();
});
</script>

<style scoped>
@import "./style.css";
</style>
