<template>
    <div class="d-flex align-items-center justify-content-between px-1 bg-blue white header__wrapper border-bottom-lightgray">
        <div class="d-flex align-items-center h-100">
            <img :src="toggle" alt="options" class="pr-1 cursor-pointer" v-if="clientWidth <= 1200" @click="visible = !visible">
            <router-link :to="{name: 'Home', params: {cid: companyId}}" class="d-flex align-items-center h-100">
                <img :src="headerLogo" class="cursor-pointer" />
                <img class="cursor-pointer m0px-20px logo-app-icon" v-if="clientWidth > 990" src="@/assets/images/svg/header_dashboard.svg" alt="">
            </router-link>

            <NavLinks v-if="clientWidth > 1200 && rules && Object.keys(rules).length" :menu="menu" />
        </div>
        <small title="Open Advance Filter" class="project-list-title-small cursor-pointer d-flex justify-content-between align-items-centers text-nowrap" @click="dispatchEventForFilet" v-if="checkPermission('task.advance_search') == true">
            <template v-if="clientWidth >= 1150">
                <small class="project-list-title-small-text">{{$t('Projects.search')}}</small>
                <small>(Ctrl + K)</small>
            </template>
            <template v-else>
                <small class="project-list-title-small-text">{{$t('Projects.search')}}</small>
                <small v-if="clientWidth > 990">(Ctrl + K)</small>
            </template>
        </small>
        <div class="d-flex align-items-center justify-content-between z-index-5 header__actions" v-if="clientWidth > 990">
            <!-- COMPANY SELECTION -->
            <div class="d-flex" id="company_dropdown_driver">
            <span v-if="rules && Object.keys(rules).length" class="company-text">{{$t('settingslider.Company')}}</span>
            <template v-if="rules && Object.keys(rules).length">
                <DropDown id="company_selection" v-if="filteredCompanies.length" class="company_name_displayed">
                    <template #button>
                        <div class="cursor-pointer text-capitalize dropdown_wrapper pr-22px text-ellipsis" :title="selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : 'N/A'">
                            {{selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : "N/A"}}
                        </div>
                    </template>
                    <template #options>
                        <DropDownOption @click="$emit('change', company._id)" v-for="(company, index) in filteredCompanies" :key="index" :item="{image: company.Cst_profileImage || defaultUserIcon, label: company.Cst_CompanyName}">
                            <div class="d-flex align-items-center" :class="[{'opacity-5 cursor-default' : company.isDisable === true}]">
                                <span v-if="!company.Cst_profileImage" class="no-image">{{ company.Cst_CompanyName.charAt(0).toUpperCase()}}</span>
                                <template v-else>
                                    <img v-if="company.Cst_profileImage?.includes('http')" :src="company.Cst_profileImage || defaultUserIcon" alt="company_image" class="profile-image">
                                    <WasabiIamgeCompp v-else :companyId="company?._id" :data="{url:company.Cst_profileImage}" class="profile-image" thumbnail="38x38"/>
                                </template>
                                <span class="text-capitalize ml-10px">
                                    {{company.Cst_CompanyName}}
                                </span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
                <div class="text-capitalize font-size-13 font-weight-500 text-ellipsis company_name_displayed" v-else :title="selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : 'N/A'">
                    {{selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : "N/A"}}
                </div>
            </template>
            </div>
            <router-link class="position-re" :to="{name: 'chats', params: {cid: companyId}}" v-if="canOpenChat">
                <img src="@/assets/images/svg/chat_icon.svg" class="cursor-pointer" id="chat_driver"/>
                <span v-if="totalMainCounts" class="notification-tick blinking"></span>
            </router-link>
            <!--
              Inbox. The bell and @ dropdowns that used to sit either side of this were
              removed: the Inbox does everything they did, and keeping both meant the same
              row could be marked read twice, through two different endpoints.
            -->
            <router-link class="position-re" :to="{name: 'inbox', params: {cid: companyId}}" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/inbox_icon.svg" class="cursor-pointer" id="inbox_driver" :title="$t('Inbox.title')">
                <span :class="{'notification-tick': inboxUnreadCount > 0}" class="blinking"></span>
            </router-link>
            <div class="position-re" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/notepad_icon.svg" class="cursor-pointer" id="notepad_driver" :title="$t('Notepad.title')" @click="notepadVisible = true">
            </div>
            <div class="position-re" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/clips_icon.svg" class="cursor-pointer" id="clips_driver" :title="$t('Clips.title')" @click="clipsVisible = true">
            </div>
            <div class="position-re" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/reminder_icon.svg" class="cursor-pointer" id="reminder_driver" :title="$t('Reminders.header_tooltip')" @click="reminderVisible = true">
            </div>
            <div class="position-re" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/mic_icon.svg" class="cursor-pointer" id="talk_to_text_driver" :title="$t('TalkToText.title')" @click="talkToTextVisible = true">
            </div>
            <div class="position-re" v-if="rules && Object.keys(rules).length && (companyUser.roleType === 1 || companyUser.roleType === 2)">
                <img src="@/assets/images/svg/tour_image.svg" class="cursor-pointer" id="tour_icon" @click="getTourDetails(),tourVisible = true">
            </div>
            <div>
                <a :href="brandSettings && brandSettings?.helpLink ? brandSettings?.helpLink : 'javascript:void(0)'" :target="brandSettings && brandSettings?.helpLink  ? '_blank' : ''" class="help__icon">
                    <img :src="questionMarkIcon" alt="help" class="question__icon">
                </a>
            </div>
            <div id="profile_menu_driver">
            <DropDown :id="'profile_menu'">
                <template #button>
                    <div class="header-profile-wrapper" ref="profile_menu_dd">
                        <UserProfile
                            :showDot="false"
                            :data="{
                                image: getUser(userId).Employee_profileImageURL,
                                title: getUser(userId).Employee_Name
                            }"
                            width="35px"
                            :thumbnail="'35x35'"
                        />
                    </div>
                </template>
                <template #options>
                    <div>
                        <DropDownRouterOption v-if="rules && Object.keys(rules).length" :item="{image: profileIcon, to: {name: 'My Profile', params: {cid: companyId}}, label: $t('Header.my_profile')}" @click="$refs.profile_menu_dd.click()"/>
                        <DropDownRouterOption v-if="rules && Object.keys(rules).length" :item="{image: settingsIcon, to: {name: 'Setting', params: {cid: companyId}}, label: $t('settingslider.Settings')}" @click="$refs.profile_menu_dd.click()"/>
                        <BillingHistoryTab v-if="rules && Object.keys(rules).length && companyUser.roleType === 1" :companyId="companyId" :refs="$refs" />
                        <DropDownOption :item="{image: logoutIcon, label: $t('Header.Logout')}" @click="logout()" />
                    </div>
                </template>
            </DropDown>
            </div>
            <span class="app-version cursor-pointer" :title="$t('Changelog.view_whats_new')" @click="openChangelog()">
                v{{version}}
            </span>
        </div>

        <NotepadPanel v-model="notepadVisible" />

        <ClipsPanel v-model="clipsVisible" />

        <ReminderPanel v-model="reminderVisible" />

        <!-- Single GLOBAL clip recorder: mounted here at the app shell (sibling of
             router-view in App.vue) so an in-progress recording survives task
             open/close + route changes. Controlled by the useClipRecorder composable. -->
        <ClipRecorder />

        <TalkToTextPopover v-model="talkToTextVisible" />

        <Sidebar
            title="Test"
            v-model:visible="visible"
            :left="true"
            className="z-index-6 mobile-header-sidebar"
            width="325px !important"
            top="0px"
        >
            <template #head>
                <div class="header-mobile-title d-flex align-items-center">
                    <div class="logo-cross d-flex align-items-center justify-content-between w-100 h-100">
                    <router-link :to="{name: 'Home', params: {cid: companyId}}" class="h-100 d-flex align-items-center">
                        <img class="cursor-pointer h-100" :src="logoImage"/>
                    </router-link>
                    <img :src="closeBlueImageMobile" alt="closeButton" class="cursor-pointer close-btn-mobileheader" @click="visible = !visible"/>
                    </div>
                </div>
            </template>
            <template #body>
                <div class="px-1 d-flex flex-column  main-mobileheader-sidebar h-100 style-scroll">
                    <!-- TOP SECTION -->
                    <div v-if="rules && Object.keys(rules).length">
                        <div class="bg-white p-1 d-flex mobile-profileimg-namewrapper">
                            <!-- <UserProfile
                                :showDot="false"
                                :data="{
                                    image: getUser(userId).Employee_profileImageURL,
                                    title: getUser(userId).Employee_Name
                                }"
                                width="45px"
                                style="margin: 0px !important;"
                                ref="profile_menu_dd"
                                class="profile-lg-square"
                            /> -->
                            <img v-if="!getUser(userId).Employee_profileImageURL" :src="getUser(userId).Employee_profileImageURL" alt="user_profile" class="profile-lg-square">
                            <WasabiIamgeCompp v-else :userImage="true" :thumbnail="'35x35'" :data="{title:getUser(userId).Employee_Name, url: getUser(userId).Employee_profileImageURL}" class="profile-lg-square"/>
                            <div class="d-flex flex-column cursor-pointer mobile-degignation-wrapper" :class="{'pl-1': clientWidth > 1200, 'pt-20': clientWidth <= 1200 }">
                                <span class="font-weight-500 text-ellipsis font-size-20 mw-75 color90 pb-4px">{{getUser(userId).Employee_Name}}</span>
                                <span class="text-ellipsis mw-65">{{designations && designations.find((x) => x.key === getUser(userId)?.designation)?.name ? designations.find((x) => x.key === getUser(userId)?.designation)?.name : companyUser.roleType === 1 ? "Owner" : "N/A"}}</span>
                            </div>
                            </div>


                        <!-- COMPANY SELECTION -->
                        <div :class="`p-1 cursor-pointer border-radius-10-px bg-light-gray2 ${clientWidth > 991 ? '' : 'm0px-20px'}`"  @click="visible = false,$emit('filter')">
                            <span class="gray">{{$t('Projects.search')}}</span>
                        </div>
                        <DropDown id="company_selection_2" class="company_selection_2" :title="selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : 'N/A'">
                            <template #button>
                                <div class=" p-1 cursor-pointer border-radius-7-px text-capitalize mobile-menu-list mobile-menu-list-arrow" :class="{'hover-white:hover' : clientWidth<=991}">
                                    {{selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : "N/A"}}
                                </div>
                            </template>

                            <template #options>
                                <DropDownOption @click="$emit('change', company._id)" v-for="(company, index) in companies" :key="index" :item="{image: company.Cst_profileImage || defaultUserIcon, label: company.Cst_CompanyName}">
                                    <div class="d-flex align-items-center">
                                        <!-- <img :src="company.Cst_profileImage || defaultUserIcon" alt="company_image" class="profile-image"> -->
                                        <WasabiIamgeCompp :companyId="company.id" :data="{ url: company.Cst_profileImage || defaultUserIcon}" alt="company_image" class="profile-image"/>
                                        <span class="text-capitalize ml-10px">
                                            {{company.Cst_CompanyName}}
                                        </span>
                                    </div>
                                </DropDownOption>
                            </template>
                        </DropDown>
                        <template v-for="(item, index) in menu.filter((xt) => xt.show === true)">
                            <!-- DIRECT LINK -->
                            <router-link :key="'item'+index" :class="{'active-list-mobile' : $route.name.includes('Project')}" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" v-if="item.submenu && !item.submenu.length" :to="item.to" @click="visible = false">
                                {{ $t(`Header.${item.name}`) }}
                            </router-link>

                            <!-- FOR SUB MENU -->
                            <div :key="'nested-item-'+index" v-else>
                                <DropDown :id="'nav_menu'+index" :title="$t(`Header.${item.name}`)">
                                    <template #button>
                                        <div :class="{'active-list-mobile': item.submenu.some((s) => s.to && s.to.path && $route.path.startsWith(s.to.path))}" class="hover-white p-1 cursor-pointer border-radius-7-px mobile-menu-list mobile-menu-list-arrow">
                                            {{ $t(`Header.${item.name}`) }}
                                        </div>
                                    </template>
                                    <template #options>
                                        <DropDownRouterOption
                                            v-for="(subItem, subIndex) in item.submenu.filter((xt) => xt.show === true)"
                                            :key="subIndex"
                                            :style="`${subIndex === item.submenu.length - 1 ? 'margin-bottom:0px !important' : ''}`"
                                            @click="visible = false"
                                            :item="{to: subItem.to, label: $t(`Header.${subItem.name}`)}"
                                        />
                                    </template>
                                </DropDown>
                            </div>
                        </template>
                        <router-link  v-if="canOpenChat" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="visible = false" :class="{'active-list-mobile' : $route.name.includes('chat')}" :to="{name: 'chats', params: {cid: companyId}}">
                            {{$t('Header.Chat')}}
                        </router-link>
                        <!-- One entry where Notification and @mention used to be two. The
                             desktop bar shows the Inbox as an icon; on mobile there was no
                             entry for it at all, so removing those two without this would
                             have left no way in from here. -->
                        <router-link v-if="rules && Object.keys(rules).length" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="visible = false" :to="{name: 'inbox', params: {cid: companyId}}">
                            {{$t('Inbox.title')}}
                        </router-link>
                        <div v-if="rules && Object.keys(rules).length && (companyUser.roleType === 1 || companyUser.roleType === 2)" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="getTourDetails(),tourVisible = true,visible = false">
                            {{$t('Header.Tours')}}
                        </div>
                        <div v-if="rules && Object.keys(rules).length" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="$router.push({name: 'Setting', params: {cid: companyId}}), visible = false">
                            {{$t('settingslider.Settings')}}
                        </div>
                    </div>
                    <!-- BOTTOM SECTION -->
                    <div>
                        <div class="cursor-pointer border-radius-7-px d-flex align-items-center log-out-list font-size-18 font-weight-500 blue" @click="logout()" :style="{marginTop: '160px'}">
                            <img :src="logoutIconMobile" alt="logout" class="pr-10px">
                            {{$t('Header.Logout')}}
                        </div>
                    </div>
                </div>
            </template>
        </Sidebar>

        <Sidebar width="550px" :title="'Take a Tour'" v-model:visible="tourVisible" className='tour_sidebar'>
            <template #head>
                <div class="d-flex align-items-center justify-content-between assignee-headtitle text-capitalize">
                    {{$t('Header.take_tour')}}
                </div>
                <div class="d-flex align-items-center justify-content-between">
                    <button class="mark-all-comp-btn blue mr-20px cursor-pointer" @click="handleTourOps(tourList,true)">{{$t('Header.Mark_all_as_complete')}}</button>
                    <img :src="closeBlueImage" alt="closeButton" class="cursor-pointer" @click="tourVisible = false"/>
                </div>
            </template>
            <template #body>
                <div class="overflow-y-auto style-scroll mh-100 pt-5px">
                    <template v-if="tourList.length">
                        <div v-for="item in tourList" :key="item.id" class="notification p5px-p15px">
                            <div class="p-9px d-flex tour-box-card justify-content-between">
                                <div class="d-flex position-re align-items-center">
                                    <img class='tour_image' :src="getImageData(item.image)" :alt="item.image">
    
                                    <div class="d-flex ml-1 flex-column comment__notification-message">
                                        <strong class="tour__title font-weight-700 black font-size-16">{{item.title}}</strong>
                                        <div class="tour__description font-weight-500 font-size-14 GunPowder pr-10px overflow-hidden" :title="item.description">{{item.description}}</div>
                                    </div>
                                </div>
                                <div class="text-center">
                                    <span class="image_wrapper_tour">
                                        <img class="cursor-pointer" :src="!item.isCompleted ? tourComplete : tourRemain" alt="notificationClose" @click="handleTourOps(item)">
                                    </span>
                                </div>
                            </div>
                        </div>
                    </template>
                    <template v-else>
                        <div class="text-center cursor-pointer red py-10px">
                            <span>{{$t('Filters.no_data_found')}}</span>
                        </div>
                    </template>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
