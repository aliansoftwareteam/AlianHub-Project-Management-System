<template>
    <div class="duplicate__component--wrapper bg-white" :class="[{'pt-2px' : props.from === 'move'}]">
        <div class="duplicate__task-title form-group d-flex align-items-center border-bottom-mobiledrop mb-10px" :class="[{'flex-column' : clientWidth <=767}]" v-if="props.from === 'duplicate'">
            <label class="font-weight-500 dark-gray" :style="[{width : clientWidth > 767 ? ' 170px' : '100%'}]" :class="[{'mb-10px' : clientWidth <= 767, 'font-size-14' : clientWidth > 767 , 'font-size-16'  : clientWidth <= 767}]" >{{$t('DuplicateTask.duplicate_task_name')}}</label>
            <div class="input-field-group" :style="[{width : clientWidth > 767 ? 'calc(100% - 170px)' : '100%'}]">
                <InputText
                    v-model="taskName.value"
                    class="form-control login-input"
                    :placeHolder="$t('PlaceHolder.Enter_Duplicate_Task_Name')"
                    :maxLength="250"
                    :minLength="3"  
                    autocomplete="off"
                    type="text"
                    @keyup="checkErrors({'field':taskName,
                    'name':taskName.name,
                    'validations':taskName.rules,
                    'type':taskName.type,
                    'event':$event.event}),$emit('taskName',taskName.value),resetValidation()"
                />
                <div class="red font-size-12">{{taskName.error}}</div>
            </div>
        </div>
        <div class="duplicate__component--copysection border-radius-8-px">
            <h3 v-if="props.from === 'duplicate'" class="font-size-16' font-weight-500 dark-gray mb-10px" >{{$t('DuplicateTask.what_do_you_copy')}}?</h3>
            <div class="d-flex align-items-center border-bottom-serach pt-2px checkbox__wrapper" v-if="props.from === 'duplicate'" :style="[{marginBottom : clientWidth > 767 ? '13px' : '20px', paddingBottom : clientWidth > 767 ? '8px' : '20px' }]">
                <CheckboxComponent v-model="selectAll" @change="selectAllCheckboxes" />
                <span :class="[{'font-size-12 gray81' : clientWidth > 767 , 'font-size-16 dark-gray'  : clientWidth <= 767}]" class="everything__label">{{$t('DuplicateTask.everything')}}</span>
                <div class="divider"></div>
            </div>
            <div class="d-flex flex-wrap mb-5px overflow-y-auto overflow-y-auto::-webkit-scrollbar allcheckbox__component-wrapper">
                <div v-for="(option, i) in taskItemsArray" :key="i" :style="[{width : clientWidth > 576 ? '50%' : '100%'}]">
                    <div class="d-flex align-items-center"  :style="[{marginBottom : clientWidth > 767 ? '11px' : '20px'}]">
                        <CheckboxComponent v-model="option.selected" @change="selectSingleCheckbox()"/>
                        <div :class="[{'font-size-12 gray81' : clientWidth > 767 , 'font-size-16 dark-gray'  : clientWidth <= 767}]"  class="everything__label">{{option.label}}</div>
                    </div>
                </div>
            </div>
            <div class="d-flex copyassignee__watchers-wrapper" :class="clientWidth <=576 ? 'flex-column' : ''">
                <div class="divider"></div>
                <div v-for="(option, i) in taskAssigneWatcherArray" :key="i"  class="copy__assignee-checkbox position-re" :style="[{ padding: clientWidth > 767 ? '13px 0 0 0' : '13px 0', width : clientWidth <=576 ? '100%'  : '50%'}]">
                    <div class="d-flex">
                        <CheckboxComponent v-model="option.selected" @change="selectSingleCheckbox()"/>
                        <div :class="[{'font-size-12 gray81' : clientWidth > 767 , 'font-size-16 dark-gray'  : clientWidth <= 767}]"  class="everything__label-text">{{option.label}}</div>
                    </div>
                    <div class="font-size-12 gray81" v-if="option.label === 'Copy Assignees'">
                        <div class="d-flex mt-15px" v-if="assigneeArray.length > 0">
                            <UserProfile
                                v-for="user in assigneeArray.filter((x, index) => index < 1)"
                                :key="user._id"
                                :showDot="true" :data="{ image: user.profileImage,title: user.Employee_Name,isOnline: true }"
                                width="26px"
                                height="25px"
                                :thumbnail="'26x26'"
                            />
                            <DropDown v-if="assigneeArray.length > 1" mode="listbox">
                                <template #button>
                                    <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue">
                                        +{{assigneeArray.length - 1}}
                                    </div>
                                </template>
                                <template #options>
                                    <DropDownOption
                                        v-for="(user, index) in assigneeArray.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                        :key="'user'+index"
                                    >
                                    <UserProfile decorative
                                        :showDot="true"
                                        :data="{
                                            image: user.image,
                                            title: user.Employee_Name
                                        }"
                                        width="26px"
                                        height="25px"
                                        :thumbnail="'26x26'"
                                    />
                                    <span class="ml-10px">{{ user.label }}</span>
                                    </DropDownOption>
                                </template>
                            </DropDown>
                        </div>
                        <div class="d-flex mt-15px" :class="[{'font-size-12 gray81' : clientWidth > 767 , 'font-size-16 dark-gray'  : clientWidth <= 767}]" v-else>{{$t('DuplicateTask.no_assignee')}}</div>
                    </div>
                    <div v-if="option.label === 'Copy Watchers'">
                        <div class="d-flex mt-15px" v-if="watchersArray.length > 0">
                            <UserProfile
                                v-for="user in watchersArray.filter((x, index) => index < 1)"
                                :key="user._id"
                                :showDot="true" :data="{ image: user.profileImage,title: user.Employee_Name,isOnline: true}"
                                width="26px"
                                :thumbnail="'26x26'"
                                height="25px"
                            />
                            <DropDown v-if="watchersArray.length > 1" mode="listbox">
                                <template #button>
                                    <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue">
                                        +{{watchersArray.length - 1}}
                                    </div>
                                </template>
                                <template #options>
                                    <DropDownOption
                                        v-for="(user, index) in watchersArray.filter((x, index) => index >= 1).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                                        :key="'user'+index"
                                    >
                                    <UserProfile decorative
                                        :showDot="true"
                                        :data="{
                                            image: user.image,
                                            title: user.Employee_Name
                                        }"
                                        width="26px"
                                        height="25px"
                                        :thumbnail="'26x26'"
                                    />
                                    <span class="ml-10px">{{ user.label }}</span>
                                    </DropDownOption>
                                </template>
                            </DropDown>
                        </div>
                        <div class="d-flex mt-15px" :class="[{'font-size-12 gray81' : clientWidth > 767 , 'font-size-16 dark-gray'  : clientWidth <= 767}]" v-else>{{$t('DuplicateTask.no_watcher')}}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import CheckboxComponent from '@/components/atom/Checkbox/CheckboxComponent.vue';
