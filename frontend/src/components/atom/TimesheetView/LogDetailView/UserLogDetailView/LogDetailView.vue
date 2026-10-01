<template>
<Sidebar  width="923px">
    <template #head-left>
            <div class="d-flex align-items-center">
                <UserProfile decorative
                    v-if="user.profileImage && user.profileImage != null && user.profileImage != ''"
                    :showDot="false"
                    class="timesheet_user_profile mr-10px"
                    :data="{
                        id: user.id,
                        title: user.name,
                        image: user.profileImage
                    }"
                    width="30px"
                    :thumbnail="'30x30'"
                />
                <!-- <img alt="" v-if="user.profileImage && user.profileImage != null && user.profileImage != ''"
                    :src="user.profileImage" class="timesheet_user_profile" :title="user.name"/> -->
                <img alt="" v-else src="@/assets/images/default_user.png" class="timesheet_user_profile"
                    :title="user.name"/>
                <p class="user_hrs_name">{{ user.name }}</p>
            </div>
        </template>
        <template #head-right>
            <span><img src="@/assets/images/svg/Close_screenshotview.svg" @click="closeSidebar()" class="close_icon_sidebar"/></span>
        </template>
        <template #body>
            <LogDetailViewHeaderComponent :date="dateValue"  @update:dateChange="dateChangeFunction" :total="total" :tracked="track" :manual="manual"/>
            <LogDetailViewBodyComponent :data="finalData" :isUser="isUser"/>
        </template>
