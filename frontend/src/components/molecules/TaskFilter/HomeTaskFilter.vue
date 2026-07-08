<!--
    File Name: TaskFilter.vue
    Created By: Parth Detroja
-->
<template>
    <div class="bg-white d-flex align-items-center position-re border-radius-6-px" :class="{'mr-15' : clientWidth > 767 , 'mr-010' : clientWidth <= 767}">
        <div class="bottom-filter-section bg-white home_card" >
            <div v-if="!isValidate || !isValidateFilter" role="alert" aria-live="polite" aria-atomic="true" class="alert alert-danger font-size-13">{{$t('Filters.pleaseselectvalid')}}</div>
            <div class="table-data">
                <FieldsTable
                    :inputs="inputs"
                    :statusArray="statusArray"
                    :taskTypeArray="taskTypeArray"
                    :priorities="prioritiesArray"
                    :tagsArray="tagsArray"
                    :users="users"
                    :teams="teams"
                    :mainOptions="keysArray"
                    :dueDateOptions="dueDateOptions"
                    @delete="deleteRow"
                />
            </div>
            <div class="d-flex w-100 add-filter-wrapper">
                <div class="add-section mb-13px" :class="{'d-flex justify-content-between w-100' : clientWidth <= 767}" v-if="keysArray?.length">
                    <span><a href="#" class="mr-10px font-weight-400 font-size-12"  @click.stop.prevent="clearFilter($event)" v-if="clientWidth <= 767" >{{$t('Filters.clearall')}}</a></span>
                    <a href="#" class="blue font-weight-400 font-size-12" @click.stop.prevent="addRow">+ {{$t('Filters.addfilter')}}</a>
                </div>
            </div>
            <FieldsActions
                :filters="filters"
                :isInvalid="isInvalid"
                :isEdit="isEdit"
                @save="saveFilter"
                @update="updateFilter"
                @delete="deleteFilter"
                @apply="applyFilter"
                @clear="clearFilter($event)"
                :getFiltersData="getFiltersData"
                :handleUpdate="handleUpdate"
                :from="'Dashboard'"
            />
        </div>
        <ConfirmModal
            :modelValue="isConfirm"
            :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')"
            :header="true"
            :showCloseIcon="false"
            @accept="handleConfirm"
            @close="isConfirm = false"
        >
            <template #header>
                <h3 class="m-0">{{$t('Filters.confirm')}}</h3>
            </template>
            <template #body>
                <span>{{$t('Filters.are_you_sure')}}?</span>
            </template>
        </ConfirmModal>
    </div>
</template>
<script setup>
// Packages
import moment from 'moment';
import { useStore } from "vuex";
import { useToast } from 'vue-toast-notification';
import { ref, onMounted, defineProps, computed, watch, defineEmits, inject, nextTick } from 'vue';

// Components
import * as env from '@/config/env';
import { useGetterFunctions } from "@/composable";
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
// import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import FieldsTable from '@/components/molecules/TaskFilter/FieldsTable.vue';
import FieldsActions from '@/components/molecules/TaskFilter/FieldsActions.vue';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// Utils
const { getUser } = useGetterFunctions();
const { getters } = useStore();
const priorities = computed(() => getters["settings/companyPriority"]);
const $toast = useToast();
const companyOwner = computed(() => getters["settings/companyOwnerDetail"]);
const allUsersArray = computed(() => getters["users/users"]);

// Props
const props = defineProps({
    projectData: {
        type: Object,
        default: () => {}
    },
    selectedProjects: {
        type: Array,
        default: () => []
    },
    selected: {
        type: Array,
        default: () => {}
    },
    isValidateFilter: {
        type: Boolean,
        default: true
    },
    filterField: {
        type: Array,
        default: () => [],
    }
})
// Emites
const emits = defineEmits(["apply","clear","selectedFilter"]);

// Watch on project data update
watch(() => props.selectedProjects, (newVal, oldVal) => {
    if(JSON.stringify(newVal._id) !== JSON.stringify(oldVal._id)) {
        getFiltersData();
        clearFilter();
    }
});

