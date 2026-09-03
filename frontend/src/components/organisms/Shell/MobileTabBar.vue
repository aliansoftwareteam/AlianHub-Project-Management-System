<template>
    <nav class="ah-tabbar" aria-label="Primary">
        <router-link
            v-for="item in tabs"
            :key="item.key"
            :to="item.to"
            class="ah-tabbar__item"
            :class="{ 'is-active': isActive(item) }"
            :aria-current="isActive(item) ? 'page' : null"
        >
            <ShellIcon :name="item.icon" :size="20" />
            <span>{{ $t(item.label) }}</span>
        </router-link>
        <button type="button" class="ah-tabbar__item" :class="{ 'is-active': sheet }" @click="sheet = true">
            <ShellIcon name="more" :size="20" />
            <span>{{ $t('Shell.more') }}</span>
        </button>

        <teleport to="body">
            <transition name="ah-fade">
                <div v-if="sheet" class="ah-sheet__backdrop" @click="sheet = false">
                    <div class="ah-sheet" role="menu" @click.stop>
                        <div class="ah-sheet__grab"></div>
                        <div class="ah-sheet__me">
                            <UserProfile :showDot="false" :data="{ image: me.Employee_profileImageURL, title: me.Employee_Name }" width="36px" :thumbnail="'35x35'" />
                            <div class="ah-rail__me-text">
                                <strong>{{ me.Employee_Name }}</strong>
                                <span class="ah-small">{{ me.Employee_Email }}</span>
                            </div>
                        </div>
                        <div class="ah-sheet__grid">
                            <router-link v-for="item in overflowRail" :key="item.key" :to="item.to" class="ah-sheet__cell" @click="sheet = false">
                                <ShellIcon :name="item.icon" :size="18" /><span>{{ $t(item.label) }}</span>
                            </router-link>
                        </div>
                        <template v-for="group in more" :key="group.label">
                            <div class="ah-label ah-pop__label">{{ $t(group.label) }}</div>
                            <template v-for="item in group.items" :key="item.key">
                                <a v-if="item.href" class="ah-pop__item" :href="item.href" target="_blank" rel="noopener" @click="sheet = false">
                                    <ShellIcon :name="item.icon" :size="16" /><span>{{ $t(item.label) }}</span>
                                </a>
                                <button v-else-if="item.panel" type="button" class="ah-pop__item" @click="sheet = false; openPanel(item.panel)">
                                    <ShellIcon :name="item.icon" :size="16" /><span>{{ $t(item.label) }}</span>
                                </button>
                                <router-link v-else class="ah-pop__item" :to="item.to" :target="item.newTab ? '_blank' : null" @click="sheet = false">
                                    <ShellIcon :name="item.icon" :size="16" /><span>{{ $t(item.label) }}</span>
                                </router-link>
                            </template>
                        </template>
                        <div class="ah-pop__sep"></div>
                        <button type="button" class="ah-pop__item" @click="toggleTheme()">
                            <ShellIcon :name="shellState.theme === 'dark' ? 'sun' : 'moon'" :size="16" />
                            <span>{{ shellState.theme === 'dark' ? $t('Shell.theme_light') : $t('Shell.theme_dark') }}</span>
                        </button>
                        <button type="button" class="ah-pop__item" @click="logout()">
                            <ShellIcon name="logout" :size="16" /><span>{{ $t('Shell.logout') }}</span>
                        </button>
                    </div>
                </div>
            </transition>
        </teleport>
    </nav>
</template>

<script setup>
import { computed, inject, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ShellIcon from "./ShellIcon.vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import { useGetterFunctions } from "@/composable/index.js";
import { useAuth } from "@/services";
import { useNavItems } from "./navItems";
import { shellState, openPanel, toggleTheme } from "./shellState";

const companyId = inject("$companyId");
const userId = inject("$userId");
const route = useRoute();
const { getUser } = useGetterFunctions();
const { logOut } = useAuth();
const { rail, more, isActive } = useNavItems(companyId);

const sheet = ref(false);
watch(() => route.fullPath, () => { sheet.value = false; });

const PRIMARY = ["home", "planner", "chat", "ai"];
const tabs = computed(() => rail.value.filter((i) => PRIMARY.includes(i.key)).slice(0, 4));
const overflowRail = computed(() => rail.value.filter((i) => !tabs.value.includes(i)));
const me = computed(() => getUser(userId.value) || {});
const logout = () => logOut({ islogOut: true });
</script>
