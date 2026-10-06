<template>
    <div class="member-management-settings projectPeopleMain p-1">
        <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
        <div v-if="
            (checkPermission('settings.settings_role_management') !== null &&
            checkPermission('settings.settings_designation') !== null && checkPermission('settings.settings_member_list') === true)
        ">
            <form class="d-flex align-items-center justify-content-between">
                <div v-if="checkPermission('settings.settings_member_list') !== null" class="searchByEmail">
                    <InputText
                        :placeholder="$t('PlaceHolder.Search_by_name_or_email')"
                        :isOutline="false"
                        :modelValue="searchField"
                        class="searchByEmail"
                        @update:modelValue="assignSearchField"
                    />
                </div>
                <div class="form-mianDiv d-flex align-items-center position-re" v-if="checkPermission('settings.settings_invite_member') === true && checkPermission('settings.settings_member_list') === true">
                    <InputText
                        :placeholder="$t('PlaceHolder.Invite_by_email')"
                        class="invireByEmail"
                        :isOutline="false"
                        v-model.trim="formData.email.value"
                        :max-length="254"
                        @input="formData.email.value = formData.email.value.toLowerCase()"
                        @keyup="checkErrors({'field':formData.email,
                        'name':formData.email.name,
                        'validations':formData.email.rules,
                        'type':formData.email.type,
                        'event':$event.event})"
                    />
                    <div class="invalid-feedback red position-ab">{{formData.email.error}}</div>
                    <DropDown :bodyClass="{'members-dropdown' : true}" :id="designationKey" class="dropdownMember member__rol-one" v-if="checkPermission('settings.settings_designation') !== null">
                        <template #button>
                            <div class="d-flex text-ellipsis text-nowrap">
                                <div class="font-size-16 text-ellipsis text-nowrap d-block color94" :ref="designationKey" @click="openDesignationEditor()">
                                    {{designationArr && designation !== null && designationArr.filter((x) => x.key === designation).length ? designationArr.filter((x) => x.key === designation)[0].name : $t('PlaceHolder.Select_Designation')}}
                                </div>
                                <img :src="arrowIcon" alt="arrowIcon" class="arrowIcon">
                            </div>
                        </template>
                        <template #head>
                            <div class="search-box-member">
                                <input type="text" class="search_box" :placeHolder="$t('PlaceHolder.search')" v-model="desSearch">
                            </div>
                        </template>
                        <template #options>
                            <span v-if="desSearch.length > 0 && searchDesignationArr.length === 0" class="no-data">{{$t('Header.no_data_found')}}</span>
                            <DropDownOption
                                v-for="(desObj, index) in desSearch === '' ? designationArr : searchDesignationArr"
                                :key="'user'+index" 
                                @click="designation = desObj.key"
                                :class="{'border-top': desObj.key === null}">
                                <div class="w-95 m-7px"  :title="desObj.label" :class=" desObj.key == null ? 'main_roleName  AddNow_designation' : ' main_roleName' ">
                                    <div v-if="desObj.key !== null">
                                        <div v-if="!desObj.showDesignationInput" class="roleName  text-ellipsis d-flex justify-content-between" @click="$refs[designationKey].click()">
                                            <span class="text-ellipsis mw-50">{{ desObj.label }}</span>
                                            <span class="edit text-ellipsis mw-50">
                                                <img v-if="desObj.key !== null && checkPermission('settings.settings_designation') === true" class="erp_app" :src="editImg" alt="edit" @click.stop.prevent="openDesignationEditor(desObj.key)">
                                                <img v-if="desObj.key !== null && checkPermission('settings.settings_designation') === true" class="erp_app ml-10px" :src="deleteIcon" alt="delete" @click.stop.prevent="deleteDesignation(desObj)">
                                            </span> 
                                        </div>
                                        <div v-else class="d-flex justify-content-between position-re">
                                            <span class="w-100">
                                                <InputText :isOutline="false" :placeholder="$t('PlaceHolder.Enter_designation')" v-model="designationName" @enter="desObj.showDesignationInput = false,designationChange(desObj.key === null ? 'add' : 'update', desObj.key,designationName,designations,null)" />
                                            </span>
                                            <span class="position-ab bg-white pl-15px pr-15px update__wrapper" :style="[{height : clientWidth > 767 ? '24px' : '30px' }]">
                                                <img class="position-re green__icon" :style="[{top : clientWidth > 767 ? '5px' : '2px' }]" :src="greenmark" alt="greenmark" @click.stop.prevent="desObj.showDesignationInput = false,designationChange(desObj.key === null ? 'add' : 'update', desObj.key,designationName,designations,index)">
                                                <img class="position-re close__icon" :style="[{top : clientWidth > 767 ? '5px' : '2px' }]" :src="helpClose" alt="Close" @click.stop.prevent="desObj.showDesignationInput = false">
                                            </span>
                                        </div>
                                    </div>
                                    <div v-if="checkPermission('settings.settings_designation') === true && desObj.key === null" @click.stop.prevent="openDesignationEditor(desObj.key), designation = ''">
                                        <span v-if="!desObj.showDesignationInput" class="roleName text-ellipsis addNewRole blue">{{ desObj.label }}</span>
                                        <div v-else class="d-flex justify-content-between position-re">
                                            <span class="w-100">
                                                <InputText :isOutline="false" :placeholder="$t('PlaceHolder.Enter_designation')" v-model="designationName" @enter="desObj.showDesignationInput = false,designationChange(desObj.key === null ? 'add' : 'update', desObj.key,designationName,designations,index)" />
                                            </span>
                                            <span class="position-ab bg-white pl-15px pr-15px update__wrapper" :style="[{height : clientWidth > 767 ? '24px' : '30px' }]">
                                                <img class="position-re green__icon" :style="[{top : clientWidth > 767 ? '5px' : '2px' }]" :src="greenmark" alt="greenmark" @click.stop.prevent="desObj.showDesignationInput = false,designationChange(desObj.key === null ? 'add' : 'update', desObj.key,designationName,designations,index)">
                                                <img class="position-re close__icon" :style="[{top : clientWidth > 767 ? '5px' : '2px' }]" :src="helpClose" alt="Close" @click.stop.prevent="desObj.showDesignationInput = false">
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <DropDown :bodyClass="{'members-dropdown-roll' : true}" :id="roleKey" class="dropdownMember members-dropdown-load" v-if="checkPermission('settings.settings_role_management') !== null">
                        <template #button>
                            <div class="d-flex text-ellipsis text-nowrap">
                                <div :ref="roleKey" class="font-size-16 text-ellipsis text-nowrap d-block color94" @click="openRoleEditor()">
                                    {{roles && role !==null && roles.filter((x) => x.key === role).length ? roles.filter((x) => x.key === role)[0].name : $t('PlaceHolder.Select_Role')}}
                                </div>
                                <img :src="arrowIcon" alt="arrowIcon" class="arrowIcon">
                            </div>
                        </template>
                        <template #options>
                            <DropDownOption
                                v-for="(roleObj, index) in roles"
                                :key="'user'+index"
                                @click="roleOptionClick(roleObj.key)"
                                :class="{'border-top':roleObj.key == null}"
                            >
                                <div class="w-95 m-2px" :title="roleObj.label"  :style="roleObj.key == null ?'width: 100%;' :'' " :class=" roleObj.key == null ? 'main_roleName  AddNow_roll' : ' main_roleName' ">
                                    <div v-if="roleObj.key !== null" >
                                        <div v-if="!roleObj.showRoleInput" class="text-ellipsis roleName d-flex justify-content-between" @click="$refs[roleKey].click()">
                                            <span class="text-ellipsis mw-62">
                                                {{ roleObj.label }}
                                            </span>
                                            <span class="text-ellipsis mw-38">
                                                <img v-if="![null,0, 1, 2, 3].includes(roleObj.key) && checkPermission('settings.settings_role_management') === true" class="erp_app" :src="editImg" alt="edit" @click.stop.prevent="openRoleEditor(roleObj.key)">
                                                <img v-if="![null, 0, 1, 2, 3].includes(roleObj.key) && checkPermission('settings.settings_role_management') === true" class="erp_app ml-10px" :src="deleteIcon" alt="edit" @click.stop.prevent="deleteRole(roleObj)">
                                            </span>
                                        </div>
                                        <div v-if="!roleObj.showRoleInput && roleDescription(roleObj.key)" class="roleDesc">{{ roleDescription(roleObj.key) }}</div>
                                        <div v-else class="d-flex justify-content-between position-re">
                                            <InputText :isOutline="false" :placeholder="$t('PlaceHolder.Enter_role')" v-model="roleName" @enter="roleObj.showRoleInput = false,roleChange(roleObj.key === null ? 'add' : 'update', roleObj.key,null,roleName,roles,rolesGetter)" />
                                            <span class="position-ab bg-white pl-15px pr-15px green__close-wrapper" :style="[{height : clientWidth > 767 ? '24px' : '30px' }]">
                                                <img class="position-re green__icon-img" :style="[{top : clientWidth > 767 ? '7px' : '2px' }]" :src="greenmark" alt="edit" @click.stop.prevent="roleObj.showRoleInput = false,roleChange(roleObj.key === null ? 'add' : 'update', roleObj.key, index,roleName,roles,rolesGetter)">
                                                <img class="position-re close__icon" :style="[{top : clientWidth > 767 ? '7px' : '2px' }]" :src="helpClose" alt="edit" @click.stop.prevent="roleObj.showRoleInput = false">
                                            </span>
                                        </div>
                                    </div>
                                    <div v-if="checkPermission('settings.settings_role_management') === true && roleObj.key === null">
                                        <span v-if="!roleObj.showRoleInput" class="text-ellipsis roleName addNewRole blue" @click.stop.prevent="() => {openRoleEditor(roleObj.key); $forceUpdate()}">{{roleObj.label}}</span>
                                        <span v-else class="d-flex justify-content-between position-re">
                                            <InputText :isOutline="false" :placeholder="$t('PlaceHolder.Enter_role')" v-model="roleName" @enter="roleObj.showRoleInput = false,roleChange(roleObj.key === null ? 'add' : 'update', roleObj.key, index,roleName,roles,rolesGetter)" />
                                            <span class="position-ab bg-white pl-15px pr-15px green__close-wrapper" :style="[{height : clientWidth > 767 ? '24px' : '30px' }]">
                                                <img class="position-re green__icon-img" :style="[{top : clientWidth > 767 ? '7px' : '2px' }]" :src="greenmark" alt="edit" @click.stop.prevent="roleObj.showRoleInput = false,roleChange(roleObj.key === null ? 'add' : 'update', roleObj.key, index,roleName,roles,rolesGetter)">
                                                <img class="position-re close__icon" :style="[{top : clientWidth > 767 ? '7px' : '2px' }]" :src="helpClose" alt="edit" @click.stop.prevent="roleObj.showRoleInput = false">
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                    <button v-if="!isSpinner" type="button" class="blue_btn invite-blue-top cursor-pointer font-roboto-sans ml-0" id="blue_btn" @click.prevent="sendInvitation()">{{$t('Members.invite')}}</button>
                    <button v-else type="button" class="blue_btn invite-blue-top else__invite font-roboto-sans ml-0">{{$t('Members.invite')}}</button>
                </div>
            </form>
            <div class="totalCount d-flex justify-content-between position-re" :class="[{'flex-column' : clientWidth < 767}]" v-if="checkPermission('settings.settings_member_list') !== null">
                <div class="d-flex">
                    <span class="tab-option text-nowrap" @click="activeTab = 0, page= 0" :class="{'activeTab': activeTab === 0}">{{$t('Members.all_members')}} ({{filteredList.length}})</span>
                    <span class="tab-option text-nowrap" @click="activeTab = 1, page= 0" :class="{'activeTab': activeTab === 1}">{{$t('Members.removed_members')}} ({{filteredRemovedList.length}})</span>
                </div>
                <div v-if="clientWidth > 768 && false" class="d-flex" :class="[{'justify-content-end pb-10px' : clientWidth < 767}]">
                    <button class="btn-primary mt-5px" @click="handleImportClick" @toggle-importUser-modal="(showImportModal = !showImportModal)">{{$t('Members.Import_users_from_csv')}}</button>
                </div>
            </div>
            <div>
                <ImportUsers 
                    :showImportModal="showImportModal"
                    @toggle-importUser-modal="showImportModal = false"
                    @importUserSubmit="(userData) =>importUserSubmit(userData)"
                />
            </div>
            <UpdateImportMemeberSubscription v-if="isImportUserUpdateShow" @spinnerValue="(val) => isSpinner = val" :totalUser="importUserData.length" @paymentSubmit="(isPayment) => importUserDb(isPayment)" @hideModel="() => isImportUserUpdateShow = false" @closeModel="closeImprotUserModelFunction"></UpdateImportMemeberSubscription>
            <UpdateMemeberSubscription v-if="isUpdateShow" @spinnerValue="(val) => isSpinner = val" :userData="inviteUserData" :isRemove="false" @executeFurther="(email,designation,role) => sendMail(email,designation,role,false)" @hideModel="() => isUpdateShow = false" @closeModel="closeModelFunction"/>
            <MemberberTable v-if="checkPermission('settings.settings_member_list') !== null" :filteredList="filteredList" :filteredRemovedList="filteredRemovedList" :activeTab="activeTab" :page="page" :perPage="filteredList.length" @pageClick="(val)=>{page = val}" :listingArray="listingArray"  @inviteUserParent="(email,type,designation,flag,isFromRemove) => sendInvitation(email,type,designation,flag,isFromRemove)" @arrayCheck="(data) => listingArray = getCompanyUsers(data)"/>
        </div>
        <div v-else class="text-center">
            <img :src="accesDenied" />
        </div>
        <div v-if="showLoader" class="d-flex box-shadow-6 position-fi z-index-10 right-22px bottom-22px bg-white p-10px border-radius-5-px align-items-center">
            <div class="progress-container d-flex align-items-center position-re ">
                <div class="progress-circle" :style="circleStyle">
                    <span class="progress-text">{{ currentProgress }}%</span>
                </div>
            </div>
            <div>
                <span>{{ $t('importUserButton.import_user_processing') }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { defineComponent, computed, watch, ref, provide, onMounted, inject } from "vue";
    import { useStore } from 'vuex';
    import { useCustomComposable } from "@/composable";
    import { useValidation } from "@/composable/Validation.js";
    import { memberData } from "./helperMember.js"
    import InputText from "@/components/atom/InputText/InputText.vue"
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import MemberberTable from '@/components/molecules/MemberTable/MemberTable.vue'
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import { useToast } from 'vue-toast-notification';
    import Swal from 'sweetalert2';

    const editImg = require("@/assets/images/editing.png");
    const deleteIcon = require("@/assets/images/svg/delete-red.svg");
    const helpClose = require("@/assets/images/close.png");
    const greenmark = require("@/assets/images/greenmark.png");
    const arrowIcon=require('@/assets/images/dd-full-arrow.png');
    import axios from 'axios'
    import * as env from '@/config/env';
    import { apiRequest } from "@/services/index.js";
    import { settingsCollectionDocs } from "../../../utils/Collections.js";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    defineComponent({
        name: "MembersComponent"
    })

    const showImportModal = ref(false);
    const companyId = inject("$companyId");
    const clientWidth = inject("$clientWidth");
    const designationArr = ref([]);
    const userId = inject("$userId");
    const roles = ref([]);
    const designationKey = ref('');
    const paginationKey = ref('');
    const listingArray = ref([]);
    const activeTab = ref(0);
    const page = ref(0);
    const searchField = ref('');
    const designation = ref(null);
    const roleKey = ref('');
    const inviteUserData = ref({});
    const role = ref(null);
    const designationName = ref('');
    const roleName = ref('');
    const $toast = useToast();
    const formData = ref({
        email: {
            value: "",
            rules:
            "required | regex: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$",
            name: "Email",
            error: "",
        },
    })
    const isSpinner = ref(false)
    const desSearch = ref('')
    const accesDenied = require("@/assets/images/access_denied_img.png");
    const { getters, commit } = useStore();
    const {makeUniqueId, checkPermission,debounce} = useCustomComposable();
    const  { checkErrors } = useValidation();
    const {getCompanyUsers, handleDesignationChanges, handleRoleChanges} = memberData();
    const searchDesignationArr = ref([]);
    const isUpdateShow = ref(false);
    const isImportUserUpdateShow = ref(false);
    const importUserData = ref([]);

    const handleImportClick = () => {
    // if (!importTaskPermission) {
    //     $toast.error(t("Toast.Upgrade_for_import"), {position: "top-right"});
    //     return;
    // }
    showImportModal.value = true;
};

    const designations = computed(() => {
        return getters['settings/designations'].filter((x) => !x.isDelete);
    });

    const withoutOwnerRoles = computed(() => {
        return getters['settings/withoutOwnerRoles'].filter((x) => !x.isDelete);
    });
    const companies = computed(() => {
        return getters["settings/companies"];
    })
    const currentCompany = computed(() => getters['settings/selectedCompany']);

    const designationSearch = () => {
        searchDesignationArr.value = designationArr.value.filter((x) => x.name.toLowerCase().includes(desSearch.value.toLowerCase()));
    }

    const assignSearchField = debounce((val) => {
        searchField.value = val;
    },1000)


    watch(() => desSearch.value, () => {
        designationSearch();
    })
    onMounted(() => {
        getDesignations(designations.value);
        getRoles(withoutOwnerRoles.value);
        listingArray.value = getCompanyUsers();
        designationKey.value = 'designations'+makeUniqueId(6);
        paginationKey.value = 'pagination'+makeUniqueId(6);
        roleKey.value = 'role'+makeUniqueId(6);
    })

    watch(() => designations.value, (val) => {
        getDesignations(val);
    })

    watch(()=> withoutOwnerRoles.value, (val) => {
        getRoles(val)
    })
    const rolesGetter = computed(() => {
        return getters['settings/roles'];
    });

    const getDesignations = (value) => {
        if(!value) {
            return;
        }
        let arr = [...JSON.parse(JSON.stringify(value)),{key: null, name: '+ ' + t('subProjectRulesNames.Add_New_Designation'), showDesignationInput: false} ].filter((x) => x.key !== 0);
        designationArr.value = arr.map((x)=>({...x,label:x.name}));
    }

    const getRoles = (value) => {
        if(!value) {
            return;
        }
        let arr = [...JSON.parse(JSON.stringify(value)),{key: null, name: '+ ' + t('PlaceHolder.Add_New_Role'), showRoleInput: false} ];
        roles.value = arr.map((x)=>({...x,label:x.name}));
    }

    const filteredList = computed(() => {
        let list = listingArray.value.filter((user) => !user.isDelete);
        return list.filter((user) => (user.Employee_Name !== undefined && user.Employee_Name.toLowerCase().includes(searchField.value.toLowerCase())) || (user.userEmail !== undefined && user.userEmail.toLowerCase().includes(searchField.value.toLowerCase())));
    })

    const filteredRemovedList = computed(() => {
        let list = listingArray.value.filter((user) => user.isDelete);
        return list.filter((user) => (user.Employee_Name !== undefined && user.Employee_Name.toLowerCase().includes(searchField.value.toLowerCase())) || (user.userEmail !== undefined && user.userEmail.toLowerCase().includes(searchField.value.toLowerCase())));
    })

    const selectedCompany = computed(() => {return companies.value.find((company) => company._id === companyId.value)})

    const openDesignationEditor = (key) => {
        designationArr.value.forEach((data) => {
            if(data.key === key) {
                data.showDesignationInput = true;
                 if(key !== null) {
                    designationName.value = data.name;
                } else {
                    designationName.value = "";
                }
            }
            else {
                data.showDesignationInput = false;
            }
        })
    }
    
    const openRoleEditor = (key) => {
        roles.value.forEach((data) => {
            if(data.key === key) {
                data.showRoleInput = true;
                if(key !== null) {
                    roleName.value = data.name;
                } else {
                    roleName.value = "";
                }
            } else {
                data.showRoleInput = false;
            }
        })
    }

    const sendInvitation = (email = "", roleType = null, designationKey = null,isResend = null,isFromRemove = null) => {
        let userEmail;
        let userDesignation;
        let userRole;

        if(email !== "") {
            userEmail = email;
        } else if(formData.value.email.value && formData.value.email.value.length) {
            userEmail = formData.value.email.value;
        }
        else {
            $toast.error(t("Toast.Please_provide_an_email_id"),{position: 'top-right'});
            return;
        }

        if(designationKey !== null && designationKey !== "") {
            userDesignation = designationKey;
        } else if(designation.value !== null && designation.value !== "") {
            userDesignation = designation.value;
        }else{
            $toast.error(t("Toast.Please_provide_a_designation"),{position: 'top-right'});
            isSpinner.value = false;
            return;
        }

        if(roleType !== null && roleType !== "") {
            userRole= roleType;
        } else if(role.value !== null && role.value !== "") {
            userRole = role.value;
        }else{
            $toast.error(t("Toast.Please_provide_a_role"),{position: 'top-right'});
            isSpinner.value = false;
            return;
        }
        isSpinner.value = true;
        if(formData.value.email.error!== ''){
            isSpinner.value = false;
            return;
        }
        if (!isResend) {
            if (isFromRemove) {
                isUpdateShow.value = true;
                inviteUserData.value = {
                    userEmail: userEmail,
                    userDesignation: userDesignation,
                    userRole: userRole,
                }
            } else {
                apiRequest("post", env.CHECKSENDINVITATION, {
                    companyId: companyId.value,
                    email: userEmail,
                }).then((resp) => {
                    if(resp.data.status == true) {
                        if (resp.data.furtherProceed) {
                            isUpdateShow.value = true;
                            inviteUserData.value = {
                                userEmail: userEmail,
                                userDesignation: userDesignation,
                                userRole: userRole,
                            }
                            sendMail(userEmail, userDesignation, userRole, isResend);
                        } else {
                            isSpinner.value = false;
                            $toast.warning(resp.data.statusText,{position: 'top-right'});
                        }
                    } else {
                        isSpinner.value = false;
                        $toast.error(t("Toast.Something_went_wrong_Please_try_again"),{position: 'top-right'});
                        console.error('error',resp.data.statusText);
                    }
                }).catch((error) => {
                    isSpinner.value = false;
                    $toast.error(t("Toast.Something_went_wrong_Please_try_again"),{position: 'top-right'});
                    console.error(error);
                })
            }
        } else {
            sendMail(userEmail, userDesignation, userRole ,isResend);
        }
    }

    function sendMail(userEmail,userDesignation,userRole,isResend) {
        axios.post(`${env.API_URI}${env.SEND_INVITATION_EMAIL}`, {
            companyId: companyId.value,
            companyName: selectedCompany.value.Cst_CompanyName,
            email: userEmail,
            designation: userDesignation,
            role: userRole,
            isResend: isResend
        }).then((res)=>{
            isSpinner.value = false;
            formData.value.email.value="";
            designation.value = "";
            role.value = null;
            if (res.data.data) {
                if (!isResend) {
                    commit("settings/mutateCompanyUsers", {
                        data: {...res.data.data, _id: res.data.data._id,isCurrentUser: res.data.data.userId === userId.value,requestId: res.data.data._id},
                        op: "added",
                    })
                } else {
                    commit("settings/mutateCompanyUsers", {
                        data: {...res.data.data, _id: res.data.data._id,isCurrentUser: res.data.data.userId === userId.value,requestId: res.data.data._id},
                        op: "modified",
                    })
                }
            }
            if(res.data.status){
                listingArray.value = getCompanyUsers();

                $toast.success(t(`Members.${res.data.statusText}`),{position: 'top-right'});
            }else{
                $toast.error(res.data.statusText,{position: 'top-right'});
            }
        }).catch((err)=>{
            isSpinner.value = false;
            console.error(err,"ERROR IN SENDING INVITATION");
        })
    }

    function importUserSubmit(userData) {
        if (userData && userData.length) {
            importUserData.value = userData;
            isSpinner.value = true;
            isImportUserUpdateShow.value = true;
            importUserDb(false);
        } else {
            $toast.error(t("Toast.Something_went_wrong_Please_try_again"),{position: 'top-right'});
        }
    }
    const progress = ref(0);
    const currentProgress = ref(0);
    const showLoader = ref(false);

    provide('progress', progress);
    watch(progress, (newVal) => {
        animateProgress(newVal);
    });
    const circleStyle = computed(() => {
        return {
            background: `conic-gradient(#4caf50 0% ${currentProgress.value}%, #ddd ${currentProgress.value}% 100%)`
        };
    });

    function animateProgress(target) {
        let step = () => {
            if (currentProgress.value < target) {
                currentProgress.value++;
                requestAnimationFrame(step);
            } else if (currentProgress.value === 100) {
                setTimeout(() => {
                    currentProgress.value = 0;
                    progress.value = 0;
                    showLoader.value = false;
                }, 1200);
            }    
        };
        requestAnimationFrame(step);
    }
    function importUserDb() {
        showLoader.value = true;
        const evId = `ev_${makeUniqueId(12)}`;

		// const source = new EventSource(`http://localhost:4000/importUser/events/${evId}`); // LOCAL ENVIRONMENT

		const source = new EventSource(`${env.API_URI}/importUser/events/${evId}`); // PRODUCTION ENVIRONMNET

		source.onmessage = (event) => {
			const { data } = JSON.parse(event.data);
			progress.value = Number(data.step);

			if (data.step === 100) {
				source.close();
			}
		};

		source.onerror = (error) => {
			console.error("error in creating multiple tasks: ", error);
			source.close();
		};
        const userObj = {
            eventId: evId,
            users: importUserData.value
        }
        apiRequest("post", `${env.API_IMPORT_USER}`, userObj).then((response) => {
            if (response?.data?.status) {
                isSpinner.value = false;
                const fData = response?.data?.data?.length ? response?.data?.data.map((x) => x.value.data) : [];
                if (fData && fData.length) {
                    for (let i = 0; i < fData.length; i += 1) {
                        commit("settings/mutateCompanyUsers", {
                            data: {...fData[i], _id: fData[i]._id,isCurrentUser: fData[i].userId === userId.value,requestId: fData[i]._id},
                            op: "added",
                        })
                    }
                    listingArray.value = getCompanyUsers();
                }
                $toast.success(t("Toast.Import_users_successfully"), { position: 'top-right' });
                return;
            }
            $toast.error(t("Toast.Something_went_wrong_Please_try_again"),{position: 'top-right'});
        }).catch((error) => {
            console.error("Import User Error", error);
            $toast.error(t("Toast.Something_went_wrong_Please_try_again"),{position: 'top-right'});
        });
    }
    function closeImprotUserModelFunction() {
        isImportUserUpdateShow.value = false;
    }

    function closeModelFunction() {
        isUpdateShow.value = false;
        formData.value.email.value="";
        designation.value = "";
        role.value = null;
    }

    async function deleteDesignation (obj) {
        await apiRequest("get", `${env.API_MEMBERS}/designation/${obj.key}`).then((response) => {
            const isUsed = response.data.isUsed;
            if (isUsed) {
                $toast.error(t("Toast.The_designation_is_already_in_use_so_it_cant_be_deleted"), { position: 'top-right' });
                return;
            } else {
                Swal.fire({
                    title: t('conformationmsg.are_you_sure'),
                    text: `${t('conformationmsg.Are_you_sure_you_want_to_delete')} ${obj.name} ${t('Header.designation')}?`,
                    showCancelButton: true,
                    icon: 'warning',
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    cancelButtonText: t('Home.no'),
                    confirmButtonText: t('Home.yes'),
                }).then((result) => {
                    if (result.value) {
                        let field = 'isDelete';
                        let queryObj = {};
                        queryObj.$set = {
                            [`settings.$.${field}`]: true,
                        };
                        let queryFilter = 
                        {   'name': settingsCollectionDocs.DESIGNATIONS,
                            "settings.key": obj.key
                        }
                        apiRequest("put",`${env.SETTING_DESIGNATION}/update`,{queryFilter:queryFilter, queryObj: queryObj})
                        .then(() => {
                            let index = designationArr.value.findIndex((x) => x.key === obj.key);
                            designationArr.value.splice(index,1);
                            $toast.success(t("Toast.Designation_deleted_successfully"), { position: 'top-right' });
                        })
                    }
                })
            }
        })
        .catch((error) => {
            console.error("Error in check if desingnation is assigned with any company users: ", error);
        })
    }

    async function deleteRole (obj) {
        await apiRequest("get", `${env.API_MEMBERS}/roleType/${obj.key}`).then((response) => {
            const isUsed = response.data.isUsed;
            if (isUsed) {
                $toast.error(t("Toast.The_role_is_already_in_use_so_it_can't_be_deleted"), { position: 'top-right' });
                return;
            } else {
                Swal.fire({
                    title: t('conformationmsg.are_you_sure'),
                    text: `${t('conformationmsg.Are_you_sure_you_want_to_delete')} ${obj.name} ${t('Members.role')}?`,
                    showCancelButton: true,
                    icon: 'warning',
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    cancelButtonText: t('Home.no'),
                    confirmButtonText: t('Home.yes'),
                }).then((result) => {
                    if (result.value) {
                        let field = 'isDelete';
                        let queryObj = {};
                        queryObj.$set = {
                            [`settings.$.${field}`]: true,
                        };
                        let queryFilter = 
                        {   'name': settingsCollectionDocs.ROLES,
                            "settings.key": obj.key
                        }
                        apiRequest("put",`${env.SETTING_ROLES}/update`,{queryFilter:queryFilter, queryObj: queryObj})
                        .then(() => {
                            let index = roles.value.findIndex((x) => x.key === obj.key);
                            roles.value.splice(index,1);
                            $toast.success(t("Toast.Role_deleted_successfully"), { position: 'top-right' });
                        })
                    }
                })
            }

        })
        .catch((error) => {
            console.error("Error in check if role is assigned with any company users: ", error);
        })
    }

    // Only the four roles every company is seeded with have a description. A company that renamed
    // one, or added its own, gets nothing here rather than a description that would be a guess.
    function roleDescription (key) {
        return [0, 1, 2, 3].includes(key) ? t(`Members.role_desc.${key}`) : '';
    }

    function roleChange (type,key,index,roleName,role,roleGetters) {
        handleRoleChanges(type,key,index,roleName,role,roleGetters).then((resp) => {
            let op = type === 'add' ? 'added' : 'modified';
            let data = resp.data?.settings;
            commit('settings/mutateRoles',{data: data, op: op});
        });
    }

    function designationChange (type,key,name,designation,index) {
        const designationGetters = getters['settings/designations'];
        handleDesignationChanges(type,key,name,designation,designationGetters,index).then((resp) => {
            let op = type === 'add' ? 'added' : 'modified';
            let data = resp.data?.settings;
            commit('settings/mutateDesignations',{data: data, op: op});
        });
    }

    async function roleOptionClick (key) {
        let guestUserCount = currentCompany.value?.planFeature?.guestUser;
        if(key === 0) {
            let obj = {
                roleType : key,
            }
            await apiRequest("post", `${env.API_MEMBERS}/count`,{query : obj}).then((resp) => {
                if(resp.data && resp.data.length > 0) {
                    let count = resp.data[0].totalCount || 0;
                    if(count >= guestUserCount) {
                        $toast.error(t("Toast.You_have_reached_the_maximum_limit_of_guest_users"), { position: 'top-right' });
                        return;
                    } else{
                        role.value = key;
                    }
                } else {
                    role.value = key;
                }
            })
        }
        else{
            role.value = key;
        }
    }
</script>
<style scoped>
@import './style.css';

.roleDesc {
    font-size: 11px;
    line-height: 1.35;
    color: #8c8c8c;
    margin-top: 2px;
    white-space: normal;
}
</style> 