<template>
    <span
        v-for="(obj,ind) in props.projectData?.viewColumn.filter(x =>
            !x?.key?.includes('created_by') &&
            !x?.key?.includes('created_date') &&
            !x?.key?.includes('TaskKey') &&
            !x?.key?.includes('Task_Priority') &&
            !x?.key?.includes('DueDate') &&
            !x?.key?.includes('AssigneeUserId') &&
            !x?.key?.includes('commentCounts') &&
            (x.funcPermission ? checkPermission(x.funcPermission,projectData.isGlobalPermission) !== null : true ) && (x.appPermission ? checkApps(x.appPermission) : true ) &&
            x?.show === true)"
        :key="ind"
        class="task_right custom__field_list_view"
        @click="handleOpenInput(obj,props.task._id)"
    >
        <template v-if="props.task.customField && Object.keys(props.task.customField).length">
            <template v-for="(item, index) in Object.keys(props.task.customField)" :key="index">
                <div v-if="obj.key === props.task.customField[item]._id" class="position-re">
                    <component
                        :is="getView(props.task.customField[item]?.fieldType)"
                        @blurUpdate="submitHandler"
                        :detail="props.task.customField[item]"
                        @outSideClick="handleOutSideClick"
                        :customFieldId="customFieldId"
                        :taskId="taskId"
                    />
                </div>
            </template>
        </template>
        <!-- Read-only computed columns (formula/rollup) are never stored on the task, so render them from the live def. -->
        <div v-if="computedDefs[obj.key]" class="position-re">
            <ComputedComponentViewColumn
                :def="computedDefs[obj.key]"
                :task="props.task"
                :allTasks="allTasksList"
                :defs="finalCustomFieldsList"
            />
        </div>
    </span>
</template>