import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
import DropDown from '@/components/molecules/DropDown/DropDown.vue'
import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
import InputText from "@/components/atom/InputText/InputText.vue";
import { ref, defineEmits, defineProps, watch, onMounted, inject, computed  } from 'vue';
import { useI18n } from "vue-i18n";
import { useValidation } from "@/composable/Validation";
const  { checkErrors  } = useValidation();
import { useStore } from 'vuex';
const emit = defineEmits(["selctedItems","watcher","assignee","taskName"]);
const { getters } = useStore();
const { t } = useI18n();
const props = defineProps({
    task: {
        type: Object,
    },
    selectedProjectData : {
        type : Object
    },
    from : {
        type : String
    },
    selectedSprint : {
        type : Object
    },
})
const selectedProject = ref(props.selectedProjectData);
const selectedSprintData = ref(props.selectedSprint);
const clientWidth = inject("$clientWidth");
const assigneeArray = ref([]);
const watchersArray = ref([]);
const taskName = ref({
    value: "",
    rules:
    "min: 3",
    name: "name",
    error: "",
});

const defaultUserIcon = inject("$defaultUserAvatar");

watch(() => props.selectedProjectData, (val) => {
    selectedProject.value = val;
    getAssignes();
    getWatchers();
})
watch(() => props.selectedSprint, (val) => {
    selectedSprintData.value = val;
    getAssignes();
    getWatchers();
})
onMounted(() => {
    getAssignes();
    getWatchers();
})
const usersData = computed(() => getters["users/users"]);
const getAssignes = (() => {
    let assigneArray = selectedProject.value.AssigneeUserId || [];
    let sortedAssignee = props.task.AssigneeUserId.length > 0 ? selectedProject.value.isPrivateSpace == true ? assigneArray.filter((x) => props.task.AssigneeUserId.includes(x)) : props.task.AssigneeUserId : [];
    let tempTaskAssigne = Object.keys(props.task).length > 0 ? sortedAssignee : [];

    if(selectedSprintData.value.private === true){
        tempTaskAssigne = tempTaskAssigne.filter((x) => selectedSprintData.value.AssigneeUserId.includes(x))
    }

    let ids = [];
    if(Object.keys(usersData.value).length && usersData.value && usersData.value.length > 0){
        let tempArray = [];
        usersData.value.map((item)=> {
            if(tempTaskAssigne.includes(item._id)){
                tempArray.push({...item,'profileImage':item.Employee_profileImageURL ? item.Employee_profileImageURL : defaultUserIcon});
                ids.push(item._id)
            }
        })
        assigneeArray.value = tempArray;
    }
    emit('assignee',ids)
    return assigneeArray.value;
})

