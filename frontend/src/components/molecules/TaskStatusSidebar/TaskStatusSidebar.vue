<template>
    <div class="list__taskstatus-sidebar">
        <Sidebar width="374px" :zIndex="props.zTndex" :top="clientWidth <= 767 ? '0px' : '46px'" >
            <template #head-left>
                <div class="font-size-18 font-weight-700 black font-roboto-sans">{{title}}</div>
            </template>
            <template #head-right>
                <span class="add_status font-size-12 font-weight-400" v-if="isOpenAddStatus === false && isAddStatus === true" @click="isOpenAddStatus = true,formData.status.value = ''">+ {{props.type === 'task_type' ? $t("Home.add_task_type") : $t("Projects.add_status")}}</span>
                    <img :src="closeBlueImage" @click="isSidebarOpen = false,$emit('closesidebar',taskSelectedStatus)" />
            </template>
            <template #body>
                <div class="p-15px search-bar__input bg-white">
                    <InputText  
                        v-model="search"
                        :placeholder="$t('PlaceHolder.search')"
                        :borderRadius="'3px'"
                        :isDirectFocus="true"
                        :isOutline="false"
                        :height="clientWidth <= 767 ? '50px' : '30px'"
                    />
                </div>
                <div v-if="isOpenAddStatus && isAddStatus === true"  class="open__add-status position-re d-flex align-items-center justify-content-between bg-white" :class="[{'openinput_sidebar' : type !== 'task_type'}]">
                    <input type="color" v-if="props.type !== 'task_type'" v-model="statusColor" class="status__color-input position-ab">
                    <input v-if="props.type === 'task_type'" type="file" class="d-none"  ref="task_type_image" accept="image/*" @change="checkFile">
                    <button v-if="props.type === 'task_type'" class="cursor-pointer upload-image-btn btn-primary mr-10-px" type="button" @click="showIconPicker = !showIconPicker">
                        <TaskTypeIcon v-if="iconSource === 'library' && selectedIconValue" :taskType="{ iconType: 'library', iconValue: selectedIconValue, iconColor: selectedIconColor }" class="projecttasktypeform__image__after"/>
                        <img v-else-if="addNewtaskImage" :src="addNewtaskImage" class="projecttasktypeform__image__after"/>
                        <img v-else src="@/assets/images/svg/upload.svg" class="projecttasktypeform__image__before" alt="icon">
                    </button>
                    <InputText  
                        v-model="formData.status.value"
                        :placeholder="props.type === 'project_status' ? $t('PlaceHolder.enter_project_status') : props.type === 'task_type' ? $t('PlaceHolder.enter_task_type') : $t('PlaceHolder.enter_task_status')"
                        class="project__statustask-type"
                        :maxLength="25"
                        :minLength="3"
                        :isDirectFocus="true"
                        :isOutline="false"
                        @keyup="checkErrors({'field':formData.status,
                        'name':formData.status.name,
                        'validations':formData.status.rules,
                        'type':formData.status.type,
                        'event':$event.event})"
                        @enter="addTaskStatus()"
                    />
                    <span class="cursor-pointer d-flex justify-content-end ml-13px confrm__cancel-wrapper">
                        <img :src="greenCheck" class="greenCheck_sidebar vertical-middle mr-13px" @click="addTaskStatus()">
                        <img :src="deleteRed" alt="cancel" @click="isOpenAddStatus = false,formData.status.error='',resetIconState()" class="deleteRed_sidebar vertical-middle">
                    </span>
                    <div class="position-ab red font-size-11 error-text">{{formData.status.error}}</div>
                </div>
                <div v-if="props.type === 'task_type' && isOpenAddStatus && showIconPicker" class="tasktype__iconpop bg-white">
                    <div class="tasktype__iconpop-toggle">
                        <button type="button" :class="{ active: iconSource === 'library' }" @click="iconSource = 'library'">{{ $t('dashboardCard.icon_library') }}</button>
                        <button type="button" :class="{ active: iconSource === 'upload' }" @click="iconSource = 'upload'; $refs.task_type_image.click()">{{ $t('dashboardCard.icon_upload') }}</button>
                    </div>
                    <IconPicker v-if="iconSource === 'library'" v-model="selectedIconValue" v-model:color="selectedIconColor" />
                </div>
                <div class="overflow-y-auto sidebar-options overflow-x-hidden bg-white" :style="`height: ${!isOpenAddStatus && isAddStatus === true ? 'calc(100% - 0px);' : (clientWidth > 767 ? 'calc(100% - 70px);' : 'calc(100% - 90px);')}`">
                    <template v-if="filteredStatusOptions && filteredStatusOptions.length">
                        <SidebarItems
                            v-for="(item, itemIndex) in filteredStatusOptions"
                            :key="'item'+itemIndex"
                            :item="item"
                            :multiSelect="true"
                            :isDisable="true"
                            :selected="checkSelected(item)"
                            @select="(item) => updateItem('add', item)"
                            @remove="(item) => updateItem('remove', item)"
                            :taskType="true"
                            :removeKey="removeKey"
                        />
                    </template>
                    <div v-else  class="text-center red m-15px">{{$t('UserTimesheet.no_records_found')}}</div>
                </div>
            </template>
        </Sidebar>
    </div>
