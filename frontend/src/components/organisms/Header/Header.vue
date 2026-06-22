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
        <div class="d-flex align-items-center justify-content-between z-index-5" v-if="clientWidth > 990">
            <!-- COMPANY SELECTION -->
            <div class="d-flex" id="company_dropdown_driver">
            <span v-if="rules && Object.keys(rules).length" class="company-text">{{$t('settingslider.Company')}}</span>
            <template v-if="rules && Object.keys(rules).length">
                <DropDown id="company_selection" v-if="filteredCompanies.length" class="company_name_displayed">
                    <template #button>
                        <div class="cursor-pointer text-capitalize dropdown_wrapper pr-22px text-ellipsis" :title="selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : 'N/A'" :class="{'mr-2' : clientWidth > 1440, 'mr-1' : clientWidth<=1440}">
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
                <div class="text-capitalize font-size-13 font-weight-500 text-ellipsis company_name_displayed" :class="{'mr-2' : clientWidth > 1440, 'mr-1' : clientWidth<=1440}" v-else :title="selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : 'N/A'">
                    {{selectedCompany && selectedCompany.Cst_CompanyName ? selectedCompany.Cst_CompanyName : "N/A"}}
                </div>
            </template>
            </div>
            <router-link class="position-re" :class="{'mr-2' : clientWidth > 1440, 'pr-1' : clientWidth<=1440}" :to="{name: 'chats', params: {cid: companyId}}" v-if="checkPermission('chat') == true">
                <img src="@/assets/images/svg/chat_icon.svg" class="cursor-pointer" id="chat_driver"/>
                <span v-if="totalMainCounts" class="notification-tick blinking"></span>
            </router-link>
            <div class="position-re" :class="{'mr-2' : clientWidth > 1440, 'mr-1' : clientWidth<=1440}" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/header_notification.svg" class="cursor-pointer" id="notification_driver" @click="openNotificationsDropdown()">
                <span :class="{'notification-tick': totalNotification}" class="blinking"></span>
            </div>
            <div class="position-re" :class="{'pr-2' : clientWidth > 1440, 'pr-1' : clientWidth<=1440}" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/comment_mention.png" class="cursor-pointer" id="mention_driver" @click="getMentions(!mentions.length), showNotification = 1, notificationVisible = true">
                <span :class="{'notification-tick': totalMentions > 0}" class="blinking"></span>
            </div>
            <div class="position-re" :class="{'mr-2' : clientWidth > 1440, 'mr-1' : clientWidth<=1440}" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/sticky_note_icon.svg" class="cursor-pointer" id="stickies_driver" :title="$t('Stickies.title')" @click="stickiesVisible = true">
            </div>
            <div class="position-re" :class="{'mr-2' : clientWidth > 1440, 'mr-1' : clientWidth<=1440}" v-if="rules && Object.keys(rules).length">
                <img src="@/assets/images/svg/notepad_icon.svg" class="cursor-pointer" id="notepad_driver" :title="$t('Notepad.title')" @click="notepadVisible = true">
            </div>
            <div class="position-re" :class="{'pr-2' : clientWidth > 1440, 'pr-1' : clientWidth<=1440}" v-if="rules && Object.keys(rules).length && (companyUser.roleType === 1 || companyUser.roleType === 2)">
                <img src="@/assets/images/svg/tour_image.svg" class="cursor-pointer" id="tour_icon" @click="getTourDetails(),tourVisible = true">
            </div>
            <div :class="{'pr-2' : clientWidth > 1440, 'pr-1' : clientWidth<=1440}">
                <a :href="brandSettings && brandSettings?.helpLink ? brandSettings?.helpLink : 'javascript:void(0)'" :target="brandSettings && brandSettings?.helpLink  ? '_blank' : ''" class="help__icon">
                    <img :src="questionMarkIcon" alt="help" class="question__icon">
                </a>
            </div>
            <div id="profile_menu_driver">
            <DropDown class="pr-1" :id="'profile_menu'">
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

        <StickiesPanel v-model="stickiesVisible" />

        <NotepadPanel v-model="notepadVisible" />

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
                        <router-link  v-if="rules && Object.keys(rules).length && checkPermission('chat') == true" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="visible = false" :class="{'active-list-mobile' : $route.name.includes('chat')}" :to="{name: 'chats', params: {cid: companyId}}">
                            {{$t('Header.Chat')}}
                        </router-link>
                        <div  v-if="rules && Object.keys(rules).length" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="openNotificationsDropdown(true)">
                            {{$t('Header.Notification')}}
                        </div>
                        <div v-if="rules && Object.keys(rules).length" class="p-1 cursor-pointer border-radius-7-px mobile-menu-list" @click="getMentions(!mentions.length), showNotification = 1, notificationVisible = true, visible = false">
                            @{{$t('Header.mention')}}
                        </div>
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

        <Sidebar width="550px" :title="!showNotification ? $t('Header.Notifications') : $t('Header.mentions')" v-model:visible="notificationVisible">
            <template #head>
                <div class="d-flex align-items-center justify-content-between assignee-headtitle text-capitalize">
                    {{!showNotification ? $t('Header.Notifications') : $t('Header.mentions')}}
                </div>
                <div class="d-flex align-items-center justify-content-between">
                    <!-- Unread / Archive toggle. Only applies to notifications, not mentions. -->
                    <button
                        v-if="!showNotification"
                        class="outline-primary mr-10px"
                        @click="switchNotificationFilter(notificationFilter === 'unread' ? 'archived' : 'unread')">
                        {{ notificationFilter === 'unread' ? $t('Header.View_Archive') : $t('Header.View_Unread') }}
                    </button>
                    <!-- Show "Mark all as read" whenever there are unread items visible. Using
                         `notifications.length` (the list is already filtered to unread on this
                         view) instead of the server-side `totalNotification` counter, which
                         can lag behind and falsely hide the button. -->
                    <button v-if="!showNotification ? (notificationFilter === 'unread' && notifications.length > 0) : totalMentions > 0" class="outline-primary mr-10px" @click="markAllRead(!showNotification ? 'notifications' : 'mentions')">{{$t('Header.Mark_all_as_read')}}</button>
                    <img :src="closeBlueImage" alt="closeButton" class="cursor-pointer" @click="notificationVisible = false"/>
                </div>
            </template>
            <template #body>
                <Spinner :isSpinner="isSpinner" v-if="isSpinner && !notifications.length"/>
                <div class="overflow-y-auto style-scroll mh-100" v-else>
                    <template v-if="(!showNotification ? notifications : mentions).length">
                        <div v-for="item in (!showNotification ? notifications : mentions)" :key="item.id" :class="{'bg-light-gray': !item.seen, 'bg-white': item.seen}" class="border-bottom notification">
                            <div class="d-flex p-1 position-re cursor-pointer" @click="markRead(item, !showNotification ? 'notifications' : 'mentions')">
                                <!-- <img v-if="!showNotification" @click.stop="markRead(item, !showNotification ? 'notifications' : 'mentions', false), notifications.length < 1 ? getNotifications(true) : ''" :src="notificationClose" alt="notificationClose" class="position-ab d-none notification-close-icon"> -->

                                <UserProfile :showDot="false" :data="{
                                        image: getUser(item['userId']).Employee_profileImageURL,
                                        title: getUser(item['userId']).Employee_Name
                                    }"
                                    width="45px"
                                    :thumbnail="'40x40'"
                                />
                                <!-- <img :src="getUser(item[!showNotification ? 'UserId' : 'userId']).Employee_profileImageURL" :alt="getUser(item[!showNotification ? 'UserId' : 'userId']).Employee_Name" class="profile-image"> -->

                                <div class="d-flex ml-1 flex-column comment__notification-message">
                                    <strong>{{getUser(item['userId']).Employee_Name}}</strong>
                                    <div v-html="!showNotification ? item.message : `<p>${changeText(item.comment_message)}</p>`"></div>

                                    <span class="">{{ getDateAndTime(new Date(item?.createdAt).getTime()) }}</span>
                                </div>
                            </div>
                        </div>

                        <div v-if="(!showNotification ? !noNotifications : !noMentions)" class="text-center cursor-pointer blue py-10px" @click="!showNotification ? getNotifications(true) : getMentions(true)">
                            <span>{{$t('Header.load_more')}}</span>
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
import { computed, defineComponent, defineEmits, inject, onMounted, ref, watch, watchEffect } from "vue";
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
import StickiesPanel from "@/components/molecules/Stickies/StickiesPanel.vue";
import NotepadPanel from "@/components/molecules/Notepad/NotepadPanel.vue";
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";
import DropDownRouterOption from "@/components/molecules/DropDownRouterOption/DropDownRouterOption.vue";
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue"
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue"
import { useProjects } from '@/composable/projects';
import * as env from '@/config/env';
import { apiRequest, apiRequestWithoutCompnay,useAuth } from "@/services";
import { UPDATE_UNREADREAD_COMMENTS_COUNT, USER_ID_COLLECTION, APP_NOTIFICATION } from "@/config/env";
import { clearFilterSignal } from "@/views/Projects/helper";

