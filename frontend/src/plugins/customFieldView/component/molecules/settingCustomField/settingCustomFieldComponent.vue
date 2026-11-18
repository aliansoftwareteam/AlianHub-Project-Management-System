<template>
    <div class="customField-wrapper">
        <CustomFieldList
            :finalCustomFields="finalCustomFields"
            @editCustomField="editCustomField"
            @isVisible="visible = true"
            @updateCustomFieldType="updateCustomFieldType"
            @updateCustomFieldProject="updateCustomFieldProject"
        />
    </div>
    <CustomFieldsSidebarComponent
        @customFieldStore="customFieldStore"
        @closeSidebar="handleCloseSidebar"
        :componentDetail="componentDetail && Object.keys(componentDetail).length ? componentDetail : {}"
        :customFieldObject="componentDetail && Object.keys(componentDetail).length ? customFieldObject : {}"
        v-model:isCustomField="visible"
        @handleClose="handleClose()"
        :isType="true"
    />
</template>

<script setup>
    import { useStore } from 'vuex';
    import { useI18n } from "vue-i18n";
    import * as env from '@/config/env';
    import { apiRequest } from '@/services';
    import { useToast } from 'vue-toast-notification';
    import {defineComponent,ref, watch,inject} from 'vue'
    import CustomFieldList from "../../atom/settingCustomField/customFieldList.vue";
    import { projectLinkRequest } from "../../../fieldProjectLinks";

    const $toast = useToast();
    const {getters,commit,dispatch} = useStore();
    const { t } = useI18n();

    // inject
    const userId = inject('$userId');


    defineComponent({
        name: "CustomizedInput"
    })  

    //variable
    const visible = ref(false);
    const componentDetail = ref({});
    const customFieldObject = ref({});
    const CustomFieldData = ref(JSON.parse(JSON.stringify(getters["settings/customFields"])));
    const finalCustomFields = ref(getters['settings/finalCustomFields'] ? getters['settings/finalCustomFields']?.sort((a,b) => new Date(b?.createdAt)?.getTime() - new Date(a?.createdAt)?.getTime()) : []);

    //watch
    watch(() => getters['settings/finalCustomFields'],(val) => {
        if(val){
            finalCustomFields.value = val?.sort((a,b) => new Date(b?.createdAt)?.getTime() - new Date(a?.createdAt)?.getTime());
        }
    });
    watch(() => getters["settings/customFields"],(val) => {
        CustomFieldData.value = val;
    });

    //function
    const customFieldStore = async(value,isEdit) => {
        if(!isEdit){
            value.global = true;
            value.createdAt = new Date();
            value.updatedAt = new Date();
            value.userId = userId.value;
            value.type = value?.type ? value?.type?.toLowerCase() : 'task';
            const object = {
                type: "save",
                updateObject:value
            }
            await apiRequest("post",env.CUSTOM_FIELD,object).then((res) => {
                if(res.status === 200) {
                    value._id = res?.data?._id || '';
                    commit("settings/mutateFinalCustomFields", {data: value || {},op: "added"});
                    $toast.success(t('Toast.Field_Added_Successfully'), {position: 'top-right' });
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
                visible.value = false;
                componentDetail.value={};
                customFieldObject.value={};
            }).catch((err)=>{
                console.error("Error in inserting the custom field",err);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            })
        }else{
            value.updatedAt = new Date();
            const object = {
                type: "updateOne",
                key: "$set",
                updateObject:{...value},
                id:customFieldObject.value._id
            };
            await apiRequest("put",env.CUSTOM_FIELD,object).then((res) => {
                if(res.status === 200){
                    $toast.success(t('Toast.Field_Updated_Successfully'), {position: 'top-right' });
                    commit("settings/mutateFinalCustomFields", {data: {...customFieldObject.value,...value} || {},op: "modified"});
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
                visible.value = false;
                componentDetail.value={};
                customFieldObject.value={};
            }).catch((err)=>{
                console.error("Error in updating the custom field",err);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });
        }
    };
    const updateCustomFieldType = async(value,type) => {
        try {
            value.type = type;
            value.updatedAt = new Date();

            const object = {
                type: "updateOne",
                key: "$set",
                updateObject:{
                    type: type
                },
                id:value._id
            };
            await apiRequest("put",env.CUSTOM_FIELD,object).then((res) => {
                if(res.status === 200){
                    commit("settings/mutateFinalCustomFields", {data: {...value} || {},op: "modified"});
                    $toast.success(t('Toast.Field_Updated_Successfully'), {position: 'top-right' })
                }else{
                    $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                }
            }).catch((err)=>{
                console.error("Error in updating the custom field",err);
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            });
        } catch (error) {
            console.error("Error in updating the custom field")
        }
    };
    const updateCustomFieldProject = async(value, before) => {
        value.updatedAt = new Date();
        const object = {
            type: "updateOne",
            key: "$set",
            id: value._id,
            ...projectLinkRequest(before, value)
        };
        // The list shows the change before the server answers, so a refusal reads the stored definitions back.
        const rereadDefinitions = () => dispatch("settings/setfinalCustomFields");
        await apiRequest("put",env.CUSTOM_FIELD,object).then((res) => {
            if(res.status === 200){
                commit("settings/mutateFinalCustomFields", {data: {...value} || {},op: "modified"});
                $toast.success(t('Toast.Field_Updated_Successfully'), {position: 'top-right' })
            }else{
                rereadDefinitions();
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err)=>{
            console.error("Error in updating the custom field",err);
            rereadDefinitions();
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        });
    };
    const handleCloseSidebar = (val,pageIndex) => {
        if(pageIndex === 0) visible.value = val;
        componentDetail.value={};
        customFieldObject.value={};
    };
    const editCustomField = (val) => {
        componentDetail.value = CustomFieldData.value.find((x)=> x.cfType === val.fieldType);
        customFieldObject.value = val;
        if(componentDetail.value){
            visible.value = true;
        }
    };
    const handleClose = () => {
        visible.value = false;
        componentDetail.value = {};
        customFieldObject.value = {};
    };
</script>
<style scoped>
.customField-wrapper {
    padding: 20px;
}
.addcustomfield-btn {
    margin-bottom: 20px;
}
</style>