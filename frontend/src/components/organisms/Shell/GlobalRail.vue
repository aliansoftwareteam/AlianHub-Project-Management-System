<template>
    <nav class="ah-rail" aria-label="Primary" @keydown="onKeydown">
        <router-link :to="{ name: 'Home', params: { cid: companyId } }" class="ah-rail__mark" :title="productName">
            <img v-if="logoOk" :src="railLogo" alt="" @error="logoOk = false" />
            <span v-else>{{ productInitial }}</span>
        </router-link>

        <div class="ah-rail__items" role="list">
            <router-link
                v-for="item in rail"
                :key="item.key"
                :to="item.to"
                class="ah-rail__item"
                :class="{ 'is-active': isActive(item) }"
                role="listitem"
                :aria-current="isActive(item) ? 'page' : null"
                :tabindex="focusIndex(item.key)"
            >
                <span class="ah-rail__tile"><ShellIcon :name="item.icon" :size="17" /></span>
                <span class="ah-rail__label">{{ $t(item.label) }}</span>
            </router-link>
        </div>

        <div class="ah-rail__foot">
            <button
                v-if="shellState.agentsRunning > 0"
                class="ah-rail__agents"
                type="button"
                :title="$t('Shell.agents_running', { n: shellState.agentsRunning })"
                @click="$router.push({ name: 'AiHub', params: { cid: companyId } })"
            >
                <span class="ah-dot ah-dot--ok"></span>
                <span class="ah-rail__agents-n">{{ shellState.agentsRunning }}</span>
            </button>

            <div class="ah-rail__pop-anchor">
                <button
                    ref="moreBtn"
                    type="button"
                    class="ah-rail__item ah-rail__item--btn"
                    :class="{ 'is-active': moreActive || shellState.moreOpen }"
                    :aria-expanded="shellState.moreOpen"
                    aria-haspopup="menu"
                    :tabindex="focusIndex('more')"
                    @click.stop="toggle('moreOpen')"
                >
                    <span class="ah-rail__tile"><ShellIcon name="more" :size="17" /></span>
                    <span class="ah-rail__label">{{ $t('Shell.more') }}</span>
                </button>
                <transition name="ah-fade">
                    <div v-if="shellState.moreOpen" class="ah-pop ah-rail__pop ah-rail__pop--more" role="menu" @click.stop>
                        <template v-for="group in more" :key="group.label">
                            <div class="ah-label ah-pop__label">{{ $t(group.label) }}</div>
                            <template v-for="item in group.items" :key="item.key">
                                <a v-if="item.href" class="ah-pop__item" :href="item.href" target="_blank" rel="noopener" role="menuitem" @click="closePopovers()">
                                    <ShellIcon :name="item.icon" :size="15" /><span>{{ $t(item.label) }}</span>
                                </a>
                                <button v-else-if="item.panel" type="button" class="ah-pop__item" role="menuitem" @click="openPanel(item.panel)">
                                    <ShellIcon :name="item.icon" :size="15" /><span>{{ $t(item.label) }}</span>
                                </button>
                                <a v-else-if="item.newTab" class="ah-pop__item" role="menuitem" href="javascript:void(0)" @click="openInNewTab(item.to)">
                                    <ShellIcon :name="item.icon" :size="15" /><span>{{ $t(item.label) }}</span>
                                </a>
                                <router-link v-else class="ah-pop__item" :class="{ 'is-active': isActive(item) }" :to="item.to" role="menuitem" @click="closePopovers()">
                                    <ShellIcon :name="item.icon" :size="15" /><span>{{ $t(item.label) }}</span>
                                </router-link>
                            </template>
                        </template>
                    </div>
                </transition>
            </div>

            <div class="ah-rail__pop-anchor">
                <button
                    ref="profileBtn"
                    type="button"
                    class="ah-rail__avatar-btn"
                    :aria-expanded="shellState.profileOpen"
                    aria-haspopup="menu"
                    :title="me.Employee_Name"
                    :tabindex="focusIndex('profile')"
                    @click.stop="toggle('profileOpen')"
                >
                    <UserProfile :showDot="false" :data="{ image: me.Employee_profileImageURL, title: me.Employee_Name }" width="28px" :thumbnail="'35x35'" class="ah-rail__avatar" />
                    <span class="ah-rail__status" :class="me.isDnd ? 'ah-rail__status--dnd' : 'ah-rail__status--ok'"></span>
                </button>
                <transition name="ah-fade">
                    <div v-if="shellState.profileOpen" class="ah-pop ah-rail__pop ah-rail__pop--profile" role="menu" @click.stop>
                        <div class="ah-rail__me">
                            <UserProfile :showDot="false" :data="{ image: me.Employee_profileImageURL, title: me.Employee_Name }" width="34px" :thumbnail="'35x35'" />
                            <div class="ah-rail__me-text">
                                <strong>{{ me.Employee_Name }}</strong>
                                <span class="ah-small">{{ me.Employee_Email }}</span>
                            </div>
                        </div>
                        <div class="ah-pop__sep"></div>
                        <router-link class="ah-pop__item" :to="{ name: 'My Profile', params: { cid: companyId } }" role="menuitem" @click="closePopovers()">
                            <ShellIcon name="user" :size="15" /><span>{{ $t('Shell.my_profile') }}</span>
                        </router-link>
                        <router-link class="ah-pop__item" :to="{ name: 'Setting', params: { cid: companyId } }" role="menuitem" @click="closePopovers()">
                            <ShellIcon name="settings" :size="15" /><span>{{ $t('settingslider.Settings') }}</span>
                        </router-link>
                        <button type="button" class="ah-pop__item" role="menuitem" @click="toggleTheme()">
                            <ShellIcon :name="shellState.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
                            <span>{{ shellState.theme === 'dark' ? $t('Shell.theme_light') : $t('Shell.theme_dark') }}</span>
                        </button>
                        <template v-if="otherCompanies.length">
                            <div class="ah-pop__sep"></div>
                            <div class="ah-label ah-pop__label">{{ $t('Shell.switch_workspace') }}</div>
                            <button v-for="company in otherCompanies" :key="company._id" type="button" class="ah-pop__item" :class="{ 'is-disabled': company.isDisable }" role="menuitem" @click="switchCompany(company)">
                                <span class="ah-avatar ah-avatar--sm">{{ (company.Cst_CompanyName || '?').charAt(0).toUpperCase() }}</span>
                                <span class="text-ellipsis">{{ company.Cst_CompanyName }}</span>
                            </button>
                        </template>
                        <div class="ah-pop__sep"></div>
                        <button type="button" class="ah-pop__item" role="menuitem" @click="logout()">
                            <ShellIcon name="logout" :size="15" /><span>{{ $t('Shell.logout') }}</span>
                        </button>
                        <div class="ah-rail__version ah-mono" @click="openInNewTab({ name: 'Changelog', params: { cid: companyId } })">v{{ version }}</div>
                    </div>
                </transition>
            </div>
        </div>
    </nav>