// INTERFACES
const companyId = inject("$companyId");
const {getters,commit} = useStore();
const userId = inject("$userId");
const {getUser} = useGetterFunctions()
const {changeText,checkPermission} = useCustomComposable();
const clientWidth = inject("$clientWidth");
const {openRoute, menu} = useHelper();
const {getProjects} = useMainChat();
const {getDateAndTime} = useProjects();
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
const showNotification = ref(0);
const notificationVisible = ref(false);
const tourVisible = ref(false);
const stickiesVisible = ref(false);
const notepadVisible = ref(false);
const myCounts = computed(() => getters["users/myCounts"]?.data || {})
const totalNotification = computed(() => myCounts.value?.notification_counts);
const totalMentions = computed(() => myCounts.value?.mention_counts)
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

const batchSize = ref(10)
// NOTIFICATION
const notifications = ref([]);
const noNotifications = ref(false);
const notificationSkip = ref(0);
// 'unread' (default, shown when the bell first opens) | 'archived' (View Archive)
const notificationFilter = ref('unread');

// MENTIONS
const mentions = ref([]);
const noMentions = ref(false);
const firstMention = ref("");
const lastMention = ref("");

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
const isSpinner = ref(false);
const selectedCompany = ref("");
watchEffect(async () => {
    selectedCompany.value = companies.value.find((company) => company._id === companyId.value);
})
const rules = computed(() => {
    return getters['settings/rules']
})

