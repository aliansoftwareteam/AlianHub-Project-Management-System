<template>
	<div>
		<OfflineBanner/>
		<DemoBanner/>
		<MaintenanceBanner/>
		<MaintenanceCard v-if="maintenanceBlocksPage"/>
		<template v-else-if="$route.meta.requiresAuth">
			<template v-if="shellReady">
                <!-- Mounted at the root so an incoming call rings wherever the user is,
                     not only when the conversation that called them is on screen. -->
                <CallOverlay />
                <template v-if="legacyNav">
                    <HeaderComponent v-if="!$route.meta.hideHeader" @change="changeCompany($event)" @filter="handleFilter"/>
                    <div :style="`height: calc(100dvh - ${$route.meta.hideHeader ? '0' : '46'}px);`" class="billing__history-wrapper style-scroll overflow-auto">
                        <CommandPalette v-if="!$route.meta.preventAdvanceSearch" :open="isAdvanceSearch" @close="isAdvanceSearch = false"/>
                        <QuickCreateTask />
                        <AiUnavailable v-if="aiGated"/>
                        <router-view v-else/>
                        <TourCom ref="mainTour"/>
                    </div>
                </template>
                <div v-else class="ah-app">
                    <GlobalRail v-if="!$route.meta.hideHeader" @change="changeCompany($event)" />
                    <main class="ah-app__main" id="ah-main">
                        <CommandPalette v-if="!$route.meta.preventAdvanceSearch" :open="isAdvanceSearch" @close="isAdvanceSearch = false"/>
                        <QuickCreateTask />
                        <div class="ah-app__view billing__history-wrapper style-scroll">
                            <AiUnavailable v-if="aiGated"/>
                            <router-view v-else/>
                        </div>
                        <TourCom ref="mainTour"/>
                        <TaskDetailOverlay />
                        <!-- Handoff 28b surface 4. Mounted here rather than on the AI pages so
                             the rail's running count is true everywhere, not only after a visit
                             to /ai. Renders nothing when no one is live. -->
                        <AgentLiveStrip />
                    </main>
                    <MobileTabBar v-if="!$route.meta.hideHeader" />
                    <ShellPanels v-if="!$route.meta.hideHeader" />
                </div>
			</template>
			<div v-else-if="!companyId?.length && $route.name === 'Create_Company'" class="d-flex align-items-center justify-content-center lds-roller h-100dvh">
				<router-view/>
			</div>
			<div v-else class="d-flex align-items-center justify-content-center lds-roller h-100dvh">
				<img :src="logo" alt="logo" class="position-ab z-index-1 company__logo">
				<div class="spinner"></div>
			</div>
		</template>
		<div v-else class="overflow-data h-100vh">
			<router-view/>
		</div>
        <template v-if="userId && showReviewModal">
            <ReviewPromptModal/>
        </template>
        <UpgradeProcessModel 
            v-if="openReleaseNoteModel === true" 
            :openReleaseNoteModel="openReleaseNoteModel"
            :fromWhich="'App'"
            @closeReleaseNoteModel="(val) => {openReleaseNoteModel = val}" >
        </UpgradeProcessModel>
	</div>
</template>
<script setup>
// PACKAGES
import { computed, defineComponent, onMounted, provide, ref, watch, inject} from 'vue'
// COMPONENTS
import TourCom from "@/components/organisms/Tour/TourComponet.vue"
import MaintenanceBanner from "@/views/Settings/Instance/MaintenanceBanner.vue"
import MaintenanceCard from "@/views/Settings/Instance/MaintenanceCard.vue"
import { maintenanceOn } from "@/composable/maintenanceState"
import HeaderComponent from '@/components/organisms/Header/Header.vue'
import GlobalRail from '@/components/organisms/Shell/GlobalRail.vue'
import MobileTabBar from '@/components/organisms/Shell/MobileTabBar.vue'
import ShellPanels from '@/components/organisms/Shell/ShellPanels.vue'
import TaskDetailOverlay from '@/components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue'
import AgentLiveStrip from '@/views/Ai/AgentLiveStrip.vue'
import '@/components/organisms/Shell/style.css'
import CallOverlay from '@/components/organisms/CallOverlay/CallOverlay.vue'
import CommandPalette from '@/components/molecules/AdvanceSearch/CommandPalette.vue'
import QuickCreateTask from '@/components/organisms/QuickCreateTask/QuickCreateTask.vue'
import { PALETTE_OPEN_EVENT, isPaletteShortcut } from '@/components/molecules/AdvanceSearch/paletteKeys'
import { useStore } from 'vuex';
import axios from 'axios'
import { refreshWebPush } from '@/composable/browserNotifications';
import { useToast } from "vue-toast-notification"