// Images
// const editIcon = require("@/assets/images/svg/TaskFilter.svg");
//Variables
const clientWidth = inject("$clientWidth");
const companyId = inject('$companyId');
const userId = inject('$userId');
const isEdit = ref(false);
const isApplyed = ref(false);
const isValidate = ref(true);
const inputs = ref(props.selected);
const isConfirm = ref(false);
const isInvalid = ref(false);
const selectedRow = ref({});
const filters = ref([]);
const mainOptions = ref([
    { value: 'statusKey', name: "status",type:'array',filterOn:'statusKey' },
    { value: 'DueDate', name: "due_date",type:'date',filterOn:'DueDate' } ,
    { value: 'Task_Priority', name: "priority",type:'array',filterOn:'Task_Priority' },
    { value: 'Task_Leader', name: "created_by",type:'array',filterOn:'Task_Leader' },
    { value: 'TaskTypeKey', name: "task_type",type:'array',filterOn:'TaskTypeKey' },
    { value: 'tagsArray', name: "tags",type:'array',filterOn:'tagsArray' },
    {value: 'AssigneeUserId', name: "Assignee",type:'array',filterOn:'AssigneeUserId'}
]);
const keysArray = computed(() => {
    return mainOptions.value.filter(option => {
        if(!inputs.value.some(input => input.name.value === option.value) && !props.filterField.includes(option.value)) {
            return option;
        }
    });
});

const dueDateOptions = ref(
    [
        { finalValue:"Today", name: t('dashboardCard.Today'),key: "Today"},
        { finalValue: 'Yesterday', name: t('dashboardCard.Yesterday'),key: "Yesterday" },
        { finalValue: 'Tomorrow', name: t('dashboardCard.Tomorrow'),key: "Tomorrow" },
        { finalValue: 'This week', name: t('dashboardCard.This_week'),key: "This_week" },
        { finalValue:'Next week', name: t('dashboardCard.Next_week'),key: "Next_week"},
        { finalValue: 'Next 7 days', name: t('dashboardCard.Next_seven_days'),key: "Next_seven_days"},
        { finalValue: 'Last 7 days', name: t('dashboardCard.Last_seven_days'),key: "Last_seven_days"},
        { finalValue: 'Last month', name: t('dashboardCard.Last_month'),key: "Last_month"},
        { finalValue: 'This month', name: t('dashboardCard.This_month'),key: "This_month"},
        { finalValue: 'Next month', name: t('dashboardCard.Next_month'),key: "Next_month"},
        { finalValue: 'Date range',name: t('dashboardCard.Date_range'),key: "Date_range"}
    ]
)

const users = computed(() => {
    let allUsers = [];
    if(props.selectedProjects?.length && !props.selectedProjects.some((e) => e.isPrivateSpace === false)) {
        props.selectedProjects?.forEach(project => {
            project?.AssigneeUserId?.forEach(x => {
                const user = getUser(x);
                const index = allUsers.findIndex((x) => x.finalValue === user._id);
                if (user && !user.ghostUser && index === -1) {
                    allUsers.push({
                        finalValue: x,
                        value: x,
                        name: user.Employee_Name,
                        image: user.Employee_profileImageURL,
                        isOnline: user.isOnline
                    });
                }
            });
        });
    } else {
        allUsersArray.value.forEach((e)=>{
            const user = getUser(e._id);
            if(user && !user.ghostUser) {
                allUsers.push({
                    finalValue: e._id,
                    value: e._id,
                    name: user.Employee_Name,
                    image: user.Employee_profileImageURL,
                    isOnline: user.isOnline
                });
            }
        })
    }
    const userData = getUser(userId.value);
    return [{
        "finalValue":"$meMode",
        "value": "$meMode",
        "name": "me_mode",
        "image": userData.Employee_profileImageURL,
        "isOnline": true
    }, ...allUsers.sort((a, b) => a.name.localeCompare(b.name))];
});

const teams = computed(() => {
    const teamsArr = getters["settings/teams"];
    return teamsArr.map((x) => {
        return {
            "finalValue": "tId_"+x._id,
            "value": "tId_"+x._id,
            "name": x.name,
            "teamColor": x.teamColor,
            "assigneeUsersArray": x.assigneeUsersArray
        }
    })
});
const statusArray = computed(() => {
    let allStatuses = [];
    props.selectedProjects?.forEach(project => {
        project?.taskStatusData?.forEach(x => {
            const index = allStatuses.findIndex((ind) => ind.key === x.key);
            if (index === -1){
                allStatuses.push({ ...x, finalValue: x.key });
            }
        });
    });
    return allStatuses?.sort((a, b) => a?.name.localeCompare(b?.name));
});

