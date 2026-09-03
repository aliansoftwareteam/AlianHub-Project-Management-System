<template>
    <div class="ah-page st">
        <aside class="st__side" v-if="!narrow">
            <div class="st__side-head">
                <span class="ah-avatar ah-avatar--lg st__company" :title="companyName">{{ companyInitial }}</span>
                <span class="st__company-name" :title="companyName">{{ companyName }}</span>
            </div>
            <nav class="st__nav ah-scroll" :aria-label="$t('SettingsV2.nav_aria')">
                <div v-for="group in groups" :key="group.key" class="st__group">
                    <div class="ah-label st__group-label">{{ $t(group.label) }}</div>
                    <router-link
                        v-for="item in group.items"
                        :key="item.key"
                        :to="item.to"
                        class="st__link"
                        :class="{ 'is-active': item.active }"
                        :aria-current="item.active ? 'page' : null"
                    >
                        <ShellIcon :name="item.icon" :size="15" />
                        <span>{{ item.text }}</span>
                    </router-link>
                </div>
            </nav>
        </aside>

        <transition name="ah-fade">
            <div v-if="narrow && drawer" class="st__scrim" @click="drawer = false"></div>
        </transition>
        <transition name="st-drawer">
            <aside v-if="narrow && drawer" class="st__side st__side--drawer" role="dialog" :aria-label="$t('SettingsV2.nav_aria')">
                <div class="st__side-head">
                    <span class="ah-avatar ah-avatar--lg st__company">{{ companyInitial }}</span>
                    <span class="st__company-name">{{ companyName }}</span>
                    <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm st__close" :aria-label="$t('SettingsV2.close')" @click="drawer = false"><ShellIcon name="x" :size="16" /></button>
                </div>
                <nav class="st__nav ah-scroll">
                    <div v-for="group in groups" :key="group.key" class="st__group">
                        <div class="ah-label st__group-label">{{ $t(group.label) }}</div>
                        <router-link v-for="item in group.items" :key="item.key" :to="item.to" class="st__link" :class="{ 'is-active': item.active }" @click="drawer = false">
                            <ShellIcon :name="item.icon" :size="15" />
                            <span>{{ item.text }}</span>
                        </router-link>
                    </div>
                </nav>
            </aside>
        </transition>

        <div class="st__main">
            <header class="ah-toolbar st__toolbar">
                <button v-if="narrow" type="button" class="ah-btn ah-btn--ghost ah-btn--sm st__menu" :aria-label="$t('SettingsV2.open_menu')" @click="drawer = true">
                    <ShellIcon name="menu" :size="18" />
                </button>
                <h1 class="ah-toolbar__title">{{ pageTitle }}</h1>
                <div class="ah-toolbar__spacer"></div>
                <div id="top_section" class="st__toolbar-slot"></div>
                <button v-if="route.name === 'Teams' && canCreateTeam" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="openTeamSidebar = true">
                    <ShellIcon name="plus" :size="14" /> {{ $t('SettingsV2.new_team') }}
                </button>
                <button v-if="route.name === 'Settings-Projects' && canCreateProject" type="button" class="ah-btn ah-btn--primary ah-btn--sm" @click="isActiveCreateSidebar = true">
                    <ShellIcon name="plus" :size="14" /> {{ $t('Settings.add_new_projects') }}
                </button>
            </header>
            <div class="st__content ah-scroll">
                <router-view />
            </div>
        </div>

        <AddTeamSidebar v-if="openTeamSidebar" :openTeamSidebar="openTeamSidebar" @closeTeamSidebar="(val) => { openTeamSidebar = val }" />
        <CreateProjectSidebar v-if="isActiveCreateSidebar" :isActiveCreateSidebar="isActiveCreateSidebar" @click:closeSidebar="isActiveCreateSidebar = false" @closeSidebar="isActiveCreateSidebar = false" />
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useCustomComposable } from "@/composable";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import AddTeamSidebar from "@/components/molecules/AddTeamSidebar/AddTeamSidebar.vue";
import CreateProjectSidebar from "@/components/organisms/CreateProject/CreateProjectSidebar.vue";
import { customField } from "@/plugins/customFieldView/helper.js";
import chargebeeRouter from "@/plugins/chargebee/router";
import paddleRouter from "@/plugins/paddle/router.js";

defineOptions({ name: "SettingsShell" });

const route = useRoute();
const router = useRouter();
const { getters } = useStore();
const { t, te } = useI18n();
const { checkPermission } = useCustomComposable();
const { tabRouteHelper } = customField();
const companyId = inject("$companyId");
const clientWidth = inject("$clientWidth");

const NARROW = 1280;
const narrow = computed(() => (clientWidth?.value || window.innerWidth) < NARROW);
const drawer = ref(false);
const openTeamSidebar = ref(false);
const isActiveCreateSidebar = ref(false);

const companies = computed(() => getters["settings/companies"] || []);
const currentCompany = computed(() => getters["settings/selectedCompany"] || {});
const companyUser = computed(() => getters["settings/companyUserDetail"] || {});
const company = computed(() => companies.value.find((c) => c._id === companyId.value) || {});
const companyName = computed(() => company.value.Cst_CompanyName || "");
const companyInitial = computed(() => companyName.value.charAt(0).toUpperCase());
const isOwner = computed(() => companyUser.value.roleType === 1);
const isOwnerOrAdmin = computed(() => [1, 2].includes(companyUser.value.roleType));