// COMPOSABLES
const { getters, dispatch, commit } = useStore();
const $toast = useToast();
import { useI18n } from "vue-i18n";
const { t } = useI18n();
const paymentInit = inject("paymentInit");
// IMAGES
// import logo from '@/assets/images/png/logo.png'
const logo = "/api/v1/getlogo?key=logo&type=desktop";
import { useRoute, useRouter } from 'vue-router';
import { languageTranslateHelper } from './composable/index';
import {socketHelper} from './composable/socketHelper';
import { apiRequest,apiRequestWithoutCompnay } from './services';
import OfflineBanner from '@/components/offline/OfflineBanner.vue';
import { initOffline } from '@/offline';
import * as env from '@/config/env';
import {tabSyncHelper} from '@/utils/tabSyncs.js';
import AiUnavailable from '@/components/molecules/AiUnavailable/AiUnavailable.vue';
import { aiAvailability, loadAiAvailability } from '@/composable/aiAvailability';
import { AI_GATE, aiGateFor } from '@/router/ai/gate';
const {tabSync} = tabSyncHelper();
const mainTour = ref();

// COMPONENT
defineComponent({
    name: 'App',

	components: {
        HeaderComponent
	}
})

const {selectedLanguageCode, changeLanguage} = languageTranslateHelper();
const { locale, setLocaleMessage } = useI18n();

const companyId = ref(localStorage.getItem('selectedCompany') !== null ? localStorage.getItem('selectedCompany') : "")
// Escape hatch for one release: the old top bar stays reachable behind a flag.
const legacyNav = ref(localStorage.getItem('ah.legacyNav') === '1');
const logged = ref(false);
const showReviewModal = ref(false);
const showSpinner = ref(true);
const clientWidth = ref(document.documentElement.clientWidth);
const userId = ref('');
const router = useRouter();
const route = useRoute();
const dateFormat = ref("DD/MM/YYYY");
const isAdvanceSearch = ref(false);
const openReleaseNoteModel = ref(false);
const defaultImageUser = require("@/assets/images/default_user.png")
const socket = ref(null);
// The shell waits for the connect attempt to settle, not for it to succeed — live updates
// are a transport, and the data behind this UI arrives over HTTP either way.
const socketSettled = ref(false);
const defaultTaskStatus = require("@/assets/images/defaut_task_status_img.png");
const defaultGhostCustomUser = `${env.API_URI}/api/v1/getlogo?key=ghostuser`;

const rules = ref({});
const {connectServer} = socketHelper();
const currentUser = computed(() => getters["users/currentUser"]);
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const aiGated = computed(() => aiGateFor(route.name, aiAvailability.state) === AI_GATE.PAGE);

watch(() => [logged.value, currentCompany.value?._id], ([isLogged, cid]) => {
    if (isLogged && cid) loadAiAvailability(cid);
}, { immediate: true });

watch(() => currentUser.value, (val) => {
    if(val?.isVesionUpdate){
        openReleaseNoteModel.value = true;
    }
})


watch(() => getters['settings/rules'], (val) => {
	rules.value = val;
})
watch(route, (newVal) => {
	const hasSession = !!localStorage.getItem("userId");
    if(newVal?.name === 'Support'){
        if(hasSession && !companyId.value){
            return router.push({name : 'Create_Company'});
        }
        return;
    } else if(newVal.params.cid && newVal.params.cid !== companyId.value){
        changeCompany(newVal.params.cid);
    } else if(!companyId.value && hasSession){
        router.push({name : 'Create_Company'});
    }
})