</template>

<script setup>
import { defineProps, ref, defineEmits, computed, inject, watch} from "vue";
import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import SidebarItems from "@/components/molecules/SidebarItems/SidebarItems.vue";
import InputText from "@/components/atom/InputText/InputText.vue";
import TaskTypeIcon from "@/components/atom/TaskTypeIcon/TaskTypeIcon.vue";
import IconPicker from "@/components/molecules/IconPicker/IconPicker.vue";
import { DEFAULT_ICON_COLOR } from "@/utils/iconLibrary";
import { useStore } from "vuex";
import { useValidation } from "@/composable/Validation";
import { useToast } from "vue-toast-notification";
import { apiRequest, apiRequestWithoutCompnay } from '../../../services';
import { useCustomComposable } from "@/composable";
import {storageQueryBuilder,generateFileName} from '@/utils/storageQueryBuild.js';
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
const { t } = useI18n();
const props = defineProps({
    isTaskSidebarOpen: {
        type: Boolean,
    },
    title: {
        type: String
    },
    options: {
        type:Array
    },
    isAddStatus: {
        type: Boolean,
        default:false
    },
    zTndex: {
        type:Number,
        default:7
    },
    type:{
        type:String,
        default:''
    },
    useDataArray: {
        type : Array,
        default: () => []
    }
})
const statusColor = ref('#AE5500');
const emit = defineEmits(["closesidebar","update:value","removed","selected"]);
const companyId = inject('$companyId')
const {getters,commit} = useStore();
const  { checkErrors, checkAllFields } = useValidation();
const { checkBucketStorage,debouncerWithPromise } = useCustomComposable();
const $toast = useToast();
const clientWidth = inject("$clientWidth");
const closeBlueImage = require("@/assets/images/svg/CloseSidebar.svg");
const greenCheck = require("@/assets/images/svg/greencheck2.svg");
const deleteRed = require("@/assets/images/svg/deletered.svg");
const defaultTaskType = inject("$defaultTaskStatusImg");

const isSidebarOpen = ref(props.isTaskSidebarOpen);
const isOpenAddStatus = ref(false);
const addNewtaskImage = ref("");
const taskImageFile = ref("")
const task_type_image = ref(null);
// Icon source for a new task type: 'library' (Iconify picker) or 'upload'.
const iconSource = ref('library');
const selectedIconValue = ref('');
const selectedIconColor = ref(DEFAULT_ICON_COLOR);
const showIconPicker = ref(false);
function resetIconState() {
    addNewtaskImage.value = "";
    taskImageFile.value = "";
    selectedIconValue.value = "";
    selectedIconColor.value = DEFAULT_ICON_COLOR;
    iconSource.value = 'library';
    showIconPicker.value = false;
}
const TaskStatusArray = computed(() => JSON.parse(JSON.stringify(getters["settings/AllTaskStatus"])));
const projectStatusArray = computed(() => JSON.parse(JSON.stringify(getters["settings/AllProjectStatus"])));
const taskTypeArray = computed(() => JSON.parse(JSON.stringify(getters["settings/AllTaskType"])));

const statusOptions = computed(() => {
    let arr = props.type === 'project_status' ? projectStatusArray.value.settings : props.type === 'task_type' ? taskTypeArray.value.settings : TaskStatusArray.value.settings;
    let data = arr.map((x)=>({...x,label:x.name}));
    data = data.map((x) => {
        if(checkDeletable(x) === true){
            removeKey.value.push(x.key);
        }
        const matchObj = props.options.find((firstObj) => firstObj.key === x.key)
        if (matchObj && matchObj.type) {
            return { ...x, type: matchObj.type };
        }
        return x;
    })
    return data.sort((a, b) => (a?.name || '').toLowerCase().localeCompare((b?.name || '').toLowerCase()));
});

const search = ref('');
const isSearching = ref(false);
const debouncedSearchTerm = ref('');

watch(search, () => {
    if (!search.value || search.value.length < 1) {
        debouncedSearchTerm.value = ''
        isSearching.value = false
        return
    }
    
    isSearching.value = true
    debouncerWithPromise(1000).then(() => {
        debouncedSearchTerm.value = search.value
        isSearching.value = false
    })
})

