<!--
    File Name: TaskFilter.vue
    Created By: Parth Detroja
-->
<template>
    <div class="d-flex align-items-center position-re" :class="{'mr-15' : clientWidth > 767 , 'mr-010' : clientWidth <= 767}">
        <DropDown maxHeight="47dvh" zIndex="99" :bodyClass="{'main-filter-dropdown-wrapper' : true}">
            <template #head>
                <div class="d-flex align-items-center justify-content-between filter-title" v-if="clientWidth <= 767">
                    <h3 class="m-0">{{$t('Filters.filter')}}</h3>
                    <div class="filter-info d-flex">
                        <a href="https://help.alianhub.com/" target="_blank">
                            <img src="@/assets/images/svg/info_icon.svg" alt="info icon" class="mr-5px"/>
                            {{$t('Filters.learnmorefilter')}}
                        </a>
                    </div>
                </div>
            </template>
            <template #button>
                <div class="top-filter-section">
                    <button type="button" id="projectviewfilter_driver" ref="closeFilterRef" class="task-filter-trigger" :title="$t('Projects.filter')" :aria-label="$t('Projects.filter')">
                        <img :src="editIcon" alt="" aria-hidden="true" class="task-filter-icon"/>
                    </button>
                    <span v-if="isApplyed" class="task-filter-count">{{inputs.length}}</span>
                    <button v-if="isApplyed" type="button" class="task-filter-clear" :title="$t('Filters.clearall')" :aria-label="$t('Filters.clearall')" @click.stop.prevent="clearFilter">
                        <img src="@/assets/images/svg/deletered.svg" alt="" aria-hidden="true" class="task-filter-close"/>
                    </button>
                </div>
            </template>
            <template #options>
                <div class="bottom-filter-section bg-white" >
                    <div class="d-flex justify-content-between w-100 mb-13px" v-if="clientWidth > 767">
                        <div class="filter-title">
                            <h2 class="m-0 font-size-18 text-capitalize">{{ isEdit === true ? selectedRow.name : $t('Filters.filter')}}</h2>
                        </div>
                        <div class="filter-info d-flex">
                            <a href="https://help.alianhub.com/" target="_blank">
                                <img src="@/assets/images/svg/info_icon.svg" alt="info icon" class="mr-5px"/>
                                {{$t('Filters.learnmorefilter')}}
                            </a>
                        </div>
                    </div>
                    <div v-if="!isValidate" role="alert" aria-live="polite" aria-atomic="true" class="alert alert-danger font-size-13">{{$t('Filters.pleaseselectvalid')}}</div>
                    <div class="table-data task-table-data">
                        <FieldsTable
                            :inputs="inputs"
                            :statusArray="statusArray"
                            :taskTypeArray="taskTypeArray"
                            :priorities="prioritiesArray"
                            :tagsArray="tagsArray"
                            :users="users"
                            :mainOptions="keysArray"
                            :dueDateOptions="dueDateOptions"
                            @delete="deleteRow"
                        />
                    </div>
                    <div class="d-flex w-100 add-filter-wrapper">
                        <div class="add-section mb-13px" :class="{'d-flex justify-content-between w-100' : clientWidth <= 767}" v-if="keysArray.length">
                            <span><a href="#" class="mr-10px"  @click.stop.prevent="clearFilter($event), $refs.closeFilterRef.click()" v-if="clientWidth <= 767" :class="{'font-weight-500 font-size-18' : clientWidth <=767}">{{$t('Filters.clearall')}}</a></span>
                            <a href="#" class="blue" @click.stop.prevent="addRow" :class="{'font-weight-400 font-size-12' : clientWidth > 767 , 'font-weight-500 font-size-18' : clientWidth <= 767}">+ {{$t('Filters.addfilter')}}</a>
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
                        @clear="clearFilter($event), $refs.closeFilterRef.click()"
                        :getFiltersData="getFiltersData"
                        :handleUpdate="handleUpdate"
                    />
                </div>
            </template>
        </DropDown>
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
import { useStore } from "vuex";
import { useToast } from 'vue-toast-notification';
import { ref, onMounted, defineProps, computed, watch, defineEmits, inject, nextTick } from 'vue';

// Components
import * as env from '@/config/env';
import { useGetterFunctions } from "@/composable";
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import DropDown from '@/components/molecules/DropDown/DropDown.vue';
import FieldsTable from '@/components/molecules/TaskFilter/FieldsTable.vue';
import FieldsActions from '@/components/molecules/TaskFilter/FieldsActions.vue';
import { apiRequest } from '../../../services';
import { useI18n } from "vue-i18n";
const { t } = useI18n();
import { buildFilterQuery } from "@/composable/commonFunction";
import { clearFilterSignal } from "@/views/Projects/composables/taskFilterSignal";

// Utils
const { getUser } = useGetterFunctions();
const { getters } = useStore();
const priorities = computed(() => getters["settings/companyPriority"]);
const $toast = useToast();

// Props
const props = defineProps({
    projectData: {
        type: Object,
        default: () => {}
    },
    selectedProjects: {
        type: Array,
        default: () => []
    }
})

// Emites
const emits = defineEmits(["apply","clear"]);

