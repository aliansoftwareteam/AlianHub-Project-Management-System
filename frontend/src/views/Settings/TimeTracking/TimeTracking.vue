<template>
    <div class="time_tracking_wapper" >
        <div v-if="addOnOff" class="tt-addon ah-card ah-card__body" data-test="tracker-addon">
            <h2 class="ah-h3">{{ $t('Plan.tracker_addon_title') }}</h2>
            <p class="ah-small">{{ $t('Plan.tracker_addon_body') }}</p>
            <a v-if="portalUrl && privileged" :href="portalUrl" target="_blank" rel="noopener" class="ah-btn ah-btn--primary ah-btn--sm">{{ $t('Plan.tracker_addon_action') }}</a>
        </div>
        <div v-else class="time_tracking_main overflow-auto">
            <div class="timetracking-head">
                <div class="d-flex justify-content-center h1-head">
                    <h1>{{ $t('TimeTracker.unlock') }}</h1>
                </div>
                <div class="d-flex justify-content-center p-head">
                    <p>{{ $t('TimeTracker.smooth') }}</p>
                </div>
            </div>
            <DesktopAppCard :info="desktopApp" :loading="desktopLoading">
                <template #fallback>
                    <p v-if="loaded && !dataobj.length" class="tt-empty">{{ $t('TimeTracker.no_builds') }}</p>
                    <div v-if="dataobj.length" class="d-flex justify-content-center download-links-wappermain">
                        <div class="download-links-wapper cursor-pointer" v-for="(item , index) in dataobj" :key="index" @click="selectedData = item" :class="{'active':(item == selectedData),'border-primary':(item == selectedData)}" >
                            <div class="download-links-img">
                                <img :src="item.image">
                            </div>
                            <div>
                                <span class="d-block time-tracking-black ostype">{{item.type}}</span>
                                <span class="time-tracking-gray osversion">{{ item.version }}</span>
                            </div>
                        </div>
                    </div>
                    <div v-if="dataobj.length" class="d-flex justify-content-center download-lable-wapper">
                        <div class="d-flex  download-links-lable cursor-pointer" @click="$refs.anchor.click()">
                            <div class="d-flex download-content-wapper">
                            <div class="d-flex align-items-center download__icon-wrapper"> 
                                <img :src="Download_icon" alt="icon">
                            </div>
                            <div class="text-center download-links-msg">
                                <span class="d-inline-block">{{selectedData?.title }}</span>
                                <p v-if="selectedData?.description" class="d-inline-block">{{ selectedData.description }}</p>
                            </div>
                            </div>  
                        </div>
                        <a :href="selectedData?.downloadUrl" ref="anchor" download hidden >{{ $t('TimeTracker.click') }}</a>
                    </div>
                </template>
            </DesktopAppCard>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, computed ,inject} from "vue";
import DesktopAppCard from "./DesktopAppCard.vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

const Windows = require("@/assets/images/svg/Windows.svg");
const Mac = require("@/assets/images/svg/Mac.svg");
const Linux = require("@/assets/images/svg/Linux.svg");
const Download_icon = require("@/assets/images/svg/download_green.svg");
import { useStore } from 'vuex';
import { isManagedHosting, publicConfig } from "@/config/publicConfig";
import { isOwnerOrAdmin } from "@/utils/roles";
const { dispatch, getters } = useStore();
const addOnOff = computed(() => isManagedHosting() && getters["settings/selectedCompany"]?.planFeature?.trackerTimesheet === false);
const privileged = computed(() => isOwnerOrAdmin(getters["settings/companyUserDetail"]?.roleType));
const portalUrl = computed(() => publicConfig.hosting?.portalUrl || "");
const anchor = ref('')
const imageObj = ref({Linux:Linux,Mac:Mac,Windows:Windows})
const selectedData = ref('')
const arrobj = computed(() => getters['settings/TimeTracker']);
const companyId = inject("$companyId");
const dataobj = ref([]);
const loaded = ref(false);
const desktopApp = ref(null);
const desktopLoading = ref(true);
					
onMounted(() => {
    apiRequest("get", env.TRACKER_DESKTOP_APP)
        .then((res) => { desktopApp.value = res && res.data && res.data.status ? res.data.data : null; })
        .catch((error) => console.error("ERROR in loading the desktop tracker card: ", error))
        .finally(() => { desktopLoading.value = false; });
    if(arrobj.value && !arrobj.value.length) {
            dispatch('settings/setTimeTrackerDownload', companyId.value).then((res)=>{                        
            dataobj.value = (res || []).map((element) =>{return {...element , image:imageObj.value[element.type]}})
            selectedData.value = dataobj.value[0]
            }) .catch((error) => {
                     console.error("ERROR in set setTimeTrackerDownload: ", error)
            }).finally(() => { loaded.value = true; })
    }else{
        dataobj.value = (arrobj.value || []).map((element) =>{return {...element , image:imageObj.value[element.type]}})
        selectedData.value = dataobj.value[0]
        loaded.value = true;
    }
});

</script>

<style scoped>
@import './style.css';
</style>

<style scoped>
.tt-addon { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 560px; margin: 24px auto; }
.time-tracking-black {
    color: var(--ink);
}
.time-tracking-gray {
    color: var(--ink-2);
}
</style>