// PACKAGE
import { computed, defineComponent, defineEmits, inject, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {version} from "../../../../../package.json";
import {useHelper} from "./helper"
import { useMainChat } from "@/views/Chat/helper";
import { useStore } from "vuex";
import { useCustomComposable, useGetterFunctions } from "@/composable/index.js";

// COMPONENTS
import NavLinks from "@/components/organisms/NavLinks/NavLinks.vue";
import WasabiIamgeCompp from "@/components/atom/WasabiIamgeCompp/WasabiIamgeCompp.vue"
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import NotepadPanel from "@/components/molecules/Notepad/NotepadPanel.vue";
import ClipsPanel from "@/components/molecules/Clips/ClipsPanel.vue";
import ReminderPanel from "@/components/molecules/GeneralReminder/ReminderPanel.vue";
import ClipRecorder from "@/components/molecules/ClipRecorder/ClipRecorder.vue";
import TalkToTextPopover from "@/components/molecules/TalkToText/TalkToTextPopover.vue";
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";
import DropDownRouterOption from "@/components/molecules/DropDownRouterOption/DropDownRouterOption.vue";
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import * as env from '@/config/env';
import { apiRequest, apiRequestWithoutCompnay,useAuth } from "@/services";

// INTERFACES
const companyId = inject("$companyId");
const {getters,commit} = useStore();
const userId = inject("$userId");
const {getUser} = useGetterFunctions()
const {checkPermission} = useCustomComposable();
const clientWidth = inject("$clientWidth");
const {menu} = useHelper();
const {getProjects} = useMainChat();
const { logOut } = useAuth();
const router = useRouter();

// OPEN THE WHAT'S NEW (CHANGELOG) PAGE IN A NEW TAB
const openChangelog = () => {
    const cid = companyId?.value || localStorage.getItem("selectedCompany") || "";
    const route = router.resolve({ name: "Changelog", params: { cid } });
    window.open(`${window.location.origin}${window.location.pathname}${route.href}`, "_blank", "noopener");
};

// IMAGES
const closeBlueImage = require("@/assets/images/svg/CloseSidebar.svg");
const closeBlueImageMobile = require("@/assets/images/svg/cross_mobilesidebar_icon.svg");
const profileIcon = require("@/assets/images/svg/User_icon.svg");
const settingsIcon = require("@/assets/images/svg/Setting_icon.svg");
const logoutIcon = require("@/assets/images/svg/Logout_icon.svg");
const logoImage = '/api/v1/getlogo?key=logo&type=admin';
const logoutIconMobile = require("@/assets/images/svg/Mobile_icon/logout.svg");
const defaultUserIcon = inject("$defaultUserAvatar");
const toggle = require("@/assets/images/svg/mobile_toggle_white.svg");
const questionMarkIcon = require("@/assets/images/svg/questionmark.svg");
const headerLogo = "/api/v1/getlogo?key=logo&type=web";
// const notificationClose = require("@/assets/images/Shape 509.png");
const tourComplete = require("@/assets/images/svg/tourcomplete.svg");
const tourRemain = require("@/assets/images/svg/tourremain.svg");
const ai_tour = require("@/assets/images/svg/ai_tour.svg");
const automate_screen_tour = require("@/assets/images/svg/automate_screen_tour.svg");
const custom_field_tour = require("@/assets/images/svg/custom_field_tour.svg");
const dependencies_tour = require("@/assets/images/svg/dependencies_tour.svg");
const project_listing_tour = require("@/assets/images/svg/project_listing_tour.svg");
const task_details_tour = require("@/assets/images/svg/task_details_tour.svg");
const template_tour = require("@/assets/images/svg/template_tour.svg");
const time_tracker_tour = require("@/assets/images/svg/time_tracker_tour.svg");
const timesheet_tour = require("@/assets/images/svg/timesheet_tour.svg");

// COMPONENT
defineComponent({
    name: "Header-Component",

    components: {
        NavLinks,
        Sidebar,
        DropDown,
        DropDownOption,
        UserProfile
    }
})

defineEmits(["change"])
const brandSettings = computed(() => getters['brandSettingTab/brandSettings']);
onMounted(() => {

    if(getters['mainChat/mainChatProjects'] && !getters['mainChat/mainChatProjects']?.data?.length) {
        getProjects()
        .catch((error) => {
            console.error("ERROR in get projects chat:", error);
        })
    }

    loadInboxCount();
})

const tourImages = {
    ai_tour,
    automate_screen_tour,
    custom_field_tour,
    dependencies_tour,
    project_listing_tour,
    task_details_tour,
    template_tour,
    time_tracker_tour,
    timesheet_tour
};

const getImageData = (dataImage) => {
    return tourImages[dataImage] || defaultUserIcon;
};

// DATA
const visible = ref(false);
const tourVisible = ref(false);
const notepadVisible = ref(false);
const clipsVisible = ref(false);
const reminderVisible = ref(false);
const talkToTextVisible = ref(false);
const myCounts = computed(() => getters["users/myCounts"]?.data || {})
const totalNotification = computed(() => myCounts.value?.notification_counts);
const totalMentions = computed(() => myCounts.value?.mention_counts)

// Unread groups on the Inbox's Primary tab.
//
// Its own request rather than a slice of myCounts, because "important" is decided by
// the Inbox's own rules and grouping — a number the existing counts payload has no way
// to produce. Kept out of the render path entirely: it starts at 0, the dot simply
// appears if the call comes back with something, and a failure leaves it at 0 rather
// than blocking a header that every page depends on.
/**
 * The inbox dot: shown only when something is genuinely unread.
 *
 * It deliberately does NOT read myCounts. That is a stored counters document maintained
 * by increments, and increments drift — on this instance it reads 8 notifications and 2
 * mentions where the collections actually hold 154 and 5. A dot driven by that lights up
 * with nothing behind it, or stays dark when there is something.
 *
 * /inbox/counts counts the rows themselves, so it cannot drift.
 *
 * myCounts is still used, but as a TRIGGER rather than a source: it changes over a socket
 * the moment a notification arrives, so watching it re-checks the truth at exactly the
 * right time. Live, and correct.
 */
const inboxUnreadCount = ref(0);
// Debounced, because reading ten notifications in the bell moves myCounts ten times and
// only the final state matters. Bursts collapse into one check.
let inboxCountTimer = null;
const loadInboxCount = () => {
    clearTimeout(inboxCountTimer);
    inboxCountTimer = setTimeout(() => {
        apiRequest("get", `${env.INBOX}/counts`).then((response) => {
            if (response?.data?.status) inboxUnreadCount.value = Number(response.data.data?.all) || 0;
        }).catch(() => {
            // Deliberately NOT zeroed. A failed request is not evidence of an empty inbox,
            // and the checks after this one are all event-driven — myCounts changing, or
            // leaving the inbox. Zeroing here turned a single failure into a permanently
            // dark dot: restarting the API while the page is open fails the mount check,
            // and with the counters collection quiet nothing ever asks again.
        });
    }, 400);
};

// These two watches sit HERE, not up beside onMounted, because `watch` evaluates its
// getter immediately during setup — referencing totalNotification above its own `const`
// threw "Cannot access 'totalNotification' before initialization" and took the whole
// header down. onMounted is fine either way: its callback runs after setup completes.
//
// myCounts moves over a socket whenever a notification or mention arrives, and again when
// one is read. That is the cue to re-check the real unread count, so the dot tracks
// reality without polling for it.
watch(() => [totalNotification.value, totalMentions.value], () => {
    loadInboxCount();
})

// Leaving the inbox is the other moment it goes stale: things were just read there.
watch(() => router.currentRoute.value.name, (to, from) => {
    if (from === 'inbox' && to !== 'inbox') loadInboxCount();
})

// Coming back to the tab is the recovery path. Every other check above is driven by
// something happening inside this tab, so a check that failed while the tab was in the
// background — or while the API was restarting — would never be retried. Cheaper than
// polling, and it lands exactly when the user is about to look at the dot.
const recheckInboxCount = () => { if (!document.hidden) loadInboxCount(); };
onMounted(() => { document.addEventListener('visibilitychange', recheckInboxCount); });
onUnmounted(() => {
    document.removeEventListener('visibilitychange', recheckInboxCount);
    clearTimeout(inboxCountTimer);
})

const companyUser = ref(getters['settings/companyUserDetail']);

const dispatchEventForFilet = () => {
    var ctrlKEv = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'k',
        ctrlKey: true
    });
    document.dispatchEvent(ctrlKEv);
}