// Your existing statusOptions computed...

// Updated filtered options using debounced search
const filteredStatusOptions = computed(() => {
    if (!debouncedSearchTerm.value || debouncedSearchTerm.value.length < 1) {
        return statusOptions.value;
    }
    
    const searchTerm = debouncedSearchTerm.value.toLowerCase().trim();
    return statusOptions.value.filter(option => 
        (option.name || '').toLowerCase().includes(searchTerm) ||
        (option.label || '').toLowerCase().includes(searchTerm)
    );
});

const formData = ref({
    status: {
        value: '',
        rules:
        "required",
        name: "status",
        error: "",
    },
})

const taskSelectedStatus = ref(props.options);
// const taskStatusModel = ref('');
const removeKey = ref([1,2])

function updateItem(type, item) {
    if (type === "add") {
        if (taskSelectedStatus.value) {
            if (taskSelectedStatus.value.some((x) => x.key === item.key)) {
                return;
            }
            taskSelectedStatus.value.push(item);
            item.type = taskSelectedStatus.value.filter((x) => x.key === item.key)[0]?.type ? taskSelectedStatus.value.filter((x) => x.key === item.key)[0].type : 'active'
            emit('selected', item);
        }
    } else {
        if(taskSelectedStatus.value) {
            item.type = taskSelectedStatus.value.filter((x) => x.key === item.key)[0].type;
            if(props.isAddStatus === true && (item.key === 'default_active' || item.key === 'close')){
                return;
            }
            const value = taskSelectedStatus.value.filter((x) => x.key !== item.key);
            taskSelectedStatus.value = value;
            emit('removed', item);
        }
    }
}


function checkSelected(item) {
    if (taskSelectedStatus.value) {
        return taskSelectedStatus.value.some((x) => x.key === item.key);
    }
    return false;
}

