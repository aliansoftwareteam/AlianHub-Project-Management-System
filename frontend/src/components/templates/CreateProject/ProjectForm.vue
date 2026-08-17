<!-- =========================================================================================
    Created By : Dipsha Kalariya
    Commnet : This component is used to display project bacis detail for blank project form as step-1 in create project module.
========================================================================================== -->
<template>
<div>
    <div class="createprojectContent whitebodyContent_v2">
        <div class="form-group d-flex align-items-center" id="createprojectname_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('ProjectSlider.project_name') }}<span class="text-red asterisk">*</span></label>
            <div class="input-field-group">
                <InputText
                    class="form-control login-input text-capitalize"
                    :placeHolder="$t('PlaceHolder.Enter_Project_Name')"
                    autocomplete="off"
                    v-model.trim="theModel.projectName.value"
                    @keyup="gererateProjectKey(theModel.projectName),isUniqueProjectKey(theModel.projectCode.value),checkErrors({'field':theModel.projectName,
                    'name':theModel.projectName.name,
                    'validations':theModel.projectName.rules,
                    'type':theModel.projectName.type,
                    'event':$event.event}),checkErrors({'field':theModel.projectCode,
                    'name':theModel.projectCode.name,
                    'validations':theModel.projectCode.rules,
                    'type':theModel.projectCode.type,
                    'event':$event.event})"
                    maxlength="100"
                    type="text"
                />
                <div class="text-red">{{theModel.projectName.error}}</div>
            </div>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectkey_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('ProjectDetails.key') }}<span class="text-red asterisk">*</span></label>
            <div class="input-field-group">
                <InputText
                    class="form-control login-input text-capitalize"
                    :placeHolder="$t('PlaceHolder.Enter_Key_Name')"
                    autocomplete="off"
                    v-model.trim="theModel.projectCode.value"
                    @keyup="isUniqueProjectKey(theModel.projectCode.value), convertToUpperCase('projectKey'),checkErrors({'field':theModel.projectCode,
                    'name':theModel.projectCode.name,
                    'validations':theModel.projectCode.rules,
                    'type':theModel.projectCode.type,
                    'event':$event.event})"
                    @keypress="removeSpecialCharacter(), convertToUpperCase('projectKey')"
                    type="text"
                />
                <div class="text-red">{{theModel.projectCode.error}}</div>
                <div class="text-red" v-if="theModel.projectCode.isUniqueProjectCode !== ''">{{$t('PlaceHolder.' + theModel.projectCode.isUniqueProjectCode)}}</div>
            </div>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectsource_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('ProjectDetails.source') }}<span class="text-red asterisk">*</span></label>
            <div class="input-field-group">
                <ProjectSourceSelect v-model="theModel.source.value" @changed="onSourceChange"/>
                <div class="text-red">{{theModel.source.error}}</div>
            </div>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectproposalid_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >
                {{ $t('ProjectDetails.proposal_id') }}<span class="text-red asterisk" v-if="isUpwork(theModel.source.value)">*</span>
            </label>
            <div class="input-field-group">
                <InputText
                    class="form-control login-input"
                    :placeHolder="$t('PlaceHolder.Enter_Proposal_Id')"
                    autocomplete="off"
                    v-model.trim="theModel.proposalId.value"
                    @keyup="onProposalIdChange()"
                    maxlength="100"
                    type="text"
                />
                <div class="font-size-12 gray81" v-if="isUpwork(theModel.source.value)">{{ $t('Projects.proposal_id_format_hint') }}</div>
                <div class="text-red">{{theModel.proposalId.error}}</div>
            </div>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectskills_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('ProjectDetails.skills') }}</label>
            <div class="input-field-group">
                <SkillsSelect v-model="theModel.skills.value" :bordered="true" :showAll="true" @changed="syncModel()"/>
            </div>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectduedate_driver">
            <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('Projects.due_date') }}</label>
            <VueDatePicker class="text-capitalize" :placeholder="$t('PlaceHolder.Select_Project_Due_Date')" v-model="theModel.dueDate.value" @input="updateDueDate(event)" auto-apply  :close-on-auto-apply="true" :min-date="new Date()" :enable-time-picker="false"/>
        </div>
        <div class="form-group d-flex align-items-center" id="createprojectleadassignee_driver">
            <div class="labelDetail leadMain d-flex align-items-center">
                <label :class="{'taskstatustitle-desktop': clientWidth > 767 , 'taskstatustitle-mobile': clientWidth <= 767}" >{{ $t('ProjectDetails.lead') }}</label>
                <ul class="d-flex">
                    <li class="addIcon ml-0px">
                        <Assignee
                            :users="theModel.leadUser.value.map((x)=>x.id)"
                            :options="users.map((x) => x._id)"
                            :num-of-users="3"
                            imageWidth="30px"
                            @selected="updateAssignee($event, 'add')"
                            @removed="updateAssignee($event, 'remove')"
                            :isDisplayTeam="false"
                        />
                    </li>
                </ul>
            </div>
        </div>
    </div>
</div>
</template>