function processSprint(pid) {
    let total = 0;
    const keys = Object.keys(myCounts.value || {}).filter((x) => x.includes(`task_${pid}`));
    keys.forEach((key) => {
        if(myCounts.value?.[key]) {
            total += myCounts.value?.[key] || 0;
        }
    })

    return total;
}

const totalMainCounts = computed(() => {
    let total = 0;
    getters["mainChat/mainChatProjects"]?.data?.forEach((x) => {
        total += processSprint(x._id)
    })
    return total;
})

const companies = computed(() => {
    return (getters["settings/companies"] || []);
})

const filteredCompanies = computed(() => {
    return companies.value.filter((x) => x._id !== companyId.value)
})

const designations = computed(() => getters["settings/designations"])
watch(clientWidth,(newVal)=>{
    if(newVal > 990 && visible.value == true) {
        visible.value = false;
    }
})

const tourList = ref([]);
const selectedCompany = ref("");
watchEffect(async () => {
    selectedCompany.value = companies.value.find((company) => company._id === companyId.value);
})
const rules = computed(() => {
    return getters['settings/rules']
})

/**
 * May this user open the Chat module?
 *
 * `checkPermission('chat')` reads the PARENT "Chat" row — the module gate. The finer
 * keys (one_to_one_chat, chat_category, chat_channel) govern what you can do once
 * inside, not whether you get in.
 *
 * The old test was `== true`, i.e. Read & Write only, so a role granted **Read** on
 * Chat had the icon hidden and no way into a module it was explicitly allowed to
 * read. Only None hides it now. Owner/Admin still short-circuit to true inside
 * checkPermission.
 *
 * The `rules` guard matches every other icon in this row: before the rule set loads
 * checkPermission returns null for everyone, so without it the icon flickers in.
 */