function addTaskStatus () {
    checkAllFields(formData.value).then(async(valid) => {
        if(valid) {
            search.value = '';
            if(props.type === 'task_status'){
                isOpenAddStatus.value = false;
                let statusIndex = -1;
                statusIndex = TaskStatusArray.value.settings.findIndex((x) => x.name.toLowerCase() === formData.value.status.value.toLowerCase());
                if(statusIndex !== -1) {
                    $toast.error(t(`Toast.Status_already_exists`), {position: "top-right"});
                    return;
                }
                
                let object = {
                    'bgColor':statusColor.value + '35',
                    'isDeleted':false,
                    'name':formData.value.status.value,
                    'textColor':statusColor.value
                }
                await apiRequest("put",env.TASK_STATUS_SETTING_TEMPLATE,object).then((res) => {
                    if(res.status === 200){
                        const updatedArray = res.data;
                        commit("settings/mutateTaskStatusArray", {data: updatedArray, op: "modified"});
                        statusOptions.value = organizeDataArray(updatedArray.settings);
                        $toast.success(t(`Toast.Status_added_sucessfully`), {position: "top-right"});
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                }).catch((error) => {
                    console.error(error,"Error in updating task status");
                })
            }else if(props.type === 'project_status'){
                isOpenAddStatus.value = false;
                let statusIndex = -1;
                statusIndex = projectStatusArray.value.settings.findIndex((x) => x.name.toLowerCase() === formData.value.status.value.toLowerCase());
                if(statusIndex !== -1) {
                    $toast.error(t(`Toast.Status_already_exists`), {position: "top-right"});
                    return;
                }
                let object = {
                    'backgroundColor':statusColor.value + '35',
                    'isDeleted':false,
                    'name':formData.value.status.value,
                    'textColor':statusColor.value,
                    'value' : formData.value.status.value.toLowerCase().replaceAll(" ", "_")
                }
                await apiRequest("put",env.PROJECT_STATUS_SETTING_TEMPLATE,object).then((res) => {
                    if(res.status === 200){
                        const updatedArray = res.data;
                        commit("settings/setProjectStatusArray", {data: updatedArray, op: "modified"});
                        statusOptions.value = organizeDataArray(updatedArray.settings);
                        $toast.success(t(`Toast.Status_added_sucessfully`), {position: "top-right"});
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                }).catch((error) => {
                    console.error(error,"Error in Add STATUS");
                })
            }
            else if(props.type === 'task_type'){
                isOpenAddStatus.value = false;
                let statusIndex = -1;
                statusIndex = taskTypeArray.value.settings.findIndex((x) => x.name.toLowerCase() === formData.value.status.value.toLowerCase());
                if(statusIndex !== -1) {
                    $toast.error(t(`Toast.Task_Type_already_exists`), {position: "top-right"});
                    return;
                }
                let obj = {
                    'name': formData.value.status.value,
                    'taskCount': 0,
                    'value': formData.value.status.value.toLowerCase().replaceAll(" ",  "_"),
                    'isAddNewStatus':false,
                    'isEditable': false,
                    'isDeleted': false,
                    'assignAsSubtask': false,
                    'assignAsTask': false,
                }
                if(iconSource.value === 'library' && selectedIconValue.value){
                    // Library icon: store the Iconify name + color. taskImage keeps
                    // a fallback path so the (still-required) backend field is set
                    // and rendering degrades gracefully if iconValue is ever cleared.
                    obj.iconType = 'library';
                    obj.iconValue = selectedIconValue.value;
                    obj.iconColor = selectedIconColor.value;
                    obj.taskImage = defaultTaskType;
                }else if(taskImageFile.value!== ''){
                    obj.iconType = 'upload';
                    let name = generateFileName(taskImageFile.value.name,env.STORAGE_TYPE);
                    let filePath = `setting/task_type/${name}`;

                    const apiFormData = new FormData();
                    apiFormData.append("companyId", companyId.value);
                    apiFormData.append("path", filePath);
                    apiFormData.append("file", taskImageFile.value);
                    await apiRequestWithoutCompnay("post", storageQueryBuilder('upload').route, apiFormData, "form").then((res)=>{
                        if(res.data.status){
                            obj.taskImage = res.data.statusText;
                        }else{
                            obj.taskImage = defaultTaskType;
                        }
                    })
                }else{
                    obj.iconType = 'upload';
                    obj.taskImage = defaultTaskType;
                }
                await apiRequest("put",env.TASK_TYPE_SETTING_TEMPLATE,obj).then((res) => {
                    if(res.status === 200){
                        const updatedArray = res.data;
                        commit("settings/setTaskTypeArray", {data: updatedArray, op: "modified"});
                        statusOptions.value = organizeDataArray(updatedArray.settings);
                        resetIconState();
                        $toast.success(t(`Toast.Task_Type_added_sucessfully`), {position: "top-right"});
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
                    }
                }).catch((error) => {
                    console.error(error,"Error in Add STATUS");
                })
            }
        }
    })
}

function checkFile(e){
    const ImageDimensions = '250 x 250';
    try{
        let fileList = Array.from(e.target.files);
        if(checkBucketStorage(fileList.map(file => file?.size),{gettersVal: getters}) !== true){
            return;
        }
        const file = e.target.files[0];
        if(!file.type.includes("image")) {
            return;
        }
        var reader = new FileReader();
        reader.onload = (evt) => {
            const image = new Image();
            image.src = evt.target.result;
            image.onload = () => {
                if (image.width > 250 && image.height > 250) {
                    $toast.error(t('Toast.Image_size_must_be_less_than_ImageDimensions_pixels').replace('ImageDimensions', ImageDimensions), { position: 'top-right' });
                    task_type_image.value.value = null;
                    return;
                }else{
                    addNewtaskImage.value = evt.target.result;
                }
            } 
        }
        reader.readAsDataURL(file);
        taskImageFile.value = file;
        task_type_image.value.value = null;
    }
    catch(error){
        console.error(error);
    }
}

const checkDeletable = (value) => {
    let data = false;
    if(props.type === 'task_type'){
        if(value.default === true){
            data = true;
        }else{
            data = props.useDataArray.some(x => x.TaskTypeKey === value.key);
        }
    }else if(props.type === 'task_status') {
        data = props.useDataArray.some(x => x.statusKey === value.key);
    }else{
        data = props.useDataArray.some(x => x.key === value.key);
    }
    return data;
}

const organizeDataArray = (data) => {
    let updatedDataArray = data.map((item) => ({...item, label: item.name}));

    updatedDataArray = updatedDataArray.map((item) => {
        if (checkDeletable(item) === true) {
            removeKey.value.push(item.key);
        }
        const matchingOption = props.options.find((option) => option.key === item.key);
        if (matchingOption && matchingOption.type) {
            return { ...item, type: matchingOption.type };
        }
        return item;
    });

    return updatedDataArray.sort((a, b) => (a?.name || '').toLowerCase().localeCompare((b?.name || '').toLowerCase()))
}

</script>

<style scoped src="./style.css"></style>
<style scoped>
.tasktype__iconpop { padding: 10px 15px; border-bottom: 1px solid #eef0f6; }
.tasktype__iconpop-toggle { display: flex; gap: 6px; margin-bottom: 8px; }
.tasktype__iconpop-toggle button { flex: 1; border: 1px solid #e2e5ee; background: #fff; color: #6b7280; border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; }
.tasktype__iconpop-toggle button.active { background: #2F3990; border-color: #2F3990; color: #fff; }
</style>