</template>

<script setup>
import { computed, defineEmits, inject, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { version } from "../../../../../package.json";
import ShellIcon from "./ShellIcon.vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { useGetterFunctions } from "@/composable/index.js";
import { useAuth } from "@/services";
import { useNavItems } from "./navItems";
import { shellState, openPanel, closePopovers, toggleTheme } from "./shellState";

const emit = defineEmits(["change"]);
const companyId = inject("$companyId");
const userId = inject("$userId");
const { getters } = useStore();
const { getUser } = useGetterFunctions();
const { logOut } = useAuth();
const router = useRouter();
const { rail, more, isActive, moreActive } = useNavItems(companyId);

const railLogo = "/api/v1/getlogo?key=favicon";
const logoOk = ref(true);
const brand = computed(() => getters["brandSettingTab/brandSettings"] || {});
const productName = computed(() => brand.value.productName || "AlianHub");
const productInitial = computed(() => productName.value.charAt(0).toUpperCase());

const me = computed(() => getUser(userId.value) || {});
const companies = computed(() => getters["settings/companies"] || []);
const otherCompanies = computed(() => companies.value.filter((c) => c._id !== companyId.value));

const focusOrder = computed(() => [...rail.value.map((i) => i.key), "more", "profile"]);
const focused = ref(0);
const focusIndex = (key) => (focusOrder.value[focused.value] === key ? 0 : -1);
const onKeydown = (e) => {
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const n = focusOrder.value.length;
    focused.value = (focused.value + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    const el = e.currentTarget.querySelector('[tabindex="0"]');
    if (el) el.focus();
};

const toggle = (key) => {
    const next = !shellState[key];
    closePopovers();
    shellState[key] = next;
};
const onDocClick = (e) => {
    if (e.target && e.target.closest && e.target.closest(".ah-rail__pop-anchor")) return;
    closePopovers();
};
const onEsc = (e) => { if (e.key === "Escape") closePopovers(); };
onMounted(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onEsc);
});
onUnmounted(() => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onEsc);
});

const openInNewTab = (to) => {
    closePopovers();
    const r = router.resolve(to);
    window.open(`${window.location.origin}${window.location.pathname}${r.href}`, "_blank", "noopener");
};
const switchCompany = (company) => {
    if (company.isDisable) return;
    closePopovers();
    emit("change", company._id);
};
const logout = () => logOut({ islogOut: true });
</script>
