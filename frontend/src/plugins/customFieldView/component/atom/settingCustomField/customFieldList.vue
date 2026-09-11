<template>
    <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
    <div v-if="checkPermission('settings.settings_custom_field') !== null">
        <div v-if="!currentCompany?.planFeature?.customFields">
            <UpgradePlan
                    :buttonText="$t('Upgrades.upgrade_your_plan')"
                    :lastTitle="$t('Upgrades.unlock_custom_field')"
                    :secondTitle="$t('Upgrades.unlimited')"
                    :firstTitle="$t('Upgrades.upgrade_to')"
                    :message="$t('Upgrades.the_feature_not_available')"
                />
        </div>
        <div v-if="!isSpinner" :class="[{'pointer-event-none opacity-5 blur-3-px':!currentCompany?.planFeature?.customFields}]">
            <div class="addcustomfield-btn d-flex mb-20px justify-content-between">
                <InputText
                    v-model.trim="search"
                    :placeHolder="$t('PlaceHolder.search')"
                    autocomplete="off"
                    class="form-control"
                    type="text"
                    @keyup="handleSearch"
                    :width="'392px'"
                />
                <button v-if="checkPermission('settings.settings_custom_field') === true" class="btn btn-primary" @click="emit('isVisible')">+ {{$t('CustomField.add_new_custom_field')}}</button>
            </div>
            <div v-if="finalCustomFieldData && finalCustomFieldData.length" class="custom-field__table-wrapper">
                <div class="custome-field-table style-scroll w-full">
                    <table border class="custome-field__table">
                        <thead>
                            <tr>
                                <th class="">{{ $t('CustomField.field_name') }}</th>
                                <th class="">{{ $t('CustomField.date_created') }}</th>
                                <th class="">{{$t('conformationmsg.type')}}</th>
                                <th class="">{{ $t('Projects.created_by') }}</th>
                                <th class="">{{$t('Filters.projects')}}</th>
                                <th v-if="checkPermission('settings.settings_custom_field') !== null" class="">{{$t('Projects.status')}}</th>
                                <th>{{$t('Billing.type')}}</th>
                                <th class=""></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(item, index) in finalCustomFieldData.sort((a,b) => new Date(b?.createdAt)?.getTime() - new Date(a?.createdAt)?.getTime())" :key="index" :class="[{'disable':!item.isDelete}]">
                                <td>
                                    <span class="field__title text-capitalize text-ellipsis field__title__name" :title="item?.fieldTitle">{{item?.fieldTitle}}</span>
                                </td>
                                <td>
                                    <span>{{convertDateFormat(item?.createdAt,'',{showDayName: false})}}</span>
                                </td>
                                <td>
                                    <span class="type d-flex" :style="[{background:item?.fieldBackgroundColor}]">
                                        <img :src="getImageData(item.fieldImage)" style="height:12px;width:12px" />
                                        <span class="text-capitalize pl-5px text-ellipsis field__type" :title="item?.fieldType" :style="[{color:item?.fieldPrimaryColor}]">{{item?.fieldType}}</span>
                                    </span>
                                </td>
                                <td>
                                    <div class="d-flex align-items-center created_by">
                                        <UserProfile :data="{title: getUser(item?.userId)?.Employee_Name, image: (getUser(item?.userId)?.Employee_profileImageURL)}" width="30px" :showDot="false" :thumbnail="'30x30'"/>
                                        <span class="text-capitalize pl-5px text-ellipsis field__user_name" :title="getUser(item?.userId)?.Employee_Name">{{getUser(item?.userId)?.Employee_Name}}</span>
                                    </div>
                                </td>
                                <td :class="[{'pointer-event-none':!item.isDelete}]">
                                    <DropDown @isVisible="handleOutsideClick" :bodyClass="{'custom__field__dropdown':true}">
                                        <template #button>
                                            <div class="project_bg d-flex GunPowder font-size-13" @click="handelSubmit(index)">
                                                <span v-if="item?.global" class="project_ellipsis">All Projects</span>
                                                <span v-else-if="item?.projectId && item?.projectId?.length" class="project_ellipsis">
                                                    <template
                                                        v-for="(id, ind) in item?.projectId"
                                                        :key="'projects'+ind"
                                                    >
                                                        <span>{{ projectList?.find(e => e._id === id)?.ProjectName || 'N/A' }} {{ ind < item?.projectId.length - 1 ? ','  : ''}} </span>
                                                    </template>
                                                </span>
                                                <span class="project_ellipsis" v-else>N/A</span>
                                                <img :src="selectArrowMobile" alt="addIconmilestoneSvg" class="cursor-pointer ml_1" />
                                            </div>
                                        </template>
                                        <template #options v-if="item.isDelete">
                                            <div class="d-flex align-items-center pb-7px">
                                                <InputText
                                                    v-model="searchProject"
                                                    :place-holder="$t('PlaceHolder.search')"
                                                    type="text"
                                                    :isOutline="false"
                                                    @input="searchFunction(item)"
                                                />
                                                <span class="text-nowrap ml-5-px font-size-12 font-weight-400 blue cursor-pointer" @click="handleChecked(index)" v-if="!searchProject">{{finalCustomFieldDataTest[index].global === true ? $t('Filters.unselect_all') : $t('Filters.select_all')}}</span>
                                            </div>
                                            <div v-if="projectListSearch && projectListSearch.length">
                                                <DropDownOption
                                                    v-for="(project, indexs) in projectListSearch"
                                                    :key="'project'+indexs"
                                                    style="padding: 0px !important;"
                                                >
                                                    <CheckboxComponent class="p-7px" :customClass="`custom_field_checkbox`" labelClass="text-ellipsis pl-1 cursor-pointer project__name_ellipsis" :id="'project'+indexs" @click.capture="selectSingleCheckbox(index,project._id)" :modelValue="!finalCustomFieldDataTest[index].global ? finalCustomFieldDataTest[index].projectId?.includes(project._id) : true" :customClasses="!finalCustomFieldDataTest[index].global ? finalCustomFieldDataTest[index].projectId?.includes(project._id) ? 'is_checked' : 'remove_checked' : 'is_checked'"  :text="project?.ProjectName" />
                                                </DropDownOption>
                                            </div>
                                            <div v-else>
                                                <DropDownOption>
                                                    <span>No record found</span>
                                                </DropDownOption>
                                            </div>
                                        </template>
                                    </DropDown>
                                </td>
                                <td v-if="checkPermission('settings.settings_custom_field') !== null">
                                    <span>
                                        <Toggle :disabled="checkPermission('settings.settings_custom_field') !== true || currentCompany?.planFeature?.customFields === false" v-model="item.isDelete" width="34" activeColor="rgba(78, 209, 100, 1)" @click="deleteField(item._id,item?.isDelete)"/>
                                    </span>
                                </td>
                                <td :class="[{'pointer-event-none':!item.isDelete}]">
                                    <DropDown>
                                        <template #button>
                                            <div class="project_bg project_type d-flex GunPowder font-size-13" :ref="customFieldType">
                                                <span class="field__title field__title__type text-capitalize">{{ item?.type || 'Na' }}</span>
                                                <img :src="selectArrowMobile" alt="addIconmilestoneSvg" class="cursor-pointer ml_1">
                                            </div>
                                        </template>
                                        <template #options v-if="item.isDelete">
                                            <DropDownOption @click="emit('updateCustomFieldType',item,'project'),$refs[customFieldType][index].click()">
                                                {{$t('Projects.Project')}}
                                            </DropDownOption>
                                            <DropDownOption @click="emit('updateCustomFieldType',item,'task'),$refs[customFieldType][index].click()">
                                                {{$t('subProjectRulesNames.Task')}}
                                            </DropDownOption>
                                        </template>
                                    </DropDown>
                                </td>
                                <td>
                                    <span class="cursor-pointer edit__item" v-if="item.isDelete && checkPermission('settings.settings_custom_field') === true && currentCompany?.planFeature?.customFields === true" @click="handleEditCustomField(item)">
                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M9.86644 0.365642C10.3535 -0.121881 11.1465 -0.121881 11.634 0.365642C11.8699 0.601556 12 0.915575 12 1.24959C12 1.5836 11.8699 1.89763 11.634 2.13312L10.942 2.82519L9.17449 1.0576L9.86644 0.365642Z" fill="#818181"/>
                                            <path d="M4.68792 5.54428C4.65292 5.57925 4.62948 5.6238 4.61942 5.67174L4.26601 7.4399C4.24948 7.52183 4.27551 7.60633 4.33442 7.66581C4.38196 7.71334 4.44594 7.73878 4.51149 7.73878C4.52746 7.73878 4.54399 7.73734 4.56051 7.73384L6.32802 7.38036C6.37695 7.37027 6.42145 7.34684 6.45598 7.31176L10.412 3.35566L8.64447 1.58818L4.68792 5.54428Z" fill="#818181"/>
                                            <path d="M9.49992 5.99978C9.22342 5.99978 9 6.22385 9 6.49977V10.4999C9 10.7755 8.77594 10.9999 8.49998 10.9999H1.49995C1.224 10.9999 1.00002 10.7755 1.00002 10.4999V3.49971C1.00002 3.22419 1.224 2.99972 1.49995 2.99972H5.49998C5.77649 2.99972 6 2.77566 6 2.49968C6 2.22366 5.77649 1.99965 5.49998 1.99965H1.49995C0.673024 1.99965 0 2.67266 0 3.49971V10.4999C0 11.327 0.673024 12 1.49995 12H8.49998C9.327 12 10 11.327 10 10.4999V6.49977C10 6.22327 9.77643 5.99978 9.49992 5.99978Z" fill="#818181"/>
                                        </svg>
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div v-if="finalCustomFieldData.length <= 0 && currentCompany?.planFeature?.customFields === true" class="custom__field-error">
                <div class="position-ab">
                    <img src="@/assets/images/svg/No-Search-Result.svg" alt="aliansoftware"/>
                    <div class="error-text text-center">
                        <h2>{{$t('Filters.no_data_found')}}</h2>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div v-else class="d-flex align-items-center justify-content-center customField__accesdenied">
        <img :src="accesDenied">
    </div>
