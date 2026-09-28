<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project required views default detail for blank project form as step-8 in create project module.
========================================================================================== -->
<template>
 <div id="project-step-container" class="ProjectShareGraphicModel addProjectEnabale borderChange mobile-project-taskstatus-section">
    <div class="modalHeader bg-light-gray text-center"
    :style="[{padding : clientWidth > 767 ? '16.5px' : '18.5px'}]"
    :class="{'border-radius-5-px': clientWidth > 767 , 'border-radius-8-px': clientWidth <= 767}"
    >
        <h3 class="m-0"  :class="{'task-heading-desktop': clientWidth > 767 , 'task-heading-mobile': clientWidth <= 767}">{{$t('ProjectDetails.required_view')}}</h3>
    </div>
    <p class="navigating"  :class="{'p-navigating-desktop': clientWidth > 767 , 'p-navigating-mobile': clientWidth <= 767}">{{$t('ProjectDetails.set_the_require').replace('BRAND_NAME', brandSettings && brandSettings?.productName ? brandSettings.productName : 'Alian Hub')}}
    </p>
    <div  class="align-items-center justify-content-space-between mobile-reuired-views">
        <!-- start required design   -->
        <div class="requiredviewListWrapper style-scroll d-flex flex-wrap justify-content-between">
            <div v-for="(viewList, index) in requiredViewobj.value" :key="index" :class="{'outline-required': !viewList.viewStatus, 'outline-primary': viewList.viewStatus}" class="position-re requiredListItem d-flex align-items-center justify-content-between mb-20px">
                <div class="Icon_text d-flex align-items-center">
                    <img :src="!viewList.viewStatus ? projectComponentsIcons(viewList.keyName).icon : projectComponentsIcons(viewList.keyName).activeIcon" :alt="viewList.name">
                    <!-- <h4 style="margin: 0px 0px 0px 5px;" class="changesFont margin-left-value">{{viewList.name}}</h4> -->
                    <span class="changesFont margin-left-value ml-5px" :class="{'enableapp-list-desktop': clientWidth > 767 , 'enableapp-list-mobile': clientWidth <= 767,'blue':viewList.viewStatus}">{{$t(`ViewList.${viewList.name}`)}}</span>
                </div>
                <div class="text-toggle d-flex align-items-center">
                    <span class="blue font-size-10" v-if="viewList.setAsDefault === true">
                        <img :src="homeSetting" alt="home" class="default_home_settingsImg"/>
                        {{$t('Projects.default_view')}}
                    </span>
                    <DropDown mode="menu" v-if="!viewList.setAsDefault">
                        <template #button>
                            <img :src="horizontalDots" :alt="$t('ProjectDetails.view_actions')" class="makeAsDefaultDot mr-15px vertical-middle"/>
                            <img v-if="!viewList.setAsDefault" :src="horizontalDotsBlue" :alt="$t('ProjectDetails.view_actions')" class="makeAsDefaultDotBlue mr-15px vertical-middle"/>
                        </template>
                        <template #options>
                            <DropDownOption @click="updateRequiredViews(viewList, true),getView(viewList)">
                                {{ $t('ProjectDetails.make_default') }}
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <Toggle v-model="viewList.viewStatus" @change="getView(viewList)" :active-color="viewList.setAsDefault === true ? '#8591F9' : '#3845B3'" :disabled="viewList.setAsDefault" class="ml-5px" />
                </div>
            </div>
        </div>
        <div class="red font-size-14 mt-10px text-center" v-if="requiredViewobj?.error">{{requiredViewobj?.error}}</div>
        <!-- start required design end -->
    </div>
</div>
</template>
<script setup>
import { ref, onMounted, inject,computed } from "vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
import Toggle from "@/components/atom/Toggle/Toggle.vue"
import { projectComponentsIcons } from '@/composable/commonFunction';
import {useStore} from 'vuex';
import * as env from '@/config/env';
import { apiRequest } from "../../../services";
const {getters} = useStore();
const brandSettings = computed(() => getters['brandSettingTab/brandSettings']);

    const props = defineProps({
        modelValue : {
            type : Object,
            default : (()=>{})
        }
    })
    const requiredViewobj = ref(props.modelValue);
    const clientWidth = inject("$clientWidth");
    const horizontalDotsBlue = require("@/assets/images/svg/blueThreeDot.svg");
    const horizontalDots = require("@/assets/images/svg/horizontalSvg.svg");
    const homeSetting = require("@/assets/images/svg/homeSetting.svg");
    const mainArray =  ref([]);
    const selectedRequiredObj= ref([]);
    onMounted(() => {
        if(requiredViewobj.value.value.length <= 0){
            getAllViews();
        }else{
            mainArray.value = requiredViewobj.value.value;
        }
    })
    const emit = defineEmits([
        'update:modelValue'
    ]);
    function getAllViews(){
        apiRequest("get", `${env.PROJECTS_TABS}`)
        .then((querySnapshot) => {
            let data = querySnapshot.data;
            const arr = ["gantt", "timeline","embed"];
            let temp = data.filter((item) => {
                if(!arr.includes(item.value)) {
                    return item;
                }
            });
            temp.sort((a, b) => a.sortIndex - b.sortIndex);
            temp = temp.map((item)=>{
                delete item.createdAt
                delete item.updatedAt
                return item
            })
            mainArray.value = temp;
            requiredViewobj.value.value = temp;
        })
        .catch((error) => {
            console.error(error,"EROOR")
        })
    }
    function updateRequiredViews(viewList, updateDefault=false) {
        mainArray.value = mainArray.value.map((x) => {
            if(x.value === viewList.value) {
                if(updateDefault) {
                    x.setAsDefault = true;
                    x.viewStatus = true;
                } else {
                    if(!x.setAsDefault) {
                        x.viewStatus = !x.viewStatus;
                    } else {
                        x.setAsDefault = false;
                        x.viewStatus = false;
                        // requiredViewobj.value.value.filter((x) => x.name === "List")[0].setAsDefault = true;
                        // mainArray.value.filter((x) => x.name === "List")[0].setAsDefault = true;
                    }
                }
            } else {
                if(updateDefault) {
                    x.setAsDefault = false;
                }
            }

            return x;
        })
        selectedRequiredObj.value = requiredViewobj.value;
        emit('update:modelValue', requiredViewobj.value)
    }
    function getView(viewList){
        if(viewList.viewStatus === true){
            if (requiredViewobj.value.value.filter(item => item.viewStatus).length === 1) {
                const selectedItem = requiredViewobj.value.value.find(item => item.viewStatus);

                if (selectedItem) {
                    selectedItem.setAsDefault = true;

                    const mainItem = mainArray.value.find(item => item._id === selectedItem._id);
                    if (mainItem) {
                        mainItem.setAsDefault = true;
                    }
                    requiredViewobj.value.error = null;
                }
            }
            if(requiredViewobj.value.value.findIndex((x) => x._id === viewList._id) === -1) {
                requiredViewobj.value.value.push(viewList)
            }
        }
        let fIndex = requiredViewobj.value.value.findIndex((dataas)=>{
            return dataas.viewStatus === false && dataas.keyName === viewList.keyName
        })
        if(fIndex > 0){
            requiredViewobj.value.value[fIndex].viewStatus = viewList.viewStatus;
        }
        emit('update:modelValue', requiredViewobj.value)
    }
</script>
<style scoped>
@import './style.css';
</style>
