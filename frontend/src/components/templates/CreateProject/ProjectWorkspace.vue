<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project workspace detail for blank project form as step-3 in create project module.
========================================================================================== -->
<template>
<div class="ProjectShareGraphicContentWrapper">
    <div class="modalHeader bg-light-gray mb-30px"
    :style="[{padding : clientWidth > 767 ? '16.5px' : '18.5px'}]"
    :class="{'border-radius-5-px  task-heading-desktop': clientWidth > 767 , 'border-radius-8-px task-heading-mobile': clientWidth <= 767}"
    >
        <h3 class="text-blue">{{name.value && name.value !== "" ? name.value : ''}}</h3>
    </div>
    <div class="ProjectContentbody ProjectShareGraphicContent">
        <div class="shareHrDesignWokspacePrivateWrapper d-flex justify-content-between">
            <div class="jadePowerWorkspace" @click="switchWorkSpace(false)" :class="{'add':!theModel.privateSpaceValue.value && checkPublicPlan() == true, 'font-size-13 border-radius-5-px ': clientWidth > 767, 'font-size-16 border-radius-6-px ': clientWidth <= 767,'disablePlan' : checkPublicPlan() === false}">
                <img :src="jadeworkspaceBlue" alt="images" v-if="!theModel.privateSpaceValue.value && checkPublicPlan() === true" />
                <img :src="jadeworkspaceGray" alt="images" v-if="theModel.privateSpaceValue.value || checkPublicPlan() === false" />
                <p :class="{'Workspace-desktop-text': clientWidth > 767 , 'Workspace-text-mobile': clientWidth <= 767}">{{`${selectedCompany.Cst_CompanyName}'s ${$t("Projects.workspace")}`}}</p>
                <!-- <p>{{userDetail.companies && userDetail.companies.filter((x) => x.id === $CompanyDatabase)[0].Cst_CompanyName}}'s Workspace</p> -->
            </div>
            <div class="shareGraphicPrivate" @click="switchWorkSpace(true)" :class="{'add':theModel.privateSpaceValue.value , 'font-size-13 border-radius-5-px ': clientWidth > 767, 'font-size-16 border-radius-6-px ': clientWidth <= 767,'disablePlan' : checkPrivatePlan() === false }">
                <img :src="pratcceBlue" alt="images" v-if="theModel.privateSpaceValue.value" />
                <img :src="pratcceGray" alt="images" v-if="!theModel.privateSpaceValue.value" />
                <p :class="{'Workspace-desktop-text': clientWidth > 767 , 'Workspace-text-mobile': clientWidth <= 767}">{{$t("Projects.private")}}</p>
            </div>
        </div>
        
        <div v-if="checkPrivatePlan() === false && checkPublicPlan() === false">
            <UpgradePlanModal :warningMessage="$t(`Upgrades.public_private_creation_time_limit_reached`)" /> 
        </div>
        <div v-else-if="checkPublicPlan() === false && checkPrivatePlan() === true">
            <UpgradePlanModal :warningMessage="$t(`Upgrades.public_creation_time_limit_reached`)" /> 
        </div>
        <div v-else-if="checkPrivatePlan() === false && checkPublicPlan() === true">
            <UpgradePlanModal :warningMessage="$t(`Upgrades.private_creation_time_limit_reached`)" /> 
        </div>
    </div>
    <div class="projectDescription">
        <div class="sharePrivateProfile"  v-if="theModel.privateSpaceValue.value">
            <span class="d-flex justify-content-center">
                <i>{{$t("Channel.only_share_with")}}: </i>
                <ul>
                    <li class="ml--5px">
                        <Assignee
                            :users="theModel.privateSpaceUsers.value.map((x)=>x.id)"
                            :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                            :num-of-users="3"
                            imageWidth="30px"
                            @selected="updateAssigneeUser($event, 'add')"
                            @removed="updateAssigneeUser($event, 'remove')"
                            :isDisplayTeam="true"
                        />
                    </li>
                </ul>
            </span>
        </div>
        <p v-if="theModel.privateSpaceValue.value === false" :class="{'privatespace-desc-desktop': clientWidth > 767 , 'privatespace-desc-mobile': clientWidth <= 767}">{{$t('ProjectWorkplace.msg1')}}</p>
        <p v-if="theModel.privateSpaceValue.value === ''" :class="{'privatespace-desc-desktop': clientWidth > 767 , 'privatespace-desc-mobile': clientWidth <= 767}">{{$t('ProjectWorkplace.msg2')}}</p>
    </div>