const taskTypeArray = computed(() => {
    let allTaskTypes = [];
    props.selectedProjects?.forEach(project => {
        project?.taskTypeCounts?.forEach(x => {
            const index = allTaskTypes.findIndex((ind) => ind.key === x.key);
            if (index === -1){
                allTaskTypes.push({ ...x, finalValue: x.key });
            }
        });
    });
    return allTaskTypes?.sort((a, b) => a?.name.localeCompare(b?.name));
});

const tagsArray = computed(() => {
    let allTags = [];
    props.selectedProjects?.forEach(project => {
        project?.tagsArray?.forEach(x => {
            allTags.push({ ...x, finalValue: x.uid, name: x.tagName });
        });
    });
    return allTags?.sort((a, b) => a?.name.localeCompare(b?.name));
});

const prioritiesArray = computed(() => {
    return priorities?.value.map((x) => {
        return { ...x, finalValue: x.value}
    })?.sort((a, b) => a?.name.localeCompare(b?.name))
});
function getUserData() {
    const user = getUser(userId.value);
    return {
        id: user.id,
        Employee_Name: user.Employee_Name,
        companyOwnerId: companyOwner.value.id,
    };
}
const userData = getUserData();

// Mounted
onMounted(() => {
    if(props?.selected && props?.selected.length > 0) {
        isApplyed.value = true;
    }
    else{
        addRow();
    }
    getFiltersData();
});

/**
 * Get saved filter data from database
 */
const getFiltersData = async () => {
    try {
        const result = await apiRequest("get", `${env.TASK_GLOBAL_FILTER}/${userId.value}`);
        if (result.data.status) {
            filters.value = [];
            if (result && result.data.data.length) {
                result.data.data.forEach((doc) => {
                filters.value.push({ ...doc, isEdit: false });
                });
            }
        }
    } catch (error) {
        console.error("Error fetching filters data:", error);
    }
};

/**
 * This function is used to manage all the task history for the project and tasks
 * @param {*} type 
 * @param {*} key 
 * @param {*} message 
 */
const manageHistory = async (type, key, message) => {
    const axiosData = {
        "type": type,
        "companyId": companyId.value,
        "projectId": props.projectData.id,
        "taskId": null,
        "object": {
            "sprintId": null,
            "key": key,
            "message": message
        },
        "userData": getUserData()
    };
    await apiRequest("post", env.HANDLE_HISTORY, axiosData).then((result) => {
        if(result.data.status) {
            console.info(result.data.statusText)
        }
    });
}

/**
 * This function is used for the handle update event
 * @param {*} obj 
 */
const handleUpdate = async (obj) => {
    let params = [
        { _id: obj.id },
        { $set: obj?.name ? { name: obj.name } : { filters: obj.filters } }
    ]

    await apiRequest("put", `${env.TASK_GLOBAL_FILTER}/update`, params).then((result) => {
        if (result.status) {
            getFiltersData();
            $toast.success(t('Toast.Filter_update_successfully'), { position: 'top-right' });

            const msg = `<b>${userData.Employee_Name}</b> has been updated <b>${selectedRow.value.name}</b> filter`;
            manageHistory('project', "Project_Filter", msg);
        }
    });
}

/**
 * This is a callback function which is used to manage mulitple array based on type. It return data based on used
 * @param {String} type 
 */
 const manageArray = (type) => {
    let arrayData = [];
    if(type === "statusKey") {
        arrayData = statusArray;
    } else if (type === "Task_Priority") {
        arrayData = prioritiesArray;
    } else if (type === "TaskTypeKey") {
        arrayData = taskTypeArray;
    } else if (type === "Task_Leader") {
        arrayData = users;
    } else if (type === "tagsArray") {
        arrayData = tagsArray;
    }
    else if (type === "AssigneeUserId") {
        arrayData = users;
    }
    else if (type === "DueDate") {
        arrayData = dueDateOptions;
    }
    return arrayData;
}

/**
 * Populate the value in comparision array based on key
 * @param {String} key 
 */