<script setup>
import { useStore } from "vuex";
import { ref, defineProps, defineEmits , computed, onMounted, inject, watch} from "vue";
import { ValidationFunction } from "@/composable/DefaultValidationFunction";
import InputText from "@/components/atom/InputText/InputText.vue";
import { useValidation } from "@/composable/Validation.js";
// import DueDateCompo from "@/components/molecules/DueDateCompo/DueDateCompo.vue"
import Assignee from '@/components/molecules/Assignee/Assignee.vue';
import SkillsSelect from '@/components/molecules/SkillsSelect/SkillsSelect.vue';
import ProjectSourceSelect from '@/components/molecules/ProjectSourceSelect/ProjectSourceSelect.vue';
import { isUpwork } from '@/utils/projectSource';
import VueDatePicker from '@vuepic/vue-datepicker';
import '@vuepic/vue-datepicker/dist/main.css';
const  { checkErrors } = useValidation();
    // const CompanyDatabase = inject("$companyId");
    const clientWidth = inject("$clientWidth");
    const users = computed(() => getters["users/users"]);
    const props = defineProps({
        modelValue: {
            type: Object,
            default: () => ({}),
        },
    });
    // The template binds `theModel.<field>.value` directly, so a caller whose
    // model is missing a field would crash the whole create sidebar rather than
    // just losing that input. Fill in the optional ones defensively.
    const ensureFields = (model) => {
        if(!model || typeof model !== 'object') return model;
        const defaults = { proposalId: '', source: '', skills: [] };
        Object.keys(defaults).forEach((key) => {
            if(!model[key]) model[key] = { value: defaults[key], rules: "", name: key, error: "" };
        });
        return model;
    }
    const theModel = ref(ensureFields(props.modelValue));
    watch(()=> props.modelValue,(val)=>{
        theModel.value = ensureFields(val);
    })
    const { getters} = useStore();
    var emloyeeArray = computed(() => {
        return getters["users/users"];
    })
    const projectsGetter = computed(() => { return getters["projectData/allProjects"]});
    const projectCodeArr = ref([]);
    if(projectsGetter.value.data && projectsGetter.value.data.length > 0){
        projectsGetter.value.data.forEach(itemVal=>{
            projectCodeArr.value.push(itemVal.ProjectCode);
        })
    }
    if(emloyeeArray.value && emloyeeArray.value.length > 0){
        emloyeeArray.value.forEach(x => {
            x.label = x.Employee_Name
        });
    }
    const emit = defineEmits([
        'update:modelValue'
    ]);
    var projectCategoryArray = ref([]);
    const category = computed(() => {
        return getters['settings/category'];
    });
    /*** GET PROJECT CATEGORY ***/
    onMounted(() => {
        const data = category.value;
        data.forEach(x => {
            projectCategoryArray.value.push({"label" : x});
        });
    })
    // Generate project key dynamically based on project name
    const gererateProjectKey = () => {
        if(theModel.value.projectName.value !== "") {
            const str = theModel.value.projectName.value;
            const matches = str.match(/\b(\w)/g); 
            theModel.value.projectCode.value = matches.join('').toUpperCase();
        }
        else{
            theModel.value.projectName.value = "";
            theModel.value.projectCode.value = "";
        }
        emit('update:modelValue', theModel.value)
    }
    // Chceck if project have unique or not
    const isUniqueProjectKey = (value) => {
        const val = value;
        ValidationFunction.isValueExistInArray(projectCodeArr.value, val, (result) => {
            if (result == true) {
                theModel.value.projectCode.isUniqueProjectCode = "Project_key_must_be_unique";
                theModel.value.projectCode.error = "";               
            } else {
                theModel.value.projectCode.isUniqueProjectCode = "";
            }
        })
        return;
    }
    // Convert string lowercase to uppercase function
    const convertToUpperCase = (keyname)=> {
        var dataVal = theModel.value.projectCode.value.replace(/ /g,'');
        if(keyname == "projectKey"){
            theModel.value.projectCode.value = dataVal.toUpperCase();
        }
        emit('update:modelValue', theModel.value)
    }
    // Push optional-field edits (proposal id, skills) to the parent form model
    const syncModel = () => {
        emit('update:modelValue', theModel.value)
    }
    // Errors clear as the user fixes them; the blocking check runs on submit
    // (checkSourceFields in CreateProjectSidebar / TemplateAllDetail).
    const onSourceChange = () => {
        theModel.value.source.error = '';
        if(!isUpwork(theModel.value.source.value)) theModel.value.proposalId.error = '';
        syncModel();
    }
    const onProposalIdChange = () => {
        theModel.value.proposalId.error = '';
        syncModel();
    }
    // Regex for validate alpha numeric
    const removeSpecialCharacter = () => {
        // ValidationFunction.onlyAlphaNumericAllowed(theModel.value.projectCode.value);
        emit('update:modelValue', theModel.value)
    }
    function updateAssignee(event, type){
        try{
            if(type == "add"){
                theModel.value.leadUser.value.push({...event});
            }
            else if(type == "remove"){
                let indexId = theModel.value.leadUser.value.findIndex((item)=>{
                    return item.id == event.id
                })
                if(indexId !== -1){
                    theModel.value.leadUser.value.splice(indexId,1);
                }
            }
            emit('update:modelValue', theModel.value)
        }
        catch(error){
            console.error(error);
        }
    }
    function updateDueDate (event){
        theModel.value.dueDate.value = new Date(event.dateVal).getTime()/1000;
        emit('update:modelValue', theModel.value)
    }
</script>
<style scoped>
@import './style.css';
</style>
<style scoped>
ul{
    margin: 0;
    padding: 0;
}
li{
    list-style: none;
}

</style>