const canOpenChat = computed(() => {
    if (!rules.value || !Object.keys(rules.value).length) return false;
    const permission = checkPermission('chat');
    return permission !== null && permission !== undefined;
})

const logout = () => {
    logOut({islogOut:true});
}

function getTourDetails() {
    try {
        tourList.value = JSON.parse(JSON.stringify(getters['ToursData/Tours']));
        return tourList.value
    } catch (error) {
      console.error(`ERROR in getTourDetails`, error);
    }
}

function handleTourOps(tourObject,isComplateAll = false) {
    try {
        if(!isComplateAll) {
            let tourUpdateObject = {
                ...(getUser(userId.value).tourStatus && getUser(userId.value).tourStatus),
                [tourObject.id]: !JSON.parse(JSON.stringify(tourObject)).isCompleted
            }
            const updateObject = {
               $set:{tour: tourUpdateObject}
            }
            const newObj = {
                returnDocument: 'after'
            }
            apiRequestWithoutCompnay("put",env.USER_UPATE,{
                userId: userId.value,
                updateObject:updateObject,
                newObj
            }).then((response)=>{
                let find = tourList.value.findIndex((e)=>e.id == tourObject.id);
                if(find !== -1) {
                    tourList.value[find] = {...tourList.value[find],...tourObject,'isCompleted': !tourObject.isCompleted};
                    commit("ToursData/mutateSingleTours",{
                        id:tourObject.id,
                        isCompleted: !tourObject.isCompleted
                    });
                    commit("users/mutateUsers", {
                        data: {
                            ...response.data.data,
                            tourStatus: tourObject
                        },
                        op: "modified",
                    });
                }
            }).catch((err)=>{
                console.error("ERROR: ", err);
            });
        } else {
            let tours = tourList.value.reduce((f, e) => {
                f[e.id] = true;
                return f;
            }, {});

            const updateObject = {
                $set: { tour: tours }
            }
            const newObj = {
                returnDocument: 'after'
            }
            apiRequestWithoutCompnay("put",env.USER_UPATE,{
                userId: userId.value,
                updateObject:updateObject,
                newObj
            }).then((response)=>{
                tourList.value = tourList.value.map((e)=>{
                    return {...e, isCompleted: true};
                });
                commit("ToursData/mutateTours",tourList.value);
                commit("users/mutateUsers", {
                    data: {
                        ...response.data.data,
                        tourStatus: tourObject
                    },
                    op: "modified",
                });
            }).catch((e)=>{
                console.error(e);
            })
        }
    } catch (error) {
        console.error(`ERROR in handleTourOps`, error);
    }
}
</script>

<style>
@import './style.css';

</style>