const manageComparisonArray = (key) => {
    const arraykeys = ["Task_Priority", "Task_Leader", "TaskTypeKey", "tagsArray","AssigneeUserId"];
    const dateKeys = ["DueDate"];
    const statusKeys = ["statusKey"];
    let arrayData = [];
    if(arraykeys.includes(key)) {
        arrayData = [
            { value: ':', name: "Is" },
            { value: ':!=', name: "Not_Equals_To" }
        ]
    } else if(dateKeys.includes(key)) {
        arrayData = [
            { value: ':>', name: "Greater_Than" },
            { value: ':<', name: "Less_Than" },
            { value: ':=', name: "Is" }
        ]
    } else if(statusKeys.includes(key)) {
        arrayData = [
            { value: ':=', name: "Is" },
            { value: ':!=', name: "Not_Equals_To" },
        ]
    }
    return arrayData;
}

/**
 * This function is used to validate each fields in the tables
 */
const validateItems = () => {
    let isValid = true; // Assume the array is valid initially
    inputs.value?.forEach(item => {
        item.isValidate = true;

        if (typeof item.name !== "object" || Object.keys(item.name).length === 0) {
            item.isValidate = false;
        }
        if (typeof item.comparison !== "object" || Object.keys(item.comparison).length === 0) {
            item.isValidate = false;
        }
        if (item.name.value === "DueDate") {
            if (item.values.length === 0) {
                item.isValidate = false;
            }
            if(item.values.includes('Date range') && item.date === ''){
                item.isValidate = false;
            }
        } else {
            if (!Array.isArray(item.values) || item.values.length === 0) {
                item.isValidate = false;
            }
        }
        if (item.isValidate === false) {
            isValid = false;
        }
    });
    return isValid;
}

/**
 * This function is used to add new row
 */