</div>
</template>
<script setup>
import { useStore } from "vuex";
import {ref, defineProps, watch, computed, defineComponent , inject, onMounted } from "vue";
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import { useProjects } from "@/composable/projects";
import UpgradePlanModal from "@/components/atom/UpgradePlanModal/UpgradePlanModal.vue";

    defineComponent({
        name: "CreateProject-Component",
    })
    const props = defineProps({
        name : {
            type : Object,
            default : ()=>({})
        },
        modelValue: {
            type: Object,
            default: () => ({}),
        },
        leader : {
            type : Object,
            default : () => ({})
        },
        userDataVal : {
            type : Object,
            default : () => ({})
        }
    });
    const theModel = ref(props.modelValue);
    const spaceVal = theModel.value.privateSpaceValue;
    const clientWidth = inject("$clientWidth");
    const jadeworkspaceBlue = require("@/assets/images/svg/jadeworkspaceBlue.svg");
    const jadeworkspaceGray = require("@/assets/images/svg/jadeworkspaceGray.svg");
    const pratcceBlue = require("@/assets/images/svg/pratcceBlue.svg");
    const pratcceGray = require("@/assets/images/svg/pratcceGray.svg");
    const users = computed(() => getters["users/users"]);
    const teams = computed(() => getters["settings/teams"])
    const {checkProjectPlan} = useProjects();
    const emit = defineEmits([
        'update:modelValue','disableNext'
    ]);
    if(props.leader.value && props.leader.value.length > 0){
        props.leader.value.forEach(element => {
            let isExist = theModel.value.privateSpaceUsers.value.findIndex((item)=>{
                return item.id === element.id
            })
            if(isExist == -1){
                theModel.value.privateSpaceUsers.value.push(element);
            }
        });
        emit('update:modelValue', theModel.value)
    }
    watch(()=> props.modelValue,(val)=>{
        theModel.value = val;
    })

    onMounted(() => {
        if(checkPublicPlan() === false){
            spaceVal.value = true;
        }
        if(checkPrivatePlan() === false && checkPublicPlan() === false){
            spaceVal.value = '';
            emit('disableNext',true)
        }
    })

    const switchWorkSpace = (flag) =>{
        if(flag == true){
            checkPrivatePlan();
        }else{
            checkPublicPlan();
        }
        spaceVal.value = flag;
        emit('update:modelValue', theModel.value)
    }
    const selectedCompany = ref({});
    const companyId = inject('$companyId');

    const { getters} = useStore();
    var emloyeeArray = computed(() => {
        return getters["users/users"];
    })
    if(emloyeeArray.value && emloyeeArray.value.length > 0){
        emloyeeArray.value.forEach(x => {
            x.label = x.Employee_Name
        });
    }
    const companies = computed(() => {
        return getters["settings/companies"]
    })
    selectedCompany.value = companies.value.find((company) => company._id === companyId.value);

    function updateAssigneeUser(event, type){
        try{
            if(type == "add"){
                theModel.value.privateSpaceUsers.value.push({...event});
            }
            else if(type == "remove"){
                let indexId = theModel.value.privateSpaceUsers.value.findIndex((item)=>{
                    return item.id == event.id
                })
                if(indexId !== -1){
                    theModel.value.privateSpaceUsers.value.splice(indexId,1);
                }
            }
        }
        catch(error){
            console.error(error);
        }
    }

    function checkPublicPlan () {
        return checkProjectPlan('public');
    }

    function checkPrivatePlan () {
        return checkProjectPlan('private');
    }
</script>
<style>
.disablePlan{
    background-color: var(--fill);
    border: 1px solid var(--border) !important;
    pointer-events: none;
}
</style>