function checkUserCompany (uid,forDisable = false) {
    return new Promise((resolve,reject) => {
        try {
            apiRequestWithoutCompnay('get',`${env.USER_UPATE}/${uid}`)
            .then((res) => {
                if(res.status === 200){
                    const result = res.data;
                    if(result?.AssignCompany.length === 0){
                        resolve("");
                        rules.value = {};
                        localStorage.removeItem("selectedCompany");
                        commit("settings/mutateSelectedCompany", companyId.value);
                        companyId.value = '';
                        router.push('/business');
                        return;
                    }else{
                        if(forDisable){
                            const comapnyValue = getters['settings/companies'].filter((cmp) => result?.AssignCompany.includes(cmp._id)).find((x) => x.isDisable == false);
                            if(comapnyValue){
                                resolve(comapnyValue._id || "");
                            }else{
                                resolve("");
                            }
                        }else{
                            resolve(result?.AssignCompany[0] || "");
                        }
                    }
                }else{
                    reject(res.message);
                    $toast.error(t("generalErrorMessage.something_went_wrong"),{position: 'top-right'});
                }
            })
        } catch (error) {
            reject(error)
        }
    })
}

const companyUserDetail = ref({});
watch(() => getters['settings/companyUserDetail'], async(val) => {
    if(val.isDelete === true){
        await checkUserCompany(userId.value).then((response) => {
            localStorage.removeItem("selectedCompany");
            companyId.value = '';
            if(!Object.keys(companyId.value).length){
                companyId.value = response;
                commit("settings/mutateSelectedCompany", companyId.value);
                if(response !== ""){
                    localStorage.setItem("selectedCompany",companyId.value);
                }
            }
            return true;
        }).catch((err) => {
            console.error(err,"errerr");
        })
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    }
	companyUserDetail.value = val;
})

const shellReady = computed(() => Boolean(logged.value && rules.value && Object.keys(rules.value).length && companyUserDetail.value && Object.keys(companyUserDetail.value).length && socketSettled.value));
// A page that loaded before maintenance began keeps its content under the banner; one whose boot calls were refused would otherwise stay blank or spin forever.
const maintenanceBlocksPage = computed(() => maintenanceOn.value && (route.meta.requiresAuth ? !shellReady.value : !route.matched.length));

watch(() => getters['settings/selectedCompany'], async(val) => {
    if(val.isDisable === true){
        await checkUserCompany(userId.value,true).then((response) => {
            if(response === ''){
                companyId.value = '';
                localStorage.removeItem("selectedCompany");
            }else{
                companyId.value = response;
                commit("settings/mutateSelectedCompany", companyId.value);
                if(response !== ""){
                    localStorage.setItem("selectedCompany",companyId.value);
                }
            }
            return true;
        }).catch((err) => {
            console.error(err,"errerr");
        })
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    }
})