const addRow = () => {
    if(!validateItems()) {
        isValidate.value = false;
        return;
    }

    isValidate.value = true;
    const obj = {
        name: {},
        comparison: {},
        values: [],
        condition: inputs.value.length > 0 ? inputs.value[0].condition : "&&",
        date: "",
        isAllChecked: false,
        isValidate: true,
        displayData: [],
        comparisonsData: [],
    }
    inputs.value.push(obj);

    nextTick(() => {
        if(inputs.value.length > 5) {
            const el = document.querySelector(`#num-${inputs.value.length - 1}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: "end" });
            }
        }
    })
}

/**
 * This function is used to delete perticuler row for the filters
 * @param {*} index 
 */
const deleteRow = (row) => {
    inputs.value.splice(row.index, 1);
    emits('selectedFilter', inputs.value);
}

/**
 * This function is used to apply filter on the seleted query and get result from the mongo
 */
const applyFilter = (data) => {
    isValidate.value = true;
    let filterBy = {};
    let queries = [];

    if(data.type === "saved") {
        inputs.value = [];
        isEdit.value = true;
        selectedRow.value = data.item;
        queries = JSON.parse(JSON.stringify(data.item.filters));
        queries.map(x => x.comparisonsData = manageComparisonArray(x.name.value));
        queries.map(x => manageArray(x.name.value).value.filter(v => x.values.includes(v.finalValue)));
        nextTick(() => {
            inputs.value = queries
        });
    } else {
        if(!validateItems()) {
            isValidate.value = false;
            return;
        }
        queries = JSON.parse(JSON.stringify(inputs.value));
    }
    emits('selectedFilter', queries);
    queries.forEach((query) => {
        const queryField = query.name.value;
        const comparison = query.comparison.value;
        const condition = query.condition === '||' ? '$or' : '$and';
        const filterOn = query.name.filterOn;
        if(filterBy[condition] === undefined){
            filterBy[condition] = [];
        }
        if(query.name.type === "arrayOfObject"){
            filterBy[condition].push({[queryField]:{$elemMatch: {[filterOn]:{ $in: query.values }}}}) 
        } else if(query.name.type === "object"){
            const filteField = `${queryField}.${filterOn}`;
            filterBy[condition].push({[filteField]: {$in: query.values}});
        } else if(query.name.type === "string" || query.name.type === "array"){
            if(comparison === ':!=') {
                filterBy[condition].push({[filterOn]: {$nin: query.values}});
            } else {
                filterBy[condition].push({[filterOn]: {$in: query.values}});
            }
        } else if(query.name.type === "date") {
            const date = new Date(query.date);
            const now = moment(new Date(query.date));
            const nextDate = new Date(now.endOf('day'));
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);
            if(comparison === ':=') {
                const startDate = new Date(query.date).setHours(0,0,0,0);
                const endDate = new Date(query.date).setHours(23,59,59,59);
                filterBy[condition].push({[filterOn]: { dbDate: { $gte: new Date(startDate), $lte: new Date(endDate) }}});
            } else if(comparison === ':>') {
                filterBy[condition].push({[filterOn]: { dbDate: { $gt: new Date(nextDate) }}});
            } else {
                filterBy[condition].push({[filterOn]: { dbDate: { $lt: new Date(date) }}});
            }
        } else if(query.name.type === "dateNumber"){
            const date = new Date(query.date);
            const now = moment(new Date(query.date));
            const nextDate = new Date(now.endOf('day'));
            date.setHours(0);
            date.setMinutes(0);
            date.setSeconds(0);
            if(comparison === ':=') {
                const startDate = new Date(query.date).setHours(0,0,0,0);
                const endDate = new Date(query.date).setHours(23,59,59,59);
                filterBy[condition].push({[filterOn]:{$gte: new Date(startDate).getTime() / 1000,$lte: new Date(endDate).getTime() / 1000}});
            } else if(comparison === ':>') {
                filterBy[condition].push({[filterOn]: {$gt: new Date(nextDate).getTime() / 1000}});
            } else {
                filterBy[condition].push({[filterOn]: {$lt: new Date(date).getTime() / 1000}});
            }
        } else {
            filterBy = {...filterBy}
        }
    });
    emits('apply', filterBy);
    isApplyed.value = true;
}

/**
 * This function is used to clear all the selected filters and close it
 */
const clearFilter = () => {
    inputs.value = [];
    addRow();
    emits('clear', true);
    emits('selectedFilter', inputs.value);
    isValidate.value = true;
    isEdit.value = false;
    isApplyed.value = false;
}

/**
 * This function is used to save the filter to the database
 */
const saveFilter = async (inputName) => {
    if(inputName === "") {
        isInvalid.value = true;
        return;
    } else {
        if(!validateItems()) {
            isValidate.value = false;
            return;
        }
    }
    isValidate.value = true;
    isInvalid.value = false;
    const arr = JSON.parse(JSON.stringify(inputs.value));
    arr.forEach((key) => {
        delete key.displayData;
        delete key.isValidate;
        delete key.comparisonsData;
    });

    const axiosData = {
        name: inputName,
        filters: arr,
        userId: userId.value,
        companyId: companyId.value,
        typeFilter: 'projectTask',
        filter: 'taskFilter',
        updatedAt: new Date(),
        createdAt: new Date()
    }
    await apiRequest("post", `${env.TASK_GLOBAL_FILTER}/create`, axiosData).then((result) => {
        if (result.status) {
            $toast.success(t('Toast.Filter_saved_successfully'), { position: 'top-right' });
            getFiltersData();
        }
    });
}

/**
 * This function is used to update selected filter to the database
 */
const updateFilter = async () => {
    // Validate if any field is blank or not
    if(!validateItems()) {
        isValidate.value = false;
        return;
    }
    isValidate.value = true;
    const arr = JSON.parse(JSON.stringify(inputs.value));
    arr.forEach((key) => {
        delete key.displayData;
        delete key.isValidate;
        delete key.comparisonsData;
    });

    const obj = { filters: arr, id: selectedRow.value._id};
    await handleUpdate(obj);
}

/**
 * This function is used to delete selected the filter to the database
 */
const deleteFilter = (row) => {
    isConfirm.value = true;
    selectedRow.value = row;
}

const handleConfirm = async (val) => {
    if (val) {
        await apiRequest("delete", `${env.TASK_GLOBAL_FILTER}/delete/${companyId.value}/${selectedRow.value._id}`).then((result) => {
            if (result.status) {
                const index = filters.value.findIndex(x => x._id === selectedRow.value._id);
                if (index !== -1) {
                    filters.value.splice(index, 1);
                }
                $toast.success(t("Toast.Filter_deleted_successfully"), { position: 'top-right' });
                isConfirm.value = false;

                // Filter history
                const msg = `<b>${userData.Employee_Name}</b> has been deleted <b>${selectedRow.value.name}</b> filter`;
                manageHistory('project', "Project_Filter", msg);
            }
        });
    }
}
</script>
<style> @import "./style.css"; </style>