<script setup>
    //import
    import * as env from '@/config/env';
    import taskClass from "@/utils/TaskOperations";
    import { useToast } from "vue-toast-notification";
    import { apiRequest } from '../../../../../services';
    import { computed, nextTick, ref, inject } from 'vue';
    import { useCustomComposable,useGetterFunctions } from '@/composable';
    import DateComponentListing from '../../atom/customFieldViewColumn/dateComponentViewColumn.vue';
    import EmailComponentListing from '../../atom/customFieldViewColumn/emailComponentViewColumn.vue';
    import PhoneComponentListing from '../../atom/customFieldViewColumn/phoneComponentViewColumn.vue';
    import MoneyComponentListing from '../../atom/customFieldViewColumn/moneyComponentViewColumn.vue';
    import TextComponentViewColumn from '../../atom/customFieldViewColumn/textComponentViewColumn.vue';
    import NumberComponentListing from '../../atom/customFieldViewColumn/numberComponentViewColumn.vue';
    import TextareaComponentListing from '../../atom/customFieldViewColumn/textareaComponentViewColumn.vue';
    import CheckboxComponentListing from '../../atom/customFieldViewColumn/checkboxComponentViewColumn.vue';
    import DropdownComponentListing from '../../atom/customFieldViewColumn/dropdownComponentViewColumn.vue';
    import ComputedComponentViewColumn from '../../atom/customFieldViewColumn/computedComponentViewColumn.vue';
    import { useStore } from 'vuex';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    const { getUser } = useGetterFunctions();

    const {checkPermission, checkApps} = useCustomComposable();
    const $toast = useToast()
    //props
    const props = defineProps({
        projectData:{
            type:Object,
            default:() => {}
        },
        task:{
            type:Object,
            default:() => {}
        }
    });

    const {getters} = useStore();

    // All custom field definitions (used to resolve formula references and rollup sources).
    const finalCustomFieldsList = computed(() => getters['settings/finalCustomFields'] || []);

    // Map of computed (formula/rollup) field definitions keyed by their _id.
    const computedDefs = computed(() => {
        const map = {};
        finalCustomFieldsList.value.forEach((def) => {
            if (def && (def.fieldType === 'formula' || def.fieldType === 'rollup')) {
                map[def._id] = def;
            }
        });
        return map;
    });

    // Flat, de-duped task list (parents + subtasks) for rollup aggregation — from the
    // sources populated in the List/Board/Table flow (the row task's own subtaskArray
    // and the projectData/tasks map), with the dashboard-only projectData/alltasks as
    // a fallback. De-duped by _id. Returns [] on failure so rollups degrade to '—'.
    const allTasksList = computed(() => {
        try {
            const seen = new Set();
            const flat = [];
            const add = (t) => {
                if (t && t._id && !seen.has(String(t._id))) { seen.add(String(t._id)); flat.push(t); }
            };
            const addWithKids = (t) => {
                add(t);
                if (t && Array.isArray(t.subtaskArray)) t.subtaskArray.forEach(add);
            };
            addWithKids(props.task);
            const map = getters['projectData/tasks'] || {};
            Object.values(map).forEach((byProject) => {
                if (byProject && typeof byProject === 'object') {
                    Object.values(byProject).forEach((node) => {
                        const tasks = node && Array.isArray(node.tasks) ? node.tasks : [];
                        tasks.forEach(addWithKids);
                    });
                }
            });
            const alt = getters['projectData/alltasks'];
            if (Array.isArray(alt)) alt.forEach(addWithKids);
            return flat;
        } catch (error) {
            return [];
        }
    });

    // ref
    const taskId = ref('');
    const customFieldId = ref('');
    //inject
    const userId = inject('$userId');
    const companyId = inject("$companyId");
    const customFieldPermission = computed(() => checkPermission("task.task_custom_field", props.projectData.isGlobalPermission, {gettersVal: getters}))
    const companyOwner = computed(() => {
        return getters["settings/companyOwnerDetail"];
    });

    //getUser
    const user = getUser(userId.value);
    
    // function
    const getView = (val) => {
        switch(val){
            case 'text':
                return TextComponentViewColumn
            case 'textarea':
                return TextareaComponentListing
            case 'number':
                return NumberComponentListing
            case 'checkbox':
                return CheckboxComponentListing
            case 'money':
                return MoneyComponentListing
            case 'dropdown':
                return DropdownComponentListing
            case 'date':
                return DateComponentListing
            case 'email':
                return EmailComponentListing
            case 'phone':
                return PhoneComponentListing
        }
    };

    const submitHandler = (value,details,id,edit) => {
        let detail = JSON.parse(JSON.stringify(details));
        if(value && detail.fieldType !== 'checkbox'){
            detail.fieldValue = value;
            if(detail.fieldType === 'date'){
                try{
                    detail.fieldValue = new Date(value);
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'dropdown'){
                detail.fieldValue = [value.id];
                try {
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'number' || detail.fieldType === 'money'){
                try{
                    detail.fieldValue = String(value);
                    insertCustomField(detail,value);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else{
                nextTick(() => {
                    const input = document?.getElementById(`${id}`);
                    const ariaDescribedByValue = input?.getAttribute('aria-describedby');
                    if(value && ariaDescribedByValue === null){
                        try{
                            if(detail.fieldType === "phone"){
                                if(edit){
                                    detail.fieldValue = "";
                                    detail.fieldCode = value.dialCode;
                                    detail.fieldPattern = value.maskWithDialCode;
                                    detail.fieldFlag = value.code;
                                }else{
                                    detail.fieldValue = detail.fieldValue?.replace(/^\+(\d+)\s|\s|\(|\)|-/g, '');
                                    detail.fieldCode = detail.fieldCode ? detail.fieldCode : detail.fieldCountryCode;
                                    detail.fieldPattern = detail.fieldPattern ? detail.fieldPattern : detail.fieldCountryObject.maskWithDialCode;
                                    detail.fieldFlag = detail.fieldFlag ? detail.fieldFlag : detail.fieldCountryObject.code;
                                }
                            }
                            insertCustomField(detail,value);
                        } catch(error){
                            console.error('ERROR',error);
                        }
                    }
                });
            }
        } else if(detail.fieldType === 'checkbox'){
            try{
                detail.fieldValue = value;
                insertCustomField(detail,value);
            } catch(error){
                console.error('ERROR',error);
            }
        }else{
            if(detail.fieldType !== "phone"){
                customFieldId.value = "";
            }
        }
    };

    const insertCustomField = (detail,data) => {
        let userData = {
            id: user.id,
            name: user.Employee_Name,
            companyOwnerId: companyOwner.value._id,
        }
        let updateDetail = {};
        updateDetail.fieldValue = detail.fieldValue;
        if(detail.fieldType === "phone"){
            updateDetail.fieldCode = detail?.fieldCode;
            updateDetail.fieldPattern = detail?.fieldPattern;
            updateDetail.fieldFlag = detail?.fieldFlag;
        }
        updateDetail._id = detail._id;
        taskClass.updateTaskCustomField({taskId: props.task._id, customFieldId: detail._id, updateDetail: updateDetail,companyId:companyId.value,taskObj:props.task,detail:detail}).then((res) => {
            if(res.status){
                let historyObj = {
                    'message': `<b>${userData.name}</b> has added value in <b> ${detail.fieldTitle}</b> Custom Field as <b>${data.value ? data.value : data}</b>.`,
                    'key' : 'Project_Category',
                    'sprintId' : props.task.sprintId
                }
                apiRequest("post", env.HANDLE_HISTORY, {
                    "type": 'task',
                    "companyId": companyId.value,
                    "projectId": props.task.ProjectID,
                    "taskId": props.task._id,
                    "object": historyObj,
                    "userData": userData
                }).catch((err) =>{
                    console.error("Error in updating the notification",err);
                });
                if(detail.fieldType !== "phone"){
                    customFieldId.value = "";
                }
                $toast.success(t("Toast.Custom_field_updated_successfully"), {position: 'top-right' });
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
        }).catch((err)=>{
            console.error('Error in updating the custom field',err);
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        });
    };

    const handleOpenInput = (value,id) => {
        if(customFieldPermission.value == true){
            taskId.value = id;
            customFieldId.value = value.key;
        }
    };

    const handleOutSideClick = () => {
        customFieldId.value = "";
    }
</script>
<style scoped>
    @import './style.css';
</style>