// Watch on project data update
watch(() => props.projectData, (newVal, oldVal) => {
    if(JSON.stringify(newVal._id) !== JSON.stringify(oldVal._id)) {
        getFiltersData();
        clearFilter();
    }
});

// Images
const editIcon = require("@/assets/images/svg/TaskFilter.svg");
//Variables
const clientWidth = inject("$clientWidth");
const companyId = inject('$companyId');
const userId = inject('$userId');
const isEdit = ref(false);
const isApplyed = ref(false);
const isValidate = ref(true);
const inputs = ref([]);
const isConfirm = ref(false);
const isInvalid = ref(false);
const selectedRow = ref({});
const filters = ref([]);
const closeFilterRef = ref();
const mainOptions = ref([
    { value: 'statusKey', name: "status",type:'array',filterOn:'statusKey' },
    { value: 'DueDate', name: "due_date",type:'date',filterOn:'DueDate' } ,
    { value: 'Task_Priority', name: "priority",type:'array',filterOn:'Task_Priority' },
    { value: 'Task_Leader', name: "created_by",type:'array',filterOn:'Task_Leader' },
    { value: 'TaskTypeKey', name: "task_type",type:'array',filterOn:'TaskTypeKey' },
    { value: 'tagsArray', name: "tags",type:'array',filterOn:'tagsArray' }
]);
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

const keysArray = computed(() => {
    return mainOptions.value.filter(option => {
        if(!inputs.value.some(input => input.name.value === option.value)) {
            return option;
        }
    });
});
const users = computed(() => {
    return props.projectData?.AssigneeUserId?.map((x) => {
        const user = getUser(x);
        return {
            finalValue: x,
            value: x,
            name: user.Employee_Name,
            image: user.Employee_profileImageURL,
            isOnline: user.isOnline
        }
    }).filter((x) => !getUser(x.value).ghostUser)?.sort((a, b) => a?.name.localeCompare(b?.name));
});
const statusArray = computed(() => {
    return props.projectData?.taskStatusData?.map((x) => {
        return { ...x, finalValue: x.key }
    })?.sort((a, b) => a?.name.localeCompare(b?.name));
});
const taskTypeArray = computed(() => {
    return props.projectData?.taskTypeCounts?.map((x) => {
        return { ...x, finalValue: x.key }
    })?.sort((a, b) => a?.name.localeCompare(b?.name));
});
const tagsArray = computed(() => {
    return props.projectData?.tagsArray?.map((x) => {
        return { ...x, finalValue: x.uid, name: x.tagName }
    })?.sort((a, b) => a?.name.localeCompare(b?.name));
});
const prioritiesArray = computed(() => {
    return priorities?.value.map((x) => {
        return { ...x, finalValue: x.value}
    })?.sort((a, b) => a?.name.localeCompare(b?.name));
});

// Mounted
onMounted(() => {
    addRow();
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
 * This function is used for the handle update event
 * @param {*} obj 
 */
const handleUpdate = async (obj) => {
    let params = [
        { _id: obj.id },
        { $set: obj?.name ? { name: obj.name } : { filters: obj.filters } }
    ]

    await apiRequest("put", `${env.TASK_GLOBAL_FILTER}/update?projectId=${props.projectData?.id || ''}`, params).then((result) => {
        if (result.status) {
            getFiltersData();
            $toast.success(t('Toast.Filter_update_successfully'), { position: 'top-right' });

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
    const arraykeys = ["statusKey", "Task_Priority", "Task_Leader", "TaskTypeKey", "tagsArray"];
    const dateKeys = ["DueDate"];
    let arrayData = [];
    if(arraykeys.includes(key)) {
        arrayData = [
            { value: ':', name: "Is" }
        ]
    } else if(dateKeys.includes(key)) {
        arrayData = [
            { value: ':>', name: "Greater Than" },
            { value: ':<', name: "Less Than" },
            { value: ':=', name: "Is" }
        ]
    }
    return arrayData;
}

/**
 * This function is used to validate each fields in the tables
 */
const validateItems = () => {
    let isValid = true; // Assume the array is valid initially

    inputs.value.forEach(item => {
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
    filterBy = buildFilterQuery(queries)
    emits('apply', filterBy);
    isApplyed.value = true;
    closeFilterRef.value.click();
}

/**
 * This function is used to clear all the selected filters and close it
 */
const resetPanel = () => {
    inputs.value = [];
    addRow();
    isValidate.value = true;
    isEdit.value = false;
    isApplyed.value = false;
}
const clearFilter = () => {
    resetPanel();
    emits('clear', true);
}
watch(clearFilterSignal, resetPanel);

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
        await apiRequest("delete", `${env.TASK_GLOBAL_FILTER}/delete/${companyId.value}/${selectedRow.value._id}?projectId=${props.projectData?.id || ''}`).then((result) => {
            if (result.status) {
                const index = filters.value.findIndex(x => x._id === selectedRow.value._id);
                if (index !== -1) {
                    filters.value.splice(index, 1);
                }
                $toast.success(t("Toast.Filter_deleted_successfully"), { position: 'top-right' });
                isConfirm.value = false;
            }
        });
    }
}
</script>
<style> @import "./style.css"; </style>