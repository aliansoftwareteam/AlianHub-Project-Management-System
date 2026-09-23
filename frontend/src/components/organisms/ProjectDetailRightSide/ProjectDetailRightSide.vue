<template>
    <div class="projectRightside overflow-y-auto style-scroll">
        <div :class="{'border-bottom-mobiledrop' : clientWidth > 767}" :style="[{paddingBottom : clientWidth > 767 ? '5px' : '0px'}]" v-if="checkPermission('project.project_details',projectData?.isGlobalPermission)!== null">
            <h4 class="black font-roboto-sans detailsHead" :class="`${clientWidth > 767 ? 'font-size-14 font-weight-700' : 'font-size-16 font-weight-600'}`">{{$t('ProjectDetails.details')}}</h4>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_status_change',projectData?.isGlobalPermission)!== null">
                <h4 :class="{'font-size-14 font-weight-500 status__title' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.status')}}</h4>
                <ProjectStatus
                    class="d-flex nohover__project-rightside d-inline-block text-ellipsis"
                    :projectKey="projectData.status"
                    @update:projectstatus="(val,val1) => updateStatus(val1)"
                />
            </div>
             <!-- v-if="checkPermission('project.project_status_change',projectData?.isGlobalPermission)!== null" -->
            <div class="d-flex project-right-side-label" v-if="projectData?.projectCreatedBy">
                <h4 :class="{'font-size-14 font-weight-500 status__title' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('Comment.created_by')}}</h4>
                <UserProfile
                    :showDot="false"
                    class="user__profile cursor-pointer mr-10px"
                    :data="{
                        id: createdByUser?._id,
                        image: createdByUser?.Employee_profileImage,
                        title: createdByUser?.Employee_Name
                    }"
                    width="30px"
                    :thumbnail="'30x30'"
                />
                <span 
                    class="black project-type-name text-ellipsis project-created-by"
                    :class="{'font-size-13 font-weight-400' : clientWidth > 767, 'font-size-16' : clientWidth <=767}"
                    :title="createdByUser?.Employee_Name || 'N/A'">
                    {{ createdByUser?.Employee_Name || 'N/A' }}
                </span>
            </div>
            <div class="d-flex project-right-side-label" v-if="projectData?.isPrivateSpace && checkPermission('project.project_assignee',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500 status__title' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.assignee')}}</h4>
                <Assignee
                    class="nohover__project-rightside ml-5px"
                    :numOfUsers="2"
                    imageWidth="30px"
                    :showAddUser="true"
                    :users="projectData.AssigneeUserId"
                    :addUser="checkPermission('project.project_assignee',projectData?.isGlobalPermission) === true"
                    :options="[...users.map((x) => x._id), ...teams.map((x) => 'tId_'+x._id)]"
                    @selected="updateAssignee('add', $event)"
                    @removed="updateAssignee('remove', $event)"
                />
            </div>
            <div class="d-flex project-right-side-label">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.key')}}</h4>
                <span class="black projectKeyClass hover__on-projectrightside text-ellipsis cursor-default" :class="{'font-size-13 font-weight-400' : clientWidth > 767 ,'font-size-16' : clientWidth <=767}"
                    :style="[{padding : clientWidth > 767 ? '10px 10px 10px 0' : '10px 0px'}]"
                    :title="projectData.ProjectCode"
                >{{projectData.ProjectCode ? projectData.ProjectCode : 'N/A'}}</span>
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_type',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.type')}}</h4>
                <ProjectType
                    class="hover__on-projectrightside text-ellipsis"
                    :projectData="projectData"
                    @selected="updateType($event)"
                />
            </div>
            <div class="d-flex project-right-side-label" v-if="projectData.ProjectType === 'Hourly'">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.billing_period')}}</h4>
                <BillingPeriod :projectData="projectData" @selected="updateBillingPeriod($event)" class="hover__on-projectrightside text-ellipsis"/>
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_currency',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.currency')}}</h4>
                <Currency :projectData="projectData" @selected="updateCurrency($event)"  class="hover__on-projectrightside text-ellipsis" />
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_amount',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.amount')}}</h4>
                <span class="black project-amount cursor-pointer  hover__on-projectrightside text-ellipsis" :class="{'font-size-13 font-weight-400' : clientWidth > 767 ,'font-size-16' : clientWidth <=767}"
                :style="[{padding : clientWidth > 767 ? '2px' : '10px 0px'}]" :title="projectData?.ProjectCurrency?.symbol + ' ' + (projectData.milestoneAmount ? getCommaSeperatedNumber(projectData.milestoneAmount) : 0) ">{{projectData?.ProjectCurrency?.symbol}} {{projectData.milestoneAmount ? getCommaSeperatedNumber(projectData.milestoneAmount) : 0}}</span>
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_source',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.source')}}</h4>
                <ProjectSourceSelect
                    class="hover__on-projectrightside"
                    mode="inline"
                    :modelValue="projectSource"
                    :editable="checkPermission('project.project_source',projectData?.isGlobalPermission) === true"
                    @changed="updateSource"
                />
            </div>
            <div class="d-flex project-right-side-label">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">
                    {{$t('ProjectDetails.proposal_id')}}<span class="text-red asterisk" v-if="isUpworkSource">*</span>
                </h4>
                <InputText
                    v-if="proposalIdEditable"
                    class="hover__on-projectrightside--input box-sizing-box font-size-13 font-weight-400"
                    inputId="project-proposal-id"
                    height="36px"
                    width="calc(100% - 38%)"
                    :isDirectFocus="true"
                    :maxLength="100"
                    :placeHolder="$t('PlaceHolder.Enter_Proposal_Id')"
                    :title="proposalIdHint"
                    v-model.trim="proposalIdValue"
                    @blur="updateProposalId"
                    @enter="updateProposalId"
                />
                <span v-else
                    class="black projectKeyClass hover__on-projectrightside text-ellipsis"
                    :class="[{'font-size-13 font-weight-400' : clientWidth > 767 ,'font-size-16' : clientWidth <=767}, canEditDetails ? 'cursor-pointer' : 'cursor-default']"
                    :style="[{padding : clientWidth > 767 ? '10px 10px 10px 0' : '10px 0px'}]"
                    :title="projectData.proposalId || proposalIdHint"
                    @click="editProposalId()"
                >{{projectData.proposalId ? projectData.proposalId : 'N/A'}}</span>
            </div>
            <div class="d-flex project-right-side-label">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.skills')}}</h4>
                <SkillsSelect
                    class="hover__on-projectrightside"
                    :modelValue="projectData.skills || []"
                    :editable="canEditDetails"
                    @update:modelValue="updateSkills"
                />
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_start_date',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.start_date')}}</h4>
                <StartEndDate
                    v-if="checkPermission('project.project_start_date',projectData?.isGlobalPermission) === true"
                    class="hover__on-projectrightside text-ellipsis"
                    id="start-date-project"
                    :displyDate="projectData.StartDate"
                    :isShowDateAndicon="true"
                    :minDate="''"
                    :maxDate="projectData.EndDate ? projectData.EndDate.seconds ? new Date(projectData.EndDate.seconds * 1000) : new Date(projectData.EndDate) : ''"
                    :calenderImage="false"
                    :InputDesign="false"
                    @SelectedDate="updateStartDate"
                    :startDateChanges="startDateWarning"
                    :position="`right`"
                ></StartEndDate>
                <template v-else>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-if="projectData.StartDate">{{convertDateFormat(projectData.StartDate)}}</span>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-else>{{$t('ProjectDetails.no_start_date')}}</span>
                </template>
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_end_date',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767 ,'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('ProjectDetails.end_date')}}</h4>
                <StartEndDate
                    v-if="checkPermission('project.project_end_date',projectData?.isGlobalPermission) === true"
                    class="hover__on-projectrightside text-ellipsis"
                    id="end-date-project"
                    :displyDate="projectData.EndDate? projectData.EndDate : ''"
                    :isShowDateAndicon="true"
                    :minDate="projectData.StartDate ? projectData.StartDate.seconds ? new Date(projectData.StartDate.seconds * 1000) : new Date(projectData.StartDate) : ''"
                    :maxDate="''"
                    :calenderImage="false"
                    :InputDesign="false"
                    @SelectedDate="updateEndDate"
                    :position="`right`"
                ></StartEndDate>
                <template v-else>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-if="projectData.EndDate">{{convertDateFormat(projectData.EndDate)}}</span>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-else>{{$t('ProjectDetails.no_end_date')}}</span>
                </template>
            </div>
            <div class="d-flex project-right-side-label" v-if="checkPermission('project.project_due_date',projectData?.isGlobalPermission) !== null">
                <h4 :class="{'font-size-14 font-weight-500' : clientWidth > 767, 'font-size-16 font-weight-400' : clientWidth <=767}">{{$t('Projects.due_date')}}</h4>
                <DueDateCompo
                    v-if="checkPermission('project.project_due_date',projectData?.isGlobalPermission) === true"
                    class="hover__on-projectrightside text-ellipsis"
                    id="due-date-project"
                    :displyDate="projectData.DueDate ? projectData.DueDate : ''"
                    :isShowDateAndicon="true"
                    @SelectedDate="updateDueDate"
                    :position="`right`"
                />
                <template v-else>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-if="projectData.DueDate">{{convertDateFormat(projectData.DueDate)}}</span>
                    <span class="font-size-13 font-weight-400 black hover__on-projectrightside" v-else>{{$t('ProjectDetails.no_due_date')}}</span>
                </template>
            </div>
        </div>
        <div class="position-re" v-if="checkPermission('project.project_custom_field',projectData?.isGlobalPermission) !== null">
            <!-- App enabled for this project: existing behavior (feature, or blurred feature + upgrade overlay when the plan doesn't include it). -->
            <div v-if="checkApps('CustomFields')">
                <div v-if="projectData" :class="[{'pointer-event-none opacity-5 blur-3-px':!currentCompany?.planFeature?.customFields}]">
                    <CustomFieldProjectDetailView
                        @blurUpdate="submitHandler"
                        @editCustomField="editCustomField"
                        :projectDetail="props.projectData"
                        @isCustomField="isCustomField = true"
                        :editPermission="checkPermission('project.project_custom_field',projectData?.isGlobalPermission)"
                        :planPermission="currentCompany?.planFeature?.customFields"
                    />
                </div>
                <div v-if="!currentCompany?.planFeature?.customFields">
                    <UpgradePlan
                        :isImage="false"
                        :buttonText="$t('Upgrades.upgrade_your_plan')"
                        :lastTitle="$t('Upgrades.unlock_custom_field')"
                        :secondTitle="$t('Upgrades.unlimited')"
                        :firstTitle="$t('Upgrades.upgrade_to')"
                        :message="$t('Upgrades.the_feature_not_available')"
                    />
                </div>
            </div>
            <!-- App available on the plan but not switched on for this project: representational teaser. -->
            <AppTeaserBlock
                v-else-if="getAppState('CustomFields', projectData) === 'disabled'"
                appKey="CustomFields"
            />
        </div>
        <ConfirmModal :modelValue="showConfirmModal" :acceptButtonText="$t('Home.Confirm')"
                    :cancelButtonText="$t('Projects.cancel')" maxlength="150" :header="false" :showCloseIcon="false" @close="showConfirmModal = false">
            <template #body>
                <div class="text-center">
                    <div>
                        <img class="warning__yellow-img" src="@/assets/images/gif/warning-yellow.gif" alt="warning">
                    </div>
                    <span>{{$t('ProjectDetails.startdatemsg0')}} <br> {{$t('ProjectDetails.startdatemsg1')}}</span>
                </div>
            </template>
            <template #footer>
                <div class="text-right">
                    <button class="btn-primary p0x-15px" @click="showConfirmModal = false">ok</button>
                </div>
            </template>
        </ConfirmModal>
        <CustomFieldsSidebarComponent
            @customFieldStore="customFieldStore"
            @closeSidebar="handleCloseSidebar"
            :componentDetail="componentDetail && Object.keys(componentDetail).length ? componentDetail : {}"
            :customFieldObject="componentDetail && Object.keys(componentDetail).length ? customFieldObject : {}"
            :isCustomField="isCustomField"
            @handleClose="handleClose()"
        />
    </div>
</template>

<script setup>
import { useStore } from 'vuex';
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
import { apiRequest } from '@/services';
import { useToast } from 'vue-toast-notification';
import ConfirmModal from '@/components/atom/Modal/Modal.vue';
import Currency from '@/components/atom/Currency/Currency.vue';
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import ProjectType from '@/components/atom/ProjectType/ProjectType.vue';
import BillingPeriod from '@/components/atom/BillingPeriod/BillingPeriod.vue';
import { defineProps , inject ,computed,ref,nextTick,defineEmits } from 'vue';
import DueDateCompo from '@/components/molecules/DueDateCompo/DueDateCompo.vue';
import ProjectStatus from '@/components/molecules/ProjectStatus/ProjectStatus.vue'
import { useConvertDate, useCustomComposable, useGetterFunctions } from '@/composable';
import StartEndDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import AppTeaserBlock from '@/components/molecules/AppTeaserBlock/AppTeaserBlock.vue';
import UserProfile from '@/components/atom/UserProfile/UserProfile.vue';
import InputText from '@/components/atom/InputText/InputText.vue';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import ProjectSourceSelect from '@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue';
import { DEFAULT_SOURCE, checkProposalId, cleanProposalId } from '@/utils/projectSource';

const { checkPermission,checkApps,getAppState } = useCustomComposable();
const {convertDateFormat} = useConvertDate();

const { t } = useI18n();
const $toast = useToast();
const {getters,commit} = useStore();

//props
const props = defineProps({
    projectData: {
        type: Object,
    },
});

const {getUser} = useGetterFunctions();

// emit
const emit = defineEmits(['rightSideBarEmit','startDateChanges','description'])

// inject
const userId = inject('$userId');
const companyId = inject('$companyId');
const clientWidth = inject("$clientWidth");

//ref
const submitted = ref(false);
const componentDetail = ref({});
const isCustomField = ref(false);
const startDateWarning = ref('');
const customFieldObject = ref({});
const sourceEditable = ref(false);
const showConfirmModal = ref(false);
const CustomFieldData = ref(JSON.parse(JSON.stringify(getters["settings/customFields"])));
const proposalIdValue = ref('');
const proposalIdEditable = ref(false);

//computed
const users = computed(() => getters["users/users"]);
const teams = computed(() => getters["settings/teams"]);
// Projects created before the field exists read as the default rather than blank.
const projectSource = computed(() => props.projectData?.source || DEFAULT_SOURCE);
const isUpworkSource = computed(() => projectSource.value === 'upwork');
// Shown on hover instead of a hint row: this panel's rows are fixed-height, so an
// extra line would push into the field below it.
const proposalIdHint = computed(() => (isUpworkSource.value ? t('Projects.proposal_id_format_hint') : ''));
const currentCompany = computed(() => getters["settings/selectedCompany"]);
const showCustomField = computed(() => checkPermission("project.project_custom_field", props?.projectData?.isGlobalPermission, {gettersVal: getters}));
const canEditDetails = computed(() => checkPermission('project.project_details', props?.projectData?.isGlobalPermission) === true);

//user detail
const createdByUser = getUser(props?.projectData?.projectCreatedBy || '');

// convert the number into us formate 
const getCommaSeperatedNumber = (n)=> {
    let numVal = Number(n)
    return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
};

// project status update
const updateStatus = (newval) => {
    const object = {
        updateObject : {
            status: newval.value,
            statusType : newval.type
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Status Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the assignee in project
const updateAssignee = (type, user) => {
    const object = type === "add"
        ? { key: "$addToSet", updateObject: { AssigneeUserId: user.id } }
        : {
            key: "$pull",
            updateObject: {
                AssigneeUserId: user.id,
                ...(props.projectData.LeadUserId.includes(user.id) && { LeadUserId: user.id })
            }
        };

    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t(`Toast.Assignee ${type === "add" ? 'added' : 'removed'} successfully`),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData},projectId:props.projectData._id,key:'AssigneeChange',subKey: type === 'add' ? 'add' : 'remove',userId: user.id});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((error)=>{
        console.error("ERROR in update project assignee: ", error);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the type of project
const updateType = (type) => {
    let object = {
        updateObject : {
            ProjectType: type.label,...((type.label === 'Hourly' && !props.projectData.BillingPeriod) && {BillingPeriod: "Monthly" })
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            emit('rightSideBarEmit','projectType',object);
            sourceEditable.value = false;
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Source Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the currency of project
const updateCurrency = (currency) => {
    if (props.projectData && props.projectData.ProjectCurrency) {
        if (currency.code !== props.projectData.ProjectCurrency.code) {
            let object = {
                updateObject:{
                    "count": -1
                },
                key:'$inc'
            };
            apiRequest("put",`${env.CURRENCY}/${companyId.value}/${props.projectData.ProjectCurrency._id}`,object).then(() => {
                commit("settings/setCurrencyArray", {data:{_id:props.projectData.ProjectCurrency._id},op:'modified',countType:'decrement'});
            })
            .catch((err)=>{
                console.error(err,"Error in updateCurrency");
            })
            let objectIncre = {
                updateObject:{
                    "count": 1
                },
                key:'$inc'
            };
            apiRequest("put",`${env.CURRENCY}/${companyId.value}/${currency._id}`,objectIncre).then(() => {
                commit("settings/setCurrencyArray", {data:{_id:currency._id},op:'modified',countType:'increment'});
            })
            .catch((err)=>{
                console.error(err,"Error in updateCurrency");
            });
        }
    }

    let object = {
        updateObject : {
            ProjectCurrency: currency
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            emit('rightSideBarEmit','currency',currency);
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Source Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the duedate of project
const updateDueDate = (event) => {
    let newdueDateDeadLine = [];
    if(props.projectData.dueDateDeadLine && props.projectData.dueDateDeadLine.length > 0) {
        props.projectData.dueDateDeadLine.forEach((date) => {
            newdueDateDeadLine.push({ date: new Date(date.date) })
        })
        newdueDateDeadLine.push({ date: new Date(event.dateVal)});
    } else {
        newdueDateDeadLine.push({ date: new Date(event.dateVal)});
    }

    const object = {
        updateObject : {
            DueDate: event.dateVal,
            dueDateDeadLine: newdueDateDeadLine,
        },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Due Date Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the startdate of project
const updateStartDate = (event) => {
    const object = {
        updateObject : {
            StartDate: event.dateVal
        },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    if(props.projectData.ProjectType === 'Hourly'){
        let getStartDate = new Date(event.dateVal).getTime()
        apiRequest("get",`${env.MILESTONE_PROJECT}/${props.projectData._id}`).then((result) => {
            const res = result?.data;
            if(result.status === 200 && res && res.length){
                let smallestValue = res.reduce((min, obj) => obj.startDate < min ? obj.startDate : min, res[0].startDate);
                let smallest = new Date(smallestValue)
                let currentMonthEnd = null;
                if(props.projectData.BillingPeriod === "Weekly"){
                    currentMonthEnd = new Date(smallest).getTime();
                }else{
                    currentMonthEnd = new Date(smallest.getFullYear(),smallest.getMonth() + 1,1).getTime();
                }
                if(currentMonthEnd < getStartDate){
                    showConfirmModal.value = true;
                    emit('startDateChanges',props.projectData.StartDate)
                    startDateWarning.value = props.projectData.StartDate
                    return;
                }else{
                    commonStartDateUpdateFun(event,object);
                }
            }else{
                commonStartDateUpdateFun(event,object);
            }
        }).catch((err)=>{
            console.error("ERROR",err)
            commonStartDateUpdateFun(event,object);
        });
    }else{
        commonStartDateUpdateFun(event,object);
    }
}

const commonStartDateUpdateFun = (event,object) =>{
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((response) => {
        if(response.status === 200){
            emit('rightSideBarEmit','startDate', event.dateVal);
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }).catch((err)=>{
        console.error(err,"Error in Project End Date Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    });
}

// update the enddate of project
const updateEndDate = (event) => {
    const object = {
        updateObject : {
            EndDate: event.dateVal
        },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project End Date Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the billing period of project
const updateBillingPeriod = (event) => {
    let object = {
        updateObject : {
            BillingPeriod: event.label
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            emit('rightSideBarEmit','billingPeriod',event.label);
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Billing Period Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// open the proposal id for inline editing
const editProposalId = () => {
    if(!canEditDetails.value) return;
    proposalIdValue.value = props.projectData.proposalId || '';
    proposalIdEditable.value = true;
}

// update the source of project
const updateSource = (source) => {
    // Switching to Upwork needs a proposal id first — the server rejects it
    // anyway, so stop here and say which field to fill rather than round-trip
    // to a 400. The row keeps showing the old source because local state is
    // only updated on success.
    if(source === 'upwork' && !(props.projectData.proposalId || '').trim()){
        $toast.error(t('Projects.proposal_id_required_upwork'), { position: 'top-right' });
        return;
    }
    const object = { updateObject: { source } }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        // The server refuses Upwork without a proposal id — surface that reason
        // rather than a generic failure, since it tells the user what to do.
        const message = err?.response?.data?.message;
        console.error(err,"Error in Project Source Update");
        $toast.error(message || t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the proposal id of project
const updateProposalId = ({value}) => {
    proposalIdEditable.value = false;
    // Sanitize on commit rather than per keystroke: a pasted proposal URL becomes
    // the bare id, and the trailing slash goes. Rewriting mid-typing would fight
    // the cursor. The server applies the same rule, so this is what the user sees
    // being saved, not a second source of truth.
    const newValue = cleanProposalId(value);
    proposalIdValue.value = newValue;
    // blur fires on every exit, so skip the round trip when nothing changed
    if(newValue === (props.projectData.proposalId || '')) return;
    if(isUpworkSource.value && !newValue){
        $toast.error(t('Projects.proposal_id_required_upwork'), { position: 'top-right' });
        return;
    }
    if(checkProposalId(projectSource.value, newValue) === 'format'){
        $toast.warning(t('Projects.proposal_id_format_warning'), { position: 'top-right' });
    }
    let object = {
        updateObject : {
            proposalId: newValue
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Proposal ID Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// update the required skills of project
const updateSkills = (slugs) => {
    const object = {
        updateObject : {
            skills: slugs
        }
    }
    apiRequest("put",`${env.PROJECT}/${props.projectData._id}`,object).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Updated_successfully'),{position: 'top-right'});
            commit('projectData/projectLocalUpdate', {itemData:  {...props.projectData , ...object.updateObject}});
        }else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    })
    .catch((err)=>{
        console.error(err,"Error in Project Skills Update");
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    })
}

// custom field
const submitHandler = async (value,detail,id,edit) => {
    if(showCustomField.value === true){
        if(value && detail.fieldType !== 'checkbox'){
            if(detail.fieldType === 'date'){
                try{
                    detail.fieldValue = new Date(value);
                    insertCustomField(detail);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'dropdown'){
                detail.fieldValue = [value.id];
                try {
                    insertCustomField(detail);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else if(detail.fieldType === 'number' || detail.fieldType === 'money'){
                try{
                    detail.fieldValue = String(value);
                    insertCustomField(detail);
                } catch(error){
                    console.error('ERROR',error);
                }
            }else{
                nextTick(() => {
                    const input = document.getElementById(`${id}`);
                    const ariaDescribedByValue = input.getAttribute('aria-describedby');
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
                            insertCustomField(detail);
                        } catch(error){
                            console.error('ERROR',error);
                        }
                    }
                });
            }
        } else if(detail.fieldType === 'checkbox'){
            try{
                detail.fieldValue = value;
                insertCustomField(detail);
            } catch(error){
                console.error('ERROR',error);
            }
        }
    }
};

// insert or update the value of custom field in the project
const insertCustomField = async(detail) => {
    let updateDetail = {};
    updateDetail.fieldValue = detail.fieldValue;
    if(detail.fieldType === "phone"){
        updateDetail.fieldCode = detail?.fieldCode;
        updateDetail.fieldPattern = detail?.fieldPattern;
        updateDetail.fieldFlag = detail?.fieldFlag;
    }
    updateDetail._id = detail._id;  

    await apiRequest("put",`/api/v1/${env.PROJECTACTIONS}/${props.projectData._id}`,{updateObject: { [`customField.${detail._id}`]: updateDetail }}).then((res) => {
        if(res.status === 200){
            $toast.success(t('Toast.Custom_field_updated_successfully'), {position: 'top-right' });
            const localUpdateCustomfield = props.projectData
            localUpdateCustomfield.customField = {
                ...localUpdateCustomfield.customField,
                [updateDetail._id]:{
                    ...updateDetail
                }
            }
            commit('projectData/projectLocalUpdate', {itemData:  {...localUpdateCustomfield}});
        } else{
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
        submitted.value = true
    }).catch((err)=>{
        console.error('ERROR',err);
        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
    });
};

// add the new custom field or edit the custom field
const customFieldStore = async(object,isEdit) => {    
    let value = JSON.parse(JSON.stringify(object))
    if(!isEdit){       
        value.global = false;
        value.projectId = [props.projectData._id];
        value.createdAt = new Date();
        value.updatedAt = new Date();
        value.userId = userId.value;
        value.type = 'project';
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
            isCustomField.value = false;
            componentDetail.value={};
            customFieldObject.value={};
        }).catch((err)=>{
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            console.error("Error inserting the custom field",err)
        });
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
                commit("settings/mutateFinalCustomFields", {data: {...customFieldObject.value,...value} || {},op: "modified"});
                $toast.success(t('Toast.Field_Updated_Successfully'), {position: 'top-right' })
            }else{
                $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
            }
            isCustomField.value = false;
            componentDetail.value={};
            customFieldObject.value={};
        }).catch((err)=>{
            console.error("Error in updating the custom field",err);
            $toast.error(t('Toast.something_went_wrong'), {position: 'top-right' });
        });
    }
};

// close sidebar for the custom field
const handleCloseSidebar = (val,pageIndex) => {
    if(pageIndex === 0) isCustomField.value = val;
    componentDetail.value={};
    customFieldObject.value={};
};

// assigne the custom field value for the edit in sidebar
const editCustomField = (val) => {
    if(showCustomField.value === true && currentCompany.value?.planFeature?.customFields === true){
        componentDetail.value = CustomFieldData.value.find((x)=> x.cfType === val.fieldType);
        customFieldObject.value = val;
        if(componentDetail.value && Object.keys(componentDetail.value).length){
            isCustomField.value = true;
        }
    }
};

// colse sidebar for the custom field
const handleClose = () => {
    isCustomField.value = false;
    componentDetail.value = {};
    customFieldObject.value = {};
};

</script>
<style src='./style.css'>
</style>
