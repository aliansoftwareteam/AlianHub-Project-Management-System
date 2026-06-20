<template>
    <div class="addTimelogMain">
        <Sidebar 
            width="607px"
        >
        <template #head-left>
            <div class="addTimelogtext black">{{isAddLog ? $t('UserTimesheet.add_time_log') : $t('UserTimesheet.edit_time_log')}}</div>
        </template>
        <template #head-right>
            <div class="saveCancelbuttonWrapper">
                <button class="outline-primary closeCancellog" @click="closeTimeLogSidebar()">{{$t('Projects.cancel')}}</button>
                <button :class="[{'pointer-event-none': isSpinner }]" class="btn-primary saveButton" @click="saveLogTime()">{{isAddLog ? $t('Projects.save') : $t('Projects.update')}}</button>
            </div>
        </template>
        <template #body>
            <div class="mainBoadyTimelog bg-white createprojectContent">
                <div class="form-group d-flex align-items-baseline">
                    <label class="black font-weight-500">{{$t('Projects.task_name')}}<span class="red asterisk">*</span></label>
                    <div class="input-field-group">
                        <InputText
                            :modelValue="task.TaskName"
                            :is-disabled="true"
                            height="30px"
                            width="100%"
                            class="form-control text-capitalize"
                        />
                    </div>
                </div>
                <div class="form-group d-flex align-items-start date-wrapper">
                    <label class="black font-weight-500">{{$t('Projects.date')}}<span class="red asterisk">*</span></label>
                   <div class="log_time_form_wrapper duedate_sidebar">
                        <CalenderCompo v-model:model-value="dateValue" :maxDate="new Date()" :isShowDateAndicon="true"  @update:model-value="($event) => {chnageCalDate($event)}"/>
                   </div>
                </div>
                <div class="form-group d-flex align-items-baseline">
                    <label class="black font-weight-500">{{$t('Projects.time')}}<span class="red asterisk">*</span></label>
                    <div class="timeInputWrapper d-flex align-items-center justify-content-between">
                        <div class="timetodiv">
                            <vue-timepicker
                                v-model="timeData.startLogTime"
                                @change="getTimeDuration('start'),checkStartDate()"
                                id="timeTo"
                                name="startTime"
                                class="vue_logTimePicker font-roboto-sans"
                                placeholder="--:--"
                                hide-clear-button
                                hour-label="Hour"
                                minute-label="Minute"
                                apm-label=" "
                                auto-scroll
                                manual-input
                                :format="getUser(userId).timeFormat == '12' ? 'hh:mm A' : 'HH:mm'"
                            >
                            </vue-timepicker>
                            <div class="invalid-feedback red">{{errorTime}}</div>
                        </div>
                        <span class="to-text">To</span>
                        <div class="timetodiv">
                           <vue-timepicker
                                v-model="timeData.endLogTime"
                                @change="getTimeDuration('end')"
                                id="timeFrom"
                                name="endTime"
                                class="vue_logTimePicker font-roboto-sans"
                                placeholder="--:--"
                                hide-clear-button
                                hour-label="Hour"
                                minute-label="Minute"
                                apm-label=" "
                                auto-scroll
                                manual-input
                                :format="getUser(userId).timeFormat == '12' ? 'hh:mm A' : 'HH:mm'"
                            >
                            </vue-timepicker>
                            <div class="invalid-feedback red">{{errorTimeEnd}}</div>
                        </div>
                    </div>
                </div>
                <div class="form-group d-flex align-items-baseline duration-input">
                    <label class="black font-weight-500">{{$t('Projects.duration')}}<span class="red asterisk">*</span></label>
                    <div class="input-field-group ml-0">
                        <InputText
                            :modelValue="timeData.timeDuration"
                            :is-disabled="true"
                            height="30px"
                            width="100%"
                            class="form-control"
                            :placeHolder="$t('PlaceHolder.Duration_only_hours')"
                        />
                    <div class="red invalid-feedback">{{err_time}}</div>
                    </div>
                </div>
                <div class="form-group d-flex text-area-group">
                    <label class="black font-weight-500">{{$t('Description.description')}}<span class="red asterisk">*</span></label>
                    <div class="input-field-group ml-0">
                        <textarea
                            class="form-control font-roboto-sans ml-0 textareaClass"
                            :placeHolder="$t('PlaceHolder.Enter_Text')"
                            name='desc'
                            v-model="formData.description.value"
                            @keyup="checkErrors({'field':formData.description,
                            'name':formData.description.name,
                            'validations':formData.description.rules,
                            'type':formData.description.type,
                            'event':$event})"
                        ></textarea>
                        <div class="invalid-feedback red">{{formData.description.error}}</div>
                    </div>
                </div>
                <div class="form-group d-flex align-items-baseline">
                    <label class="black font-weight-500">{{$t('Billable.billable')}}</label>
                    <div class="input-field-group ml-0">
                        <label class="billable-toggle d-flex align-items-center cursor-pointer">
                            <input type="checkbox" v-model="billable" />
                            <span class="ml-2">{{ billable ? $t('Billable.billable') : $t('Billable.non_billable') }}</span>
                        </label>
                    </div>
                </div>
            </div>
            <SpinnerComp :is-spinner="isSpinner" v-if="isSpinner"/>
        </template>
        </Sidebar>
    </div>
