<template>
    <SpinnerComp :is-spinner="isSpinner"/>
    <template v-if="isLoading">
        <div class="activity-log">
            <div class="activity-scroll">
                <div  v-for="(data,index) in 8" :key="index" class="main-activity">
                    <div class="d-flex align-items-center">
                        <Skelaton class="border-radius-50-per log-use-profile" :style="{ height: '30px', width: '30px' }" />
                        <div class="ml-015 wrapperNameImage">
                            <Skelaton class="border-radius-5-px skelaton__option" :style="{ height:'24px', width: '100%' }" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </template>
    <div v-if="!currentCompany?.planFeature?.actitvityView">
        <UpgradePlan
            :buttonText="$t('Upgrades.upgrade_your_plan')"
            :lastTitle="$t('Header.to_unlock_activity_view')"
            :secondTitle="$t('Upgrades.unlimited')"
            :firstTitle="$t('Upgrades.upgrade_to')"
            :message="$t('Upgrades.the_feature_not_available')"
        />
    </div>
    <div class="activity-log" v-else>
        <div class="activity-scroll">
            <div v-for="data in activityLog" :key="data.id" class="main-activity">
                <ActivityContent :data="data" :key="data.id"/>
            </div>
            <div class="d-flex mt-1" v-if="activityLog.length > 9 && isVisibleLoadMoreButton && activityLog.length % limit === 0">
                <button @click="commonGetQuery(true)" class="btn-class cursor-pointer">{{ $t('Header.load_more') }}</button>
            </div>
            <div v-if="activityLog.length === 0 && (!isSpinner && !isLoading)" class="d-flex justify-content-center">
                <span>{{ $t('ProjectSlider.no_activity_log_found') }}</span>
            </div>
        </div>
    </div>
</template>
<script setup>
import { defineComponent,defineProps,inject,ref,onMounted, watch, computed } from "vue";
import moment from "moment";
import { useGetterFunctions } from '@/composable/index';
import ActivityContent from "@/components/molecules/ActivityLogContent/ActivityContent.vue";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue";
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import { useRoute } from "vue-router";
import {useStore} from 'vuex'
import { apiRequest } from '../../../services';
import * as env from '@/config/env';
import useTaskAgents from '@/composable/taskAgents';
const { getUser } = useGetterFunctions();
const defaultpic = inject("$defaultUserAvatar");

// Shared singleton, cached per company — reusing it here adds no request of its own.
const { agents, load: loadAgents } = useTaskAgents();
const agentById = computed(() => {
    const byId = new Map();
    (agents.value || []).forEach((a) => { if (a && a._id) byId.set(String(a._id), a); });
    return byId;
});

const {getters}  = useStore()

const currentCompany = computed(() => getters["settings/selectedCompany"])

defineComponent({
    name: "ActivityLog",
    components: {
        ActivityContent,
        SpinnerComp,
        Skelaton
    },
})
const props = defineProps({
    dataObj: Object,
    fromProject: {
        type: Boolean,
        required: true,
        default: undefined
    },
    isMainSpinner:{
        type:Boolean,
        default:false
    }
});
const activityLog = ref([]);
const lastVisible = ref(null);
const isVisibleLoadMoreButton = ref(true);
const isSpinner = ref(false);
const isLoading = ref(props.isMainSpinner);
const skip = ref(0);
const limit = ref(10);
const route = useRoute()

watch(() => props.dataObj,(prValue) => {
    if(props.fromProject === true && prValue._id !== route.params.id){
        commonGetQuery();
    }
})

watch(() => props.isMainSpinner,() => {
    if(props.isMainSpinner === false){
        if(props.fromProject == undefined) {
            throw new Error("fromProject is required");
        }
        commonGetQuery();
    }
})

function commonGetQuery(loadMore = false) {
    if (loadMore) {
        isSpinner.value = true;
        skip.value += limit.value;
    } else {
        skip.value = 0;
        activityLog.value = [];
        isLoading.value = true;
    }

    // Determine the projectId based on the context
    const projectId = props.fromProject ? props.dataObj._id : props.dataObj.ProjectID;

    const requestParams = new URLSearchParams({
        fromProject: props.fromProject,
        projectId: projectId,
        ...(props.fromProject ? {} : { taskId: props.dataObj._id }),
        skip: skip.value,
        limit: limit.value
    }).toString();

    apiRequest("get", `${env.ACTIVITYLOG}?${requestParams}`)
        .then(async (response) => {
            const res = response.data;

            // An agent's UserId is not a user id, so getUser() finds nothing and the row
            // falls back to the default avatar with no name. Awaited here rather than in
            // onMounted because userData is baked in below — resolving late would leave
            // the first page showing the wrong icon. The composable caches per company,
            // so this is a no-op once anything else on the page has loaded agents.
            await loadAgents(currentCompany.value?._id).catch(() => []);

            if (res.length === 0) {
                isVisibleLoadMoreButton.value = false;
                isSpinner.value = false;
                isLoading.value = false;
                return;
            }

            res.forEach((element) => {
                let dataObject = { ...element };
                dataObject.displayDate = dataObject.createdAt == undefined 
                    ? moment(new Date()).format('ddd, MMM DD, YYYY hh:mm:ss A') 
                    : moment(new Date(dataObject?.createdAt)).format('ddd, MMM DD, YYYY hh:mm:ss A');
                const agent = agentById.value.get(String(dataObject.UserId || ''));
                if (agent) {
                    // The emoji stands in for an avatar, matching how an agent is drawn
                    // everywhere else it appears — assignee stacks, comments, mentions.
                    dataObject.userData = {
                        isAgent: true,
                        emoji: agent.emoji || '🤖',
                        title: agent.name,
                        image: ''
                    };
                } else {
                    const user = getUser(dataObject.UserId);
                    dataObject.userData = {
                        image: user.Employee_profileImageURL ? user.Employee_profileImageURL : defaultpic,
                        title: user.Employee_Name
                    };
                }
                activityLog.value.push(dataObject);
            });

            lastVisible.value = res[res.length - 1];
            isSpinner.value = false;
            isLoading.value = false;
        })
        .catch((error) => {
            console.error(`ERROR in getting activity log of ${props.fromProject == false ? 'task' : 'project'}`, error);
            isSpinner.value = false; 
            isLoading.value = false;
        });
}
onMounted(() => {
    if(props.isMainSpinner === false){
        if(props.fromProject == undefined) {
            throw new Error("fromProject is required");
        }
        commonGetQuery();
    }
})
</script>
<style src="./style.css"></style>