const logout = () => {
    logOut({islogOut:true});
}

function getNotifications(loadMore = false) {
    isSpinner.value = true;
    if (loadMore) {
        if (notifications?.value?.length > 0) {
            notificationSkip.value = notifications?.value?.length
            batchSize.value  = notifications?.value?.length + 10
        }
    }

    const url = `${APP_NOTIFICATION}/notification?userId=${userId.value}&loadMore=${loadMore}&batchSize=${batchSize.value}&notificationSkip=${notificationSkip.value}&filter=${notificationFilter.value}`;
    apiRequest("get", url).then((response) => {
        if (response.data.status) {
            const data = response.data.data;

            if (data.length <= 0) {
                if (loadMore) {
                    noNotifications.value = true;
                }
                isSpinner.value = false;
                return;
            }

            let uniqueNotifications = data
                .map((x) => ({
                    ...x,
                    seen: x.notSeen === undefined || !x.notSeen.includes(userId.value),
                }))
                .filter(newNotif => !notifications.value.some(existingNotif => existingNotif._id === newNotif._id));

            if (loadMore) {
                notifications.value = [...notifications.value, ...uniqueNotifications];
            } else {
                notifications.value = [...uniqueNotifications, ...notifications.value];
            }
            isSpinner.value = false;
        }
    })
    .catch((error) => {
        isSpinner.value = false;
        console.error(`Error in getNotifications hook => ${error}`);
    });
}

function switchNotificationFilter(newFilter) {
    if (newFilter !== 'unread' && newFilter !== 'archived') return;
    if (notificationFilter.value === newFilter) return;
    notificationFilter.value = newFilter;
    // Reset paging state so the new filter starts a fresh fetch.
    notifications.value = [];
    notificationSkip.value = 0;
    batchSize.value = 10;
    noNotifications.value = false;
    getNotifications(false);
}

function openNotificationsDropdown(closeMobileMenu = false) {
    // Always land in the Unread view when the bell opens — matches the
    // "initially only unread" UX requirement. The "View Archive" button in
    // the dropdown head flips this to 'archived'.
    notificationFilter.value = 'unread';
    notifications.value = [];
    notificationSkip.value = 0;
    batchSize.value = 10;
    noNotifications.value = false;
    showNotification.value = 0;
    notificationVisible.value = true;
    if (closeMobileMenu) {
        visible.value = false;
    }
    getNotifications(false);
}