async function getFirebaseData() {
    if(getters['settings/companies'] && !getters['settings/companies'].length) {
        let localUserId = localStorage.getItem("userId") || null;
        
        const userDetail = localUserId?  await apiRequestWithoutCompnay('get',`${env.USER_UPATE}/${localUserId}`) : null;
        if (userDetail) {
            let user = userDetail.data
            
            if(user) {
                userId.value = user._id;
                
                localStorage.setItem('logged', true);

                const userResult = await apiRequestWithoutCompnay('get',`${env.USER_UPATE}/${userId.value}`);
                let userData = {}

                if(userResult.status === 200){
                    userData = userResult.data;
                }

                if(userData.languageCode){
                    localStorage.setItem('language', userData.languageCode);
                    const updateLanguage = await changeLanguage(userData.languageCode);
                    locale.value = userData.languageCode;
                    setLocaleMessage(userData.languageCode, updateLanguage || "en");
                }

                await dispatch('settings/setCompanies', userData?.AssignCompany)
                .catch((error) => {
                    console.error("ERROR in set companies: ", error)
                    return;
                })

                if(userData?.AssignCompany.length > 0){
                    if(!userData?.AssignCompany.includes(companyId.value)) {
                        let findCompany = getters['settings/companies'].filter((x) => userData?.AssignCompany.includes(x._id)).filter((y) => y.isDisable === undefined || y.isDisable === false);
                        if(findCompany.length > 0){
                            await changeCompany(findCompany[0]._id)
                        }else{
                            router.push('/business');
                        }
                    }
                }else{
                    router.push('/business');
                }


                if(!companyId.value?.length){
                    checkUserCompany(userId.value)
                    return;
                }
                commit("settings/mutateSelectedCompany", companyId.value);

                dispatch("users/setUsers", {cid: companyId.value}).then(() => {
                    logged.value = true;
                }).catch((error) => {
                    logged.value = true;
                    console.error("ERROR in setUsers: ", error);
                }); 
                if (getters['ToursData/Tours'] && !(getters['ToursData/Tours'])?.length) {
                      dispatch('ToursData/getTours',userData.tour)
                         .catch((error) => {
                         console.error('ERROR in getTours:', error);
                         });
                      } 


                if(getters['settings/rules'] && !getters['settings/rules'].length) {
                    dispatch("settings/setRules", companyId.value).then(() => {
                        if(getters['settings/allCurrencyArray'] && !(getters['settings/allCurrencyArray']).length){
                            dispatch('settings/setCurrencyArray', companyId.value).catch((error) =>{
                                console.error('ERROR in set AllProjectStatus',error)
                            })
                        }
                        if(getters['settings/roles'] && !getters['settings/roles'].length) {
                            dispatch('settings/setRoles', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set roles: ", error)
                            })
                        }
                        if(getters['settings/designations'] && !getters['settings/designations'].length) {
                            dispatch('settings/setDesignations', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set designations: ", error)
                            })
                        }
                        if(getters['settings/projectSkills'] && !getters['settings/projectSkills'].length) {
                            dispatch('settings/setProjectSkills', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set project skills: ", error)
                            })
                        }
                        if(getters['settings/companyUserStatus'] && !getters['settings/companyUserStatus'].length) {
                            dispatch('settings/setCompanyUserStatus', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set company user status: ", error)
                            })
                        }
                        if(getters['settings/fileExtentions'] && !Object.keys(getters['settings/fileExtentions']).length) {
                            dispatch('settings/setFileExtentions', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set file extentions: ", error)
                            })
                        }
                        if(getters['settings/companyUsers'] && !getters['settings/companyUsers'].length) {
                            dispatch('settings/setCompanyUsers', {companyName: companyId.value, userId: userId.value}).then(async()=>{
                                    if (userId.value !== null && companyId.value) {
                                        handleSocketsConnection();
                                        // The legacy dashboard used to load this on mount; the new
                                        // shell lands on Home, which only reads the store.
                                        if (!getters['projectData/allProjects']?.data?.length) {
                                            dispatch('projectData/setProjects', { roleType: getters['settings/companyUserDetail']?.roleType, uid: userId.value })
                                                .catch((error) => console.error('setProjects', error));
                                        }
                                        if (process.env.VUE_APP_AFFILIATEON == 'true') {
                                            dispatch('settings/setCompanyRefferal',companyId.value).catch((error)=>{
                                                console.error(error);
                                            })
                                        }
                                    }
                                    // if(getters['settings/planFeatureDisplay'] && !(getters['settings/planFeatureDisplay']).length){
                                    //     dispatch('settings/setplanFeatureDisplay').catch((error) =>{
                                    //         console.error('ERROR in set Set Chargebee',error)
                                    //     })
                                    // }
                            })
                            .catch((error) => {
                                console.error("ERROR in set file extentions: ", error)
                            })
                        }
                        if(getters['settings/category'] && !getters['settings/category'].length) {
                            dispatch('settings/setCategory',companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set file extentions: ", error)
                            })
                        }
                        if(getters['settings/projectTabComponents'] && !getters['settings/projectTabComponents'].length) {
                            dispatch('settings/setProjectTabComponents', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set project tab components: ", error)
                            })
                        }
                        if(getters['settings/companyDateFormat'] && !getters['settings/companyDateFormat'].length) {
                            dispatch('settings/setCompayDateFormat', companyId.value)
                            .then((res) => {
                                dateFormat.value = res?.settings[0].dateFormat || "DD-MM-YYYY"
                            })
                            .catch((error) => {
                                console.error("ERROR in set Compay Date Format: ", error)
                            })
                        }
                        if(getters['settings/companyPriority'] && !(getters['settings/companyPriority']).length) {
                            dispatch('settings/setCompanyPriority', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setCompanyPriority: ", error)
                            })
                        }
                        if(getters['settings/milestoneweeklyrange'] && !(getters['settings/milestoneweeklyrange']).length) {
                            dispatch('settings/setMileStoneWeeklyRange', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setMileStoneWeeklyRange: ", error)
                            })
                        }
                        if(getters['settings/teams'] && !(getters['settings/teams']).length) {
                            dispatch('settings/setTeams', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setTeams: ", error)
                            })
                        }
                        if(getters['settings/customFields'] && !(getters['settings/customFields']).length) {
                            dispatch('settings/setCustomFields', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setCustomFields: ", error)
                            })
                        }
                        if(getters['settings/restrictedExtensions'] && !(getters['settings/restrictedExtensions']).length) {
                            dispatch('settings/setRestrictedExtensions', companyId.value)
                            .catch((error) => {
                            console.error("ERROR in set setTeams: ", error)
                            })
                        }
                        if(getters['settings/projectMilestoneStatus'] && !(getters['settings/projectMilestoneStatus']).length) {
                            dispatch('settings/setMileStoneStatus', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setTeams: ", error)
                            })
                        }
                        if(getters['settings/finalCustomFields'] && !(getters['settings/finalCustomFields']).length) {
                            dispatch('settings/setfinalCustomFields', companyId.value) .catch((error) => {
                                console.error("ERROR in set finalCustomFields: ", error)
                            })
                        }
                        if(getters['settings/AllTaskStatus'] && !(getters['settings/AllTaskStatus']).length){
                            dispatch('settings/setTaskStatusArray', companyId.value).catch((error) =>{
                                console.error('ERROR in set AllTaskStatus',error)
                            })
                        }
                        if(getters['settings/AllProjectStatus'] && !(getters['settings/AllProjectStatus']).length){
                            dispatch('settings/setProjectStatusArray', companyId.value).catch((error) =>{
                                console.error('ERROR in set AllProjectStatus',error)
                            })
                        }
                        if(getters['settings/AllTaskType'] && !(getters['settings/AllTaskType']).length){
                            dispatch('settings/setTaskTypeArray', companyId.value).catch((error) =>{
                                console.error('ERROR in set AllTaskType',error)
                            })
                        }
                        if(getters['settings/projectStaus'] && !(getters['settings/projectStaus']).length) {
                            dispatch('settings/setProjectStatus', companyId.value).then(()=>{
                            }).catch((err)=>{
                                console.error(err,"Error in set project status template")
                            })
                        }
                        if(getters['settings/taskType'] && !(getters['settings/taskType']).length) {
                            dispatch('settings/setTaskType', companyId.value).then(() => {
                            })
                            .catch((error) => {
                                console.error("ERROR in set setTaskType: ", error)
                            })
                        }
                        if(getters['settings/taskStatus'] && !(getters['settings/taskStatus']).length) {
                            dispatch('settings/setTaskStatus', companyId.value)
                            .catch((error) => {
                                console.error("ERROR in set setTaskStatus: ", error)
                            })
                        }
                    }).catch((error) => {
                        console.error("ERROR in get rules: ", error);
                    })
                }

                refreshWebPush(userId.value);
                showReviewModal.value = true;
            }
        } else {
            logged.value = false;
            localStorage.setItem('logged', false);
            showSpinner.value = false;
        }
	}
}
async function changeCompany(cid) {
    try {
        const uid = userId.value || localStorage.getItem("userId");
        const companyDetail = getters['settings/companies'].find((x) => x._id === cid)
        if(!companyDetail && !getters['settings/companies'].length && uid){
            router.push({name : 'Create_Company'});
            return;
        }
        let checkCompany = companyDetail?.isDisable || false;
        const userDataRes = await apiRequest('get',`${env.USER_UPATE}/${uid}`);
        if(uid){
            const updateObject = {
                $set: {
                    'lastSelectedCompany': cid
                }
            }
            apiRequestWithoutCompnay("put",env.USER_UPATE,{
                userId: uid,
                updateObject : updateObject
            }).catch((error)=>{
                console.error(error);
            });
        }
        let userData = {}
        if(userDataRes.status === 200){
            userData = userDataRes.data;
        }
        let availableCompany = userData?.AssignCompany.find((x) => x === cid);
        if(!availableCompany){
            let routeObj = {name: route.name, params: {cid: companyId.value}};
            router.replace(routeObj);
            return;
        }
        if(checkCompany === false){
            companyId.value = cid;
            commit("settings/mutateSelectedCompany", companyId.value);

            localStorage.setItem('selectedCompany', companyId.value);
            let routeObj = {name: route.name, params: {cid: ""}};
            if(route?.params?.cid) {
                routeObj.params.cid = cid;
                routeObj.params.id = route?.params?.id || "";
            }
            router.replace(routeObj)
            .then(async() => {
                try {
                    await apiRequest("post",env.CACHECLEAR,{cacheKey: `UserProjectData:${cid}:${uid}`});
                    await apiRequest("post",env.CACHECLEAR,{cacheKey: `dashboard_${uid}`});
                } catch (error) {
                    console.error("Error in cacheClear",error);
                }
                window.location.reload();
            })
            .catch((error) => {
                console.error("ERROR in change company: ", error);
            })
        }else{
            $toast.error(t("Toast.Company_is_disable"),{position: 'top-right'});
            let availableCompany = getters['settings/companies'].find((x) => !x.isDisable);
            if(availableCompany){
                router.replace({name: route.name, params: {cid: availableCompany._id}});
            }else{
                router.push({name : 'Create_Company'});
            }
        }
    } catch (error) {
        console.error("ERROR in change company: ", error);
    }
}
const handleFilter = () => {
    isAdvanceSearch.value = true;
}
const onPaletteKey = (e) => {
    if (!logged.value || !route.meta.requiresAuth || route.meta.preventAdvanceSearch || !isPaletteShortcut(e)) return;
    e.preventDefault();
    isAdvanceSearch.value = !isAdvanceSearch.value;
}