</template>

<script setup>
    // components
    import { useStore } from 'vuex';
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import Toggle from "@/components/atom/Toggle/Toggle.vue";
    import InputText from "@/components/atom/InputText/InputText.vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import CheckboxComponent from '@/components/atom/Checkbox/CheckboxComponent.vue';
    import { useConvertDate,useCustomComposable, useGetterFunctions } from "@/composable";
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
 
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    const { getImageData } = useCustomFieldImage();

    // packages
    import { useI18n } from "vue-i18n";
    import { useToast } from 'vue-toast-notification';
    import { ref, watch,computed,onMounted } from 'vue';
    import { isOwnerOrAdmin } from "@/utils/roles";

    const { t } = useI18n();

    // store
    const toast = useToast();
    const {dispatch,getters} = useStore();
    const { convertDateFormat } = useConvertDate();
    const { checkPermission } = useCustomComposable();

    //require 
    const accesDenied = require("@/assets/images/access_denied_img.png");
    const selectArrowMobile = require('@/assets/images/svg/drop_down_mobile.svg');

    //props
    const props = defineProps({
        finalCustomFields:{
            type:Array,
            default:() => {}
        }
    });

    // emit
    const emit = defineEmits(['editCustomField','isVisible','updateCustomFieldType','updateCustomFieldProject']);

    //ref
    const search = ref('');
    const projectList = ref([]);
    const isSpinner = ref(true);
    const searchProject = ref('');
    const customFieldIndex = ref();
    const customFieldType = ref("");
    const projectListSearch = ref([]);
    const finalCustomFieldData = ref(props.finalCustomFields || []);
    const finalCustomFieldDataTest = ref(JSON.parse(JSON.stringify(props.finalCustomFields)) || []);
    
    //watch
    watch(()=> props.finalCustomFields,(val)=>{
        finalCustomFieldData.value = val
        finalCustomFieldDataTest.value = JSON.parse(JSON.stringify(val))
    });

    // computed
    const projectsGetter = computed(() => getters["projectData/allProjects"]);
    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const companyUserDetail = computed(() => getters["settings/companyUserDetail"]);
    const showCustomField = computed(() => checkPermission("settings.settings_custom_field", true, {gettersVal: getters}));

    const {getTeamsData, getUser} = useGetterFunctions();

    // mounted
    onMounted(()=>{
        try{
            if(!projectsGetter.value || !Object.keys(projectsGetter.value).length) {
                getTeamsData().then((response) => {
                    isSpinner.value = true;
                    const uid = companyUserDetail.value.userId;
                    const filterteam = response.filter((x) => x.assigneeUsersArray.indexOf(uid) !== -1);
                    const teamIds = filterteam.map((x) => 'tId_'+x._id);
                    let publicQuery = {
                        isPrivateSpace:false
                    }
                    if(!isOwnerOrAdmin(companyUserDetail.value.roleType) && !getters["settings/rules"].toggle.showAllProjects) {
                        publicQuery.AssigneeUserId = {
                            $in:[uid]
                        }
                        if (teamIds && teamIds.length) {
                            publicQuery.AssigneeUserId.$in = [...publicQuery.AssigneeUserId.$in.concat(teamIds)]
                        }
                    }
                    let privateQuery = {
                        isPrivateSpace:true
                    }
                    if(!isOwnerOrAdmin(companyUserDetail.value.roleType)) {
                        privateQuery.AssigneeUserId = {
                            $in:[uid]
                        }
                        if (teamIds && teamIds.length) {
                            privateQuery.AssigneeUserId.$in = [...privateQuery.AssigneeUserId.$in.concat(teamIds)]
                        }
                    }
                    const roleType = companyUserDetail.value.roleType;
                    dispatch('projectData/setProjects', {
                        ...(checkPermission("project.public_projects") === true ? publicQuery : {}),
                        restrictPublic: checkPermission("project.public_projects") !== true,
                        privateQuery,
                        roleType,
                        uid
                    })
                    .then(() => {
                        projectList.value = projectsGetter.value.data;
                        projectListSearch.value = projectsGetter.value.data;
                        isSpinner.value = false;
                    })
                    .catch((error)=>{
                        isSpinner.value = false;
                        console.error(error);
                    })
                }).catch((error) => {
                    console.error(error,"ERROR IN GET TEAMS DATA");
                    isSpinner.value = false;
                });
            } else {
                projectList.value = projectsGetter.value.data;
                projectListSearch.value = projectsGetter.value.data;
                isSpinner.value = false;
            }
        } catch(err){
            console.error('ERROR',err);
            isSpinner.value = false;
        }
    });

    //function
    const selectSingleCheckbox = (index, value) => {
        const customField = finalCustomFieldDataTest.value[index];
        const projectIdArray = customField.projectId;
        if (customField.global) {
            customField.projectId = projectList.value.filter(e => e._id !== value).map(e => e._id);
            customField.global = false;
        } else {
            customField.projectId = projectIdArray.includes(value) ? projectIdArray.filter(id => id !== value): [...projectIdArray, value];
            if (customField.projectId.length === projectList.value.length) {
                customField.global = true;
                customField.projectId = [];
            }else{
                customField.global = false;
            }
        }
    };
    const handleChecked = (index) => {
        finalCustomFieldDataTest.value[index].global = !finalCustomFieldDataTest.value[index].global;
        finalCustomFieldDataTest.value[index].projectId = [];
    };
    // soft delete
    const deleteField = async(id,val) =>{
        if(showCustomField.value === true && currentCompany.value?.planFeature?.customFields === true){
            try {
                const object = {
                    type: "updateOne",
                    key: "$set",
                    updateObject:{
                        isDelete:val
                    },
                    id:id
                };
                await apiRequest("put",env.CUSTOM_FIELD,object).then((res) => {
                    if(res.status === 200){
                        if(val){
                            toast.success(t("Toast.Field_Enable_Successfully"), {position: 'top-right' });
                        }else{
                            toast.success(t("Toast.Field_Disable_Successfully"), {position: 'top-right' });
                        }
                    }else {
                        toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                }).catch((error) => {
                    console.error("Error in updating the custom field",error);
                    toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                });   
            } catch (error) {
                console.error("Error in updating the custom field",error);
                toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }
    };
    const handleEditCustomField = (item) => {
        if(showCustomField.value === true && currentCompany.value?.planFeature?.customFields === true){
            emit('editCustomField',item);
        }
    };
    const handleSearch = () => {
        if(currentCompany.value?.planFeature?.customFields === true){
            finalCustomFieldData.value = props.finalCustomFields;
            if(search.value){
                const filters = finalCustomFieldData.value.filter(x => x.fieldTitle.toLowerCase().includes(search.value.toLowerCase()));
                finalCustomFieldData.value = filters;
            }
        }
    };
    const handleOutsideClick = (value) => {
        if(!value && areArraysEqual(finalCustomFieldData.value[customFieldIndex.value].projectId,finalCustomFieldDataTest.value[customFieldIndex.value].projectId) === false){  
            if(finalCustomFieldDataTest.value[customFieldIndex.value].global === true && !finalCustomFieldData.value[customFieldIndex.value].global){
                if(projectList.value.length !== finalCustomFieldDataTest.value[customFieldIndex.value].projectId.length){
                    finalCustomFieldData.value[customFieldIndex.value].projectId = finalCustomFieldDataTest.value[customFieldIndex.value].projectId;
                    finalCustomFieldData.value[customFieldIndex.value].global = finalCustomFieldDataTest.value[customFieldIndex.value].global;            
                    emit('updateCustomFieldProject',finalCustomFieldData.value[customFieldIndex.value]);
                }
            }else if(finalCustomFieldDataTest.value[customFieldIndex.value].global === false){
                finalCustomFieldData.value[customFieldIndex.value].projectId = finalCustomFieldDataTest.value[customFieldIndex.value].projectId;
                finalCustomFieldData.value[customFieldIndex.value].global = finalCustomFieldDataTest.value[customFieldIndex.value].global;            
                emit('updateCustomFieldProject',finalCustomFieldData.value[customFieldIndex.value]);
            }
        }
        projectListSearch.value = projectList.value ? JSON.parse(JSON.stringify(projectList.value)) : [];
        searchProject.value = '';
    };
    const areArraysEqual = (arr1 = [], arr2 = []) => {
        if(arr1.length){
            const sortedArr1 = [...arr1].sort();
            const sortedArr2 = [...arr2].sort();
            if (sortedArr1.length !== sortedArr2.length) return false;
            return sortedArr1.every((value, index) => value === sortedArr2[index]);
        }else{
            return false;
        }
    };
    const handelSubmit = (value) => {
        customFieldIndex.value = value;
    };
    const searchFunction = () => {
        projectListSearch.value = JSON.parse(JSON.stringify(projectList.value));
        if(searchProject.value.trim().length > 0) {
            projectListSearch.value = projectListSearch.value.filter(item => item.ProjectName.toLowerCase().includes(searchProject.value.toLowerCase()));
        }
    };
</script>
<style scoped src="./style.css"></style>
