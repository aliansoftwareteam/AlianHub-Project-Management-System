<template>
    <SpinnerComp :is-spinner="isSpinner" />
    <div class="Notification_main p-1" :class="[{'pointer-event-none':isSpinner}]">
        <div class="d-flex justify-content-between align-items-center pb-1">
            <h3 class='m-0 black Notification_header'>{{$t('Notification.notification_setting')}}</h3> 
        </div>
        <div class="white-box">
            <div class="advancePermissionContent" >
                <div class="overflow-auto Permissions-table style-scroll">
                    <div class="thead position-sti">
                        <div class="tr">
                            <div class="th">
                                <!-- <div class="blank_wrapper1"></div>
                                <div class="blank_wrapper2"></div> -->
                                <div class="header_col_blank"></div>
                                <div class="header_col header_col__email">{{$t('Auth.email')}}</div>
                                <div class="header_col header_col__browser">{{$t('Notification.browser')}}</div>
                                <div class="header_col header_col__mobile">{{$t('Notification.mobile')}}</div>
                            </div>
                        </div>
                    </div>      
                    <div class="tbody">   
                        <div v-for="(item, index) in filteredSettings" :key="index">
                            <div class="section-name">
                                <h4 class="mt-1 sectionName Notification_header black">{{$t(`Notification.${item.key}`)}}</h4>
                            </div>
                            <NotificationTableRow 
                                v-for="(items, index) in item.items" :key="index" 
                                :Title="items.key" :dropdown1="items.notifySelection && items.notifySelection" 
                                :dropdown2="(index==0 && item.sectionName == 'Tasks') ? false : items.notifySelection" 
                                :Email="items.email" 
                                :Mobile="items.mobile" 
                                :Browser="items.browser" 
                                :dropdown1Value="items.notifyFor"
                                :dropdown2Value="items.duration"
                                @mail="(val)=>{Changemail(val,items,item.key)}" 
                                @browser="(val) => {Changebowser(val,items,item.key)}" 
                                @mobile="(val) => {Changemobile(val,items,item.key)}"
                                @duration="(val) => {Handledropdown(val,items,'duration',item.key)}"
                                @notifyFor="(val) => {Handledropdown(val,items,'notifyFor',item.key)}"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    // PACKAGES
    import { useStore } from 'vuex';
    import { markFirstRunStep, FIRST_RUN_STEPS } from '@/composable/firstRunProgress';
    import { useToast } from 'vue-toast-notification';
    import {computed, defineComponent, inject, onMounted, ref, watch} from 'vue'

    // COMPONENTS
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import NotificationTableRow from '../../../components/atom/NotificationTableRow/NotificationTableRow.vue';

    // UTILS
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const userId = inject("$userId");
    const {getters, dispatch} = useStore();
    const companyId = inject("$companyId");

    defineComponent({
        name: "NotificationSettings"
    });

    const settings = ref([]);
    const filteredSettings = computed(() => {
        return settings.value?.filter(e => 
            e?.key !== 'project_description' && 
            e?.key !== 'project_checklist' && 
            e?.key !== 'project_checklist_remove' && 
            e?.key !== 'project_checklist_assign' && 
            e?.key !== 'task_description' && 
            e?.key !== 'task_checklist' && 
            e?.key !== 'task_checklist_assign' && 
            e?.key !== 'task_checklist_remove' && 
            e?.key !== 'after_3_hours_today_pending_hours' && 
            e?.key !== 'logged_hours_notification'
        ) || [];
    });
    const toast = useToast();
    //variable
    const isSpinner = ref(false);
    //computed
    const rulesGetter = computed(() => getters["settings/notificationSettings"]);
    //onMounted
    onMounted(() => {

        markFirstRunStep(FIRST_RUN_STEPS.NOTIFICATIONS);
        isSpinner.value = true;
        if(rulesGetter.value && !Object.keys(rulesGetter.value).length) {
            dispatch("settings/setNotificationRules", {
                userId: userId.value,
                cid: companyId.value
            }).then(() => {
                settings.value = [];
                Object.keys(rulesGetter.value).forEach((key) => {
                    if(key !== "updatedAt" && key !== "createdAt" && key !== "_id" && key !== 'userId' && key !== '__v') {
                        settings.value.push(rulesGetter.value[key]);
                    }
                });
                settings.value.sort((a,b) => (a.sectionName.toLowerCase() < b.sectionName.toLowerCase()) ? -1 : ((b.sectionName.toLowerCase() < a.sectionName.toLowerCase()) ? 1 : 0));  
                isSpinner.value = false;
            }).catch((error) => {
                isSpinner.value = false;
                console.error("ERROR in set notification rules: ", error);
            })
        } else {
            Object.keys(rulesGetter.value).forEach((key) => {
                if(key !== "updatedAt" && key !== "createdAt" && key !== "_id" && key !== 'userId' && key !== '__v') {
                    settings.value.push(rulesGetter.value[key]);
                }
                settings.value.sort((a,b) => (a.sectionName.toLowerCase() < b.sectionName.toLowerCase()) ? -1 : ((b.sectionName.toLowerCase() < a.sectionName.toLowerCase()) ? 1 : 0));  
            });
            isSpinner.value = false;
        }
    });
    
    watch(() => rulesGetter.value, (val) => {
        if(val && Object.keys(val).length) {
            settings.value = [];
            Object.keys(val).forEach((key) => {
                if(key !== "updatedAt" && key !== "createdAt" && key !== "_id" && key !== 'userId' && key !== '__v') {
                    settings.value.push(val[key]);
                }
            })              
            settings.value.sort((a,b) => (a.sectionName.toLowerCase() < b.sectionName.toLowerCase()) ? -1 : ((b.sectionName.toLowerCase() < a.sectionName.toLowerCase()) ? 1 : 0));  
        }
    });
    // Update function for notification settings
    const handleUpdate = async(valueToUpdate,fieldToUpdate,item,key) => {
        try {
            isSpinner.value = true;
            let object = {
                id:rulesGetter.value._id,
                key:key,
                valueToUpdate:valueToUpdate,
                fieldToUpdate:fieldToUpdate,
                elementKey:item.key,
                userId:userId.value
            }
            await apiRequest("put",env.NOTIFICATION,object).then(() => {
                isSpinner.value = false;
                toast.success(t(`Toast.Notification_Settings_Update_successfully`), { position: 'top-right' });
            }).catch((error) => {
                console.error(error);
                isSpinner.value = false;
                toast.error(error.message, { position: 'top-right' });
            });   
        } catch (error) {
            console.error("Error in updating the notifcation");
            isSpinner.value = false;
        }
    };
    const Changemail = (val,item,key) =>{
        item.email = val;
        handleUpdate(val,'email',item,key);
    };
    const Changebowser = (val,item,key) =>{
        item.browser = val;
        handleUpdate(val,'browser',item,key);
    };
    const Changemobile = (val,item,key) =>{
        item.mobile = val;
        handleUpdate(val,'mobile',item,key);
    };
    const Handledropdown = (val,item,type,key) => {
        if(item.duration == val || item.notifyFor == val){   
            return toast.error(t(`Toast.Nothing_to_update`), { position: 'top-right' });
        }
        if(type==="duration"){
            item.duration = val;
        }
        if(type==="notifyFor"){
            item.notifyFor = val;
        }
        handleUpdate(val,type,item,key);
    };
</script>
<style scoped>
@import "./style.css";
</style>