const getWatchers = (() => {
    let sortedWatchers = props.task.watchers && props.task.watchers.length > 0 ? selectedProject.value.isPrivateSpace == true ? selectedProject.value.AssigneeUserId?.filter((x) => props.task.watchers.includes(x)) : props.task.watchers : [];
    let tempTaskAssigne = Object.keys(props.task).length > 0 ? sortedWatchers : [];
    if(selectedSprintData.value.private === true){
        tempTaskAssigne = tempTaskAssigne.filter((x) => selectedSprintData.value.watchers?.includes(x))
    }

    let assigneArray = tempTaskAssigne;

    let ids = []
    if(Object.keys(usersData.value).length && usersData.value && usersData.value.length > 0){
        let tempArray = [];
        usersData.value.map((item) => {
            if(assigneArray.includes(item._id)){
                tempArray.push({...item,'profileImage':item.Employee_profileImageURL ? item.Employee_profileImageURL : defaultUserIcon});
                ids.push(item._id)
            }
        })
        watchersArray.value = tempArray;
    }
    emit('watcher',ids)
    return watchersArray.value;
})

const taskItemsArray = ref([
    { label: t('ViewList.Activity'), selected: false,name:'Activity'},
    { label: t('Attachments.attachments'), selected: false,name:'Attachments'},
    { label: t('ViewList.Comments'), selected: false,name:'Comments' },
    { label: t('Home.Due_Date'), selected: false,name:'Due Date' },
    { label: t('Checklist.Checklists'), selected: false,name:'Checklists' },
]);
const taskAssigneWatcherArray = ref([
    { label: t('general.Copy_Assignees'), selected: false,name:'Copy Assignees' },
    { label: t('general.Copy_Watchers'), selected: false,name:'Copy Watchers' },
])

if (props.from === 'move') {
    taskItemsArray.value = [{ label: 'Move comments as well', selected: false }];
}
const selectAll = ref(false);
const selectedItems = ref([]);

const selectSingleCheckbox =  () => {
    let mergeArray = taskItemsArray.value.concat(taskAssigneWatcherArray.value);
    selectAll.value = mergeArray.every(item => item.selected);
    selectedItems.value = mergeArray.filter(item => item.selected).map(item => item.name);
    emit('selctedItems',selectedItems.value);
}

const selectAllCheckboxes = () => {
    taskItemsArray.value.forEach(item => item.selected = selectAll.value);
    taskAssigneWatcherArray.value.forEach(item => item.selected = selectAll.value);
    selectSingleCheckbox();
    if (!selectAll.value) {
        selectedItems.value = [];
    }
    emit('selctedItems',selectedItems.value);
}

function resetValidation () {
    if(taskName.value.value === ''){
        taskName.value.error = ''
    }
}
</script>

<style scoped src="./style.css"></style>