async function getMentions(loadMore = false) {
    if (mentions.value.length === 0 || !loadMore) {
        isSpinner.value = true;
    }

    const lastCreatedAt = lastMention.value?.createdAt || '';
    const firstCreatedAt = firstMention.value?.createdAt || '';
    const url = `${APP_NOTIFICATION}/mentions?userId=${userId.value}&mentions=${mentions?.value?.length || 0}&lastMention=${lastCreatedAt}&firstMention=${firstCreatedAt}&loadMore=${loadMore}`;

    try {

        const response = await apiRequest("get", url);
        const res = response.data;

        if (res.status) {
            let data = res.data || [];
            const mentionsData = data?.map((mention) => ({
                ...mention,
                id: mention._id,
                seen: mention.notSeen === undefined || !mention.notSeen.includes(userId.value)
            }));
            if (!mentionsData || mentionsData.length === 0) {
                isSpinner.value = false;
                if (loadMore) {
                    noMentions.value = true;
                }
                return;
            }

            if (loadMore) {
                lastMention.value = mentionsData[mentionsData.length - 1];
            }

            if (!loadMore) {
                firstMention.value = mentionsData[0];
            }

            const uniqueMentions = mentionsData.filter(
                (newMention) => !mentions.value.some((existing) => existing.id === newMention.id)
            );

            const tmp = uniqueMentions.map((x) => ({
                ...x,
                id: x.id,
                seen: x.notSeen === undefined || !x.notSeen.includes(userId.value)
            }));

            if (loadMore) {
                mentions.value = [...mentions.value, ...tmp];
            } else {
                mentions.value = [...tmp, ...mentions.value];
            }
        }
    } catch (error) {
        console.error(`Error in getMentions hook:`, error);
        if (!loadMore && mentions.value.length === 0) {
            noMentions.value = true;
        }
    } finally {
        if (mentions.value.length > 0 || !loadMore) {
            isSpinner.value = false;
        }
    }
}

function markRead(data, key, redirect = true) {
    // Once an item is marked read it stops belonging to the "unread" view.
    // Drop it from the local list so the dropdown doesn't keep showing it
    // while the user is filtered to unread.
    const dropFromUnreadList = () => {
        if (key === 'notifications' && notificationFilter.value === 'unread') {
            notifications.value = notifications.value.filter((x) => x._id !== data._id);
        }
    };

    if(data.notSeen && !data.notSeen.includes(userId.value)) {
        if(redirect) {
            clearFilterSignal.value++;
            openRoute(data, key,{gettersVal: getters});
            notificationVisible.value = false;
            data.seen = true;
        } else {
            notifications.value = notifications.value.filter((x) => x._id !== data._id);
        }
        dropFromUnreadList();
        return;
    }

    const params = {
        id: data._id,
        key: key,
        userId: userId.value
    }
    apiRequest("put", `${APP_NOTIFICATION}/mark-read`, params).then(() => {
        if(redirect) {
            clearFilterSignal.value++;
            openRoute(data, key,{gettersVal: getters});
            notificationVisible.value = false;
            data.seen = true;
        } else {
            notifications.value = notifications.value.filter((x) => x._id !== data._id);
        }
        dropFromUnreadList();

        if(key === 'notifications' ? totalNotification.value <= 0 : totalMentions.value <= 0) return;

        // UPDATE COUNTS OF MENTIONS
        let mentionCounts = {
            companyId : companyId.value,
            key : key === 'notifications' ? 5 : 4,
            userIds: [userId.value],
            readAll: false,
            read: true
        }
        apiRequest("post", UPDATE_UNREADREAD_COMMENTS_COUNT, mentionCounts).catch((error) => {
            console.error(error,"ERROR");
        })

        // Delete message from global database
        apiRequest("delete", `${APP_NOTIFICATION}/mark-read/${key}/${data._id}`).catch((error) => {
            console.error(`Error in deleting ${key} from global: ${error}`);
        })
    })
    .catch((error) => {
        console.error(`Error in mark ${key} seen: ${error}`);
    })
}

function markAllRead(key) {

    if(key === 'notifications') {
        notifications.value.filter((x) => !x.seen).forEach((data) => data.seen = true);
        // After marking everything read, all items belong to "archived" — so
        // clear them out of the dropdown if the user is on the Unread view.
        if (notificationFilter.value === 'unread') {
            notifications.value = [];
        }
    } else {
        mentions.value.filter((x) => !x.seen).forEach((data) => data.seen = true);
    }

    const notifyParams = {
        userId: userId.value,
        key: key
    };
    apiRequest("put", `${APP_NOTIFICATION}/mark-all-read`, notifyParams).catch((error) => {
        console.error(`Error in update ${key} info in mark-all-read: ${error}`);
    })

    const params = {
        userId: userId.value,
        key: key
    };
    apiRequest("put", USER_ID_COLLECTION, params).catch((error) => {
        console.error(`Error in update ${key} seen info: `, error);
    })
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