</Sidebar>
</template>
<script setup>
    import {ref , onMounted , inject , computed} from "vue";
    import LogDetailViewHeaderComponent from '@/components/atom/TimesheetView/LogDetailView/LogDetailViewHeaderComponent' 
    import LogDetailViewBodyComponent from '@/components/atom/TimesheetView/LogDetailView/LogDetailViewBodyComponent'
    import * as helper from '@/components/atom/TimesheetView/LogDetailView/helper.js'
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import { useStore } from "vuex";
    import { useGetterFunctions } from "@/composable/index.js";
    import moment from "moment";
    const {getUser} = useGetterFunctions()
    const { getters } = useStore();
    const emit = defineEmits(["isSClose"])
    const userId = inject('$userId');
    const total = ref(0);
    const manual = ref(0);
    const track = ref(0);
    const isUser = ref(false);
    const projectsGetter = computed(() => getters["projectData/allProjects"]);
    const props = defineProps({
        date: {type: Date},
        userData: {type: Object},
        projectData: {type: Object},
        taskData: {type: Object},
        filterType:{
            type: String,
            default: ''
        },
        checkedFilter : {
            type : Array,
            default : ()=>([])
        }
    });
    const user = ref(props.userData);
    const finalData = ref();
    const themodelValue = ref(props.date);
    const dateValue = ref(new Date());
    const companyId = inject('$companyId');
    const projectObject = ref(props.projectData);
    const taskObject = ref(props.taskData);
    onMounted(() => {        
        dateValue.value = themodelValue.value ? themodelValue.value : new Date();
        getData(dateValue.value);
    })
    const closeSidebar = () => {
        emit("isSClose",true)
    }
    const dateChangeFunction = (val) => {
        track.value = 0;
        manual.value = 0;
        total.value = 0;
        getData(val);
    }
    const getData = (date) => {
        let s_date = new Date(new Date(date).setHours(0,0,0,0)).getTime() / 1000;
        let e_date = new Date(new Date(date).setHours(23,59,59)).getTime() / 1000;
        helper.getTimeSheetData(companyId.value,[user.value.id],s_date,e_date,props.checkedFilter && props.checkedFilter?.length && props.filterType.toLowerCase()=='projects' ? [...props.checkedFilter] : projectObject.value?._id ? projectObject.value._id : "",taskObject.value?._id ? taskObject.value._id : '' ).then((response)=>{
            prepareArray(response);
        }).catch((error)=>{
            console.error(error,"error");
        })
    }
    const prepareArray = async (data) => {
        let array = [];
        let projectName = [];
        let taskName = [];
        if (Object.keys(projectObject.value).length === 0) {
            projectName = await getProjectName(data)
            taskName = await helper.getTaskName(companyId.value,data)
        }
        if (Object.keys(projectObject.value).length !== 0 && Object.keys(taskObject.value).length === 0) {
            taskName = await helper.getTaskName(companyId.value,data)
            projectName = [{id: projectObject.value._id, name: projectObject.value.projectName, key: projectObject.value.ProjectCode}]
        }
        if (Object.keys(projectObject.value).length !== 0 && Object.keys(taskObject.value).length !== 0) {
            taskName = [{id: taskObject.value._id, name: taskObject.value.TaskName , key: taskObject.value.TaskKey , isFolderSprint: taskObject.value.folderObjId ? true : false, sprintName: taskObject.value.sprintArray.name, folderName: taskObject.value.sprintArray.folderName ? taskObject.value.sprintArray.folderName : "" }]
            projectName = [{id: projectObject.value._id, name: projectObject.value.projectName, key: projectObject.value.ProjectCode}]
            // TODO:
        }
        let newData = data.sort((a,b) => a.LogStartTime - b.LogStartTime)
        newData.forEach((dt) => {
            let trackArr = (dt.trackShots && dt.trackShots.length) ? dt.trackShots : ""
            let index = array.findIndex(x => x.ProjectId === dt.ProjectId && x.TicketID === dt.TicketID)
            let proInd = projectName.findIndex(x => x.id === dt.ProjectId)
            let taskInd = taskName.findIndex(x => x.id === dt.TicketID)
            if (proInd !== -1) {
                if (dt.logAddType == 0) {
                    manual.value = manual.value + dt.LogTimeDuration
                } else {
                    track.value = track.value + dt.LogTimeDuration
                }
                total.value = total.value + dt.LogTimeDuration
                if (index === -1) {
                    let obj = {
                        projectName: projectName[proInd]?.name,
                        ProjectId: projectName[proInd]?.id,
                        TicketID: taskName[taskInd]?.id,
                        taskName: taskName[taskInd]?.name,
                        sprintName: taskName[taskInd]?.name,
                        isFolderSprint: taskName[taskInd]?.isFolderSprint,
                        folderName: taskName[taskInd]?.folderName,
                        projectKey: projectName[proInd]?.key,
                        taskKey: taskName[taskInd]?.key,
                        total: dt.LogTimeDuration,
                        userId: dt.Loggeduser,
                        trackArray: []
                    }
                    let objecy = {
                        time: `${getTime(dt.LogStartTime)} - ${getTime(dt.LogEndTime)}`,
                        duration: dt.LogTimeDuration,
                        logAddType: dt.logAddType,
                        discription: dt.LogDescription,
                        trackShotArray: dt.logAddType == 1 ? trackArr : [],
                        startTimeTracker: dt.startTimeTracker ? dt.startTimeTracker : "",
                    }
                    obj.trackArray.push(objecy);
                    array.push(obj);
                } else {
                    array[index].total = array[index].total + dt.LogTimeDuration
                    let ob = {
                        time: `${getTime(dt.LogStartTime)} - ${getTime(dt.LogEndTime)}`,
                        duration: dt.LogTimeDuration,
                        logAddType: dt.logAddType,
                        discription: dt.LogDescription,
                        trackShotArray: dt.logAddType == 1 ? trackArr : [],
                        startTimeTracker: dt.startTimeTracker ? dt.startTimeTracker : "",
                        userId: dt.Loggeduser
                    }
                    array[index].trackArray.push(ob)
                }
            }
        })
        finalData.value = array;
    }
    const getProjectName = (array) => {
        return new Promise((resolve, reject) => {
            try {
                let uniqueArray = [...new Set(array.map((x)=>{return x.ProjectId}))]
                let Array = [];
                uniqueArray.forEach((ele)=>{
                    let ind = projectsGetter.value.data.findIndex((x) =>{return x._id == ele})
                    if (ind != -1) {
                        Array.push({id: projectsGetter.value.data[ind]._id, name: projectsGetter.value.data[ind].ProjectName, key: projectsGetter.value.data[ind].ProjectCode})
                    }
                })
                resolve(Array);
            } catch (error) {
                reject(error)
            }
        })
    }
    const getTime = (time) => {
        let userFormat = getUser(userId.value).timeFormat;
        if (userFormat == "12") {
            return moment(new Date(time * 1000)).format("hh:mm A")
        } else {
            return moment(new Date(time * 1000)).format("HH:mm")
        }
    }
</script>