</template>

<script setup>
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { defineComponent , defineProps ,ref , onMounted ,inject, computed,defineEmits } from 'vue';
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue'
    import InputText from '@/components/atom/InputText/InputText.vue';
    import moment from 'moment';
    import VueTimepicker from 'vue3-timepicker'
    import 'vue3-timepicker/dist/VueTimepicker.css';
    import { useGetterFunctions } from '@/composable';
    import { useValidation } from "@/composable/Validation.js";
    import { apiRequest } from '../../../services';
    import {useToast} from 'vue-toast-notification';
    import { useStore } from "vuex";
    import * as env from '@/config/env';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();

    const $toast = useToast();

    const props = defineProps({
        closeTimeLogSidebar: {
            type: Function,
            default: () => []
        },
        isAddLog: {
            type: Boolean,
            default: true
        },
        task: {
            type: Object,
            required: true
        },
        modelValue: {
            type: Object,
        },
        selectedTimeRow: {
            type: Object,
        }
    })
    defineComponent({
        components: {
            Sidebar,
            InputText,
            VueTimepicker
        }
    });
    const  { checkErrors, checkAllFields } = useValidation();
    const userId =  inject('$userId');  
    const { getUser } = useGetterFunctions();
    const dateValue = ref('');
    const finalEndTime = ref('');
    const finalStartTime = ref('');
    const err_time = ref('');
    const companyId = inject('$companyId');
    const { getters } = useStore();
    const projectData = inject("selectedProject");
    const errorTimeEnd = ref('');
    const isSpinner = ref(false);
    // TIME-02: billable defaults to true; on edit, prefill from the row if it carries the flag.
    const billable = ref(props.selectedTimeRow && props.selectedTimeRow.billable !== undefined ? props.selectedTimeRow.billable !== false : true);

     const timeData = computed({
        get() {
            return props.modelValue
        },
        set(value) {
            emit('update:modelValue', value)
        }
    });

    const formData = ref({
        description: {
            value: timeData.value.description,
            rules:
            "required | min:10",
            name: "description",
            error: "",
        },
    })

    const errorTime = ref('');

    const emit = defineEmits([
        'update:modelValue','addTime'
    ]);

    onMounted(()=>{
        let tempLogDate = timeData.value.logTimeDate ? timeData.value.logTimeDate : new Date();
        dateValue.value = moment(tempLogDate).format('YYYY-MM-DD');
    })
    function chnageCalDate (e) {
        dateValue.value = moment(e).format('YYYY-MM-DD');
    }
    const parseTime = (s) => {
        var part = s.match(/(\d+):(\d+)(?: )?(am|pm)?/i);
        if(part !== null){
            var hh = parseInt(part[1], 10);
            var mm = parseInt(part[2], 10);
            if (hh != 12) {
                hh += 12;
            }
            return {res: `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}` };
        }else {
            return {res: '' };
        }
    }

    const revertTime = (s) => {
        var part = s.match(/(\d+):(\d+)(?: )?(am|pm)?/i);
        if(part!== null){
            var hh = parseInt(part[1], 10);
            var mm = parseInt(part[2], 10);
            if (hh == 12) {
                hh = 0;
            }
            return {res: `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}` };
        }else{
            return {res : ''}
        }
    }

    const checkStartDate = () => {
        var timeStr = timeData.value.startLogTime;
        if(timeData.value.startLogTime === ''){
            errorTime.value = t('timeLog.start_time_field_required');
            timeData.value.timeDuration = '';
            return;
        }
        var parts = timeStr.split(':');
        let parts1 = parts[1].split(" ")
        if(timeData.value.startLogTime === '' || (parts[0] === 'hh' || parts1[0] === 'mm' || parts1[1] === 'A')){
            errorTime.value = t('timeLog.start_time_field_required');
            timeData.value.timeDuration = ''
        }
        if(timeData.value.endLogTime === ''){
            errorTimeEnd.value = t('timeLog.end_time_field_required')
        }
    }

    const getTimeDuration = (type) => {
        if(timeData.value.startLogTime != '' && timeData.value.endLogTime != ''){
            errorTime.value = '';
            finalStartTime.value = timeData.value.startLogTime;
            finalEndTime.value = timeData.value.endLogTime;
            if(getUser(userId.value).timeFormat == '12'){
                err_time.value = "";
                var endTimeA = timeData.value.endLogTime.toString().slice(-2);
                var startTimeA = timeData.value.startLogTime.toString().slice(-2);
                if(endTimeA == ":A" || startTimeA == ":A"){
                    err_time.value = t('timeLog.select_valid_time_duration');
                    timeData.value.timeDuration = '';
                    return;
                }

                let endTime = timeData.value.endLogTime.slice(0,5);
                let startTime = timeData.value.startLogTime.slice(0,5);

                if(endTimeA.toLowerCase() == "pm"){
                    let finalTime = parseTime(timeData.value.endLogTime);
                    endTime = finalTime.res;
                }
                if(startTimeA.toLowerCase() == "pm"){
                    let finalTime = parseTime(timeData.value.startLogTime);
                    startTime = finalTime.res;
                }
                if(startTimeA.toLowerCase() == "am"){
                    let finalTime = revertTime(timeData.value.startLogTime);
                    startTime = finalTime.res;
                }
                finalStartTime.value = startTime;
                finalEndTime.value = endTime;

                var startStr = moment(timeData.value.startLogTime, 'hh:mm:a');
                var endStr = moment(timeData.value.endLogTime, 'hh:mm:a');
                // calculate total duration
                var temp_duration = moment.duration(endStr.diff(startStr));
                // duration in hours
                var hours = parseInt(temp_duration.asHours());

                var minutes = parseInt(temp_duration.asMinutes()) % 60;
                if(hours <= 0 && minutes <= 0){
                    err_time.value = t('timeLog.select_valid_time_duration');
                    timeData.value.timeDuration = '';
                    return;
                }
                timeData.value.timeDuration = hours.toString().padStart(2, '0') +':'+ minutes.toString().padStart(2, '0');
            }else{
                 if(hmsToSeconds(timeData.value.endLogTime) > hmsToSeconds(timeData.value.startLogTime)){
                    err_time.value = '';
                    timeData.value.timeDuration = secondsToHMS(hmsToSeconds(timeData.value.endLogTime) - hmsToSeconds(timeData.value.startLogTime));
                }
                else if(hmsToSeconds(timeData.value.endLogTime) <= hmsToSeconds(timeData.value.startLogTime)){
                    err_time.value = t('timeLog.select_valid_time_duration');
                    timeData.value.timeDuration = '';
                }
            }
        }else{
            if(type === 'start'){
                errorTime.value = t('timeLog.start_time_field_required');
            }
        }
        if(timeData.value.startLogTime == '' || timeData.value.endLogTime == ''){
            timeData.value.timeDuration = '';
        }
    }
    const hmsToSeconds = (s) => {
        var b = s.split(':');
        return b[0]*3600 + b[1]*60 + (+b[2] || 0);
    }
    const secondsToHMS = (secs) => {
        function z(n){return (n<10?'0':'') + n;}
        var sign = secs < 0? '-':'';
        secs = Math.abs(secs);
        return sign + z(secs/3600 |0) + ':' + z((secs%3600) / 60 |0);
    }

    const saveLogTime = () => {
        checkStartDate();
        checkAllFields(formData.value).then((valid)=>{
            if(valid && errorTime.value == '' && err_time.value == '') {
                isSpinner.value = true;
                const axiosData = {
                    logTimeDate : dateValue.value,
                    description : formData.value.description.value,
                    endLogTime : finalEndTime.value,
                    startLogTime : finalStartTime.value,
                    timeDuration : timeData.value.timeDuration,
                    ticketId : props.task._id,
                    projectId : props.task.ProjectID,
                    companyId : companyId.value,
                    userId : userId.value,
                    isEdit : props.isAddLog ? false : true,
                    userName : getUser(userId.value).Employee_Name,
                    dateFormat : getters['settings/companyDateFormat'].dateFormat,
                    timeSheetId : props.selectedTimeRow ? JSON.parse(JSON.stringify(props.selectedTimeRow))?._id : '',
                    sprintId : props.task.sprintId,
                    taskName : props.task.TaskName,
                    companyOwnerId : getters["settings/companyOwnerDetail"]._id,
                    projectName : projectData.value.ProjectName,
                    previousLoggedTime : props.selectedTimeRow ? props.selectedTimeRow.totalTimeDuration : '',
                    timeZone:getUser(userId.value).timeZone,
                    timeFormat: getUser(userId.value).timeFormat,
                    billable: billable.value
                }
                apiRequest("post", env.ADD_TIMELOG, axiosData).then((result)=>{
                    props.closeTimeLogSidebar();
                    if(result.data.status === true){
                        emit('addTime',result.data.data)
                        $toast.success(t("Toast.Log_time_added_successfully"),{position: 'top-right'});
                        isSpinner.value = false;
                    }else{
                        isSpinner.value = false;
                        $toast.error(result.data.statusText || t("Toast.something_went_wrong"),{position: 'top-right'});
                    }
                }).catch((err)=>{
                    isSpinner.value = false;
                    console.error(err,"Error in Add/Edit Time Log");
                })
            }
        })
    }
</script>

<style  src="./style.css">
</style>