const canCreateTeam = computed(() => checkPermission("settings.settings_create_team") === true && !!currentCompany.value?.planFeature?.team);
const canCreateProject = computed(() => checkPermission("project.project_list") === true && checkPermission("project.project_create") === true);

const anyVisible = (keys) => keys.some((k) => checkPermission(k) !== null);
const membersVisible = () => checkPermission("settings.settings_role_management") !== null
    && checkPermission("settings.settings_designation") !== null
    && checkPermission("settings.settings_member_list") === true;

const hasBilling = computed(() => !!(chargebeeRouter.upgradeTab || paddleRouter.upgradeTab) && isOwner.value && router.hasRoute("Upgrade"));

const to = (name) => ({ name, params: { cid: companyId.value } });
const label = (key) => (te(key) ? t(key) : key);

const rawGroups = computed(() => [
    {
        key: "personal",
        label: "SettingsV2.group_personal",
        items: [
            { key: "profile", text: t("SettingsV2.nav_my_settings"), icon: "user", to: to("My Profile"), names: ["My Profile"], show: true },
            { key: "notifications", text: t("SettingsV2.nav_notifications"), icon: "bell", to: to("Notifications"), names: ["Notifications"], show: true },
            { key: "signin", text: t("SettingsV2.nav_signin_security"), icon: "lock", to: to("twoFactorAuth"), names: ["twoFactorAuth", "changePassword"], show: true },
            { key: "company", text: label("settingslider.Company"), icon: "switch", to: to("Company"), names: ["Company"], show: true }
        ]
    },
    {
        key: "workspace",
        label: "SettingsV2.group_workspace",
        items: [
            { key: "general", text: t("SettingsV2.nav_general"), icon: "settings", to: to("Setting"), names: ["Setting"], show: anyVisible(["settings.settings_edit_company", "settings.settings_task_priority", "settings.settings_file_extensions", "settings.settings_project_milestone_status"]) },
            { key: "members", text: label("settingslider.Members"), icon: "members", to: to("Members"), names: ["Members"], show: membersVisible() },
            { key: "teams", text: label("settingslider.Teams"), icon: "members", to: to("Teams"), names: ["Teams"], show: checkPermission("settings.settings_team_list") !== null },
            { key: "projects", text: label("settingslider.Projects"), icon: "projects", to: to("Settings-Projects"), names: ["Settings-Projects"], show: checkPermission("settings.settings_project_list") !== null },
            ...tabRouteHelper().map((tab) => ({ key: tab.to.name, text: label(`settingslider.${tab.label}`), icon: "automations", to: to(tab.to.name), names: [tab.to.name], show: tab.permissions ? anyVisible(tab.permissions) : !!tab.isVisible })),
            { key: "security", text: t("SettingsV2.nav_security_permissions"), icon: "shield", to: to("Security & Permissions"), names: ["Security & Permissions"], show: checkPermission("settings.settings_security_permissions") !== null },
            { key: "sso", text: t("SettingsV2.nav_signin_sso"), icon: "key", to: to("SsoSettings"), names: ["SsoSettings"], show: isOwnerOrAdmin.value },
            { key: "scim", text: label("settingslider.SCIM"), icon: "integrations", to: to("ScimSettings"), names: ["ScimSettings"], show: isOwnerOrAdmin.value },
            { key: "integrations", text: label("settingslider.Integrations"), icon: "integrations", to: to("Integrations"), names: ["Integrations"], show: true },
            { key: "templates", text: label("settingslider.Templates"), icon: "template", to: to("Template"), names: ["Template"], show: true },
            { key: "timeoff", text: label("settingslider.Time Off"), icon: "planner", to: to("TimeOff"), names: ["TimeOff"], show: true },
            { key: "timetracking", text: label("settingslider.Time Tracking"), icon: "time", to: to("Time Tracking"), names: ["Time Tracking"], show: true },
            { key: "audit", text: label("settingslider.Audit Log"), icon: "audit", to: to("AuditLog"), names: ["AuditLog"], show: isOwnerOrAdmin.value },
            { key: "billing", text: t("SettingsV2.nav_billing"), icon: "billing", to: to("Upgrade"), names: ["Upgrade"], show: hasBilling.value }
        ]
    }
]);

const groups = computed(() => rawGroups.value
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show && router.hasRoute(i.to.name)).map((i) => ({ ...i, active: i.names.includes(route.name) })) }))
    .filter((g) => g.items.length));

const pageTitle = computed(() => {
    const hit = rawGroups.value.flatMap((g) => g.items).find((i) => i.names.includes(route.name));
    if (route.name === "changePassword") return label("settingslider.Change Password");
    if (hit) return hit.text;
    const title = route.meta?.title || "";
    return te(`settingslider.${title}`) ? t(`settingslider.${title}`) : title;
});

function guardRoute() {
    const hit = rawGroups.value.flatMap((g) => g.items).find((i) => i.names.includes(route.name));
    if (hit && !hit.show) router.replace(to("My Profile"));
}

onMounted(guardRoute);
watch(() => route.name, guardRoute);
watch(narrow, (v) => { if (!v) drawer.value = false; });
</script>

<style scoped>
@import "./settingsShell.css";
</style>