const changeLanguageHandler = async () => {
    const updateLanguage = await changeLanguage(selectedLanguageCode.value);
    locale.value = selectedLanguageCode.value;
    setLocaleMessage(selectedLanguageCode.value, updateLanguage || "en");
}

const handleSocketsConnection = async () => {
    try {
        const updateObject = {
            lastActive: new Date()
        }
        apiRequestWithoutCompnay("put", env.UPDATE_SESSION,{
            userId: userId.value,
            updateObject:updateObject
        }).then(()=>{
        }).catch((err)=>{
            console.error("ERROR: ", err);
        });
        const serverURL = env.API_URI;
        const namespace = `userid_${companyId.value}_${userId.value}`;
        // A failed connect must not abort the rest of this function: the visibilitychange
        // listener registered below is the only in-session path back to a live socket.
        try {
            socket.value = await connectServer(serverURL,namespace,{userRole: getters['settings/companyUserDetail'].roleType});
        } catch (error) {
            console.error("ERROR in socket connect: ", error);
        } finally {
            socketSettled.value = true;
        }
        // socketInstanceWatcher (store/index.js) calls Object.keys on this on every mutation.
        if (socket.value) commit("settings/mutateSocketInstance", socket.value);
        dispatch("users/myCounts", {uid: userId.value})
        .catch((error) => {
            console.error("ERROR in myCounts: ", error);
        });
        dispatch("settings/setSocketCompanies", {companyId: companyId.value})
        .catch((error) => {
            console.error("ERROR in set socket company: ", error);
        });
        window.addEventListener("beforeunload", () => {
            socket.value?.emit('disconnectNameSpace',socket.value.id);
        });
        let debounceTimeout;
        document.addEventListener('visibilitychange', async () => {
            clearTimeout(debounceTimeout);
            debounceTimeout = setTimeout(async () => {
                if (document.hidden) {
                    socket.value?.emit('getRoomList', socket.value.id, (rooms) => {
                        sessionStorage.setItem('joinedRooms', JSON.stringify(rooms));
                    });
                    const timeStamp = await apiRequestWithoutCompnay("get", `/api/v1/getTime?zone=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
                    sessionStorage.setItem('tableaveTime',new Date(timeStamp.data.data).getTime());
                    socket.value?.emit('disconnectNameSpace',socket.value.id);
                } else {
                    if (userId.value !== null && companyId.value) {
                        // Keep the socket we already have if the retry fails, rather than
                        // trading a working connection for null.
                        const nextSocket = await connectServer(serverURL,namespace,{userRole: getters['settings/companyUserDetail'].roleType})
                        .catch((error) => {
                            console.error("ERROR in socket reconnect: ", error);
                            return null;
                        });
                        if (nextSocket) {
                            socket.value = nextSocket;
                            commit("settings/mutateSocketInstance", nextSocket);
                            dispatch("users/myCounts", {uid: userId.value})
                            .catch((error) => {
                                console.error("ERROR in myCounts: ", error);
                            });
                            dispatch("settings/setSocketCompanies", {companyId: companyId.value})
                            .catch((error) => {
                                console.error("ERROR in set socket company: ", error);
                            });
                            tabSync();
                        }
                    }
                }
            },1000)
        });
    } catch (error) {
        console.error(error);
        socketSettled.value = true;
    }
}

onMounted(() => {
    changeLanguageHandler()
    localStorage.removeItem('ForgotEmail');
    if(getters['brandSettingTab/brandSettings'] && !(getters['brandSettingTab/brandSettings']).length){
        dispatch('brandSettingTab/setBrandSettings').catch((error) =>{
            console.error('ERROR in set Set Brand Settings',error)
        })
    }
    dispatch('brandSettingTab/setPublicConfig');
    getFirebaseData();
    initOffline();
    userId.value = localStorage.getItem("userId") !== null ? localStorage.getItem("userId") :  '';
    try {
       paymentInit();
    } catch (error) {
        console.log("Silence Is Golden");
    }
	window.onresize = (e) => {
		clientWidth.value = e.target.innerWidth;
	}
	document.addEventListener('keydown', onPaletteKey);
	window.addEventListener(PALETTE_OPEN_EVENT, handleFilter);
})

const urlRegex = ref(/(https?|ftp):\/\/[^\s/$.?#].[^\s]*/g)

provide("$urlRegex", urlRegex);
provide("$dateFormat", dateFormat);
provide("$companyId", companyId);
provide("$axios", axios);
provide("$userId", userId);
provide("$moneysymbol", '');
provide("$isLogginedIn", logged.value);
provide("$clientWidth", clientWidth);
provide("$selectedCompanyName", '');
provide("$defaultUserAvatar", defaultImageUser);
provide("$defaultTaskStatusImg", defaultTaskStatus);
provide("$defaultGhostCustomUserImg", defaultGhostCustomUser);
provide("$currentLoggedInUserDetails", '');
provide("$mainTour", mainTour);
provide("$socket",socket);

</script>

<style>
#app {
  font-family: 'Roboto', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}

body {
  margin: 0px;
}

.company__logo{
    width: 150px; 
    height: 150px; 
    border: 2px solid #2F399035;
    border-radius: 50%;
}
</style>
