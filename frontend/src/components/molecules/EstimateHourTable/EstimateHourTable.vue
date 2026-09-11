<template>
    <div class="table-Estimataed-hour-Wrapper z-index-1">
        <table class="table table-astimated-hour">
            <thead>
                <tr>
                    <th rowspan="2">
                        {{$t('Milestone.user')}}
                    </th>
                    <th colspan="7">
                        {{$t('Milestone.range')}}: 
                        <VDatePicker
                            :model-config="modelConfig"
                            is-required
                            v-model="dateRange"
                            :attributes="attributes"
                            @dayclick="createRange"
                            :max-date="new Date(dueDate)"
                            :popover="{ visibility: 'click' }"
                        >
                            <template v-slot="{ togglePopover,inputEvents }">
                                <button
                                    class="toggle__popover p-0 border-0 border-radius-6-px"
                                    @click="togglePopover()"
                                >
                                    <input
                                        maxlength="10"
                                        class="form-control focusinput date_input_value cursor-pointer"
                                        v-on="inputEvents"
                                        :placeholder="`${changeDateFormate(attributes[0].dates.start)} - ${changeDateFormate(attributes[0].dates.end)}`"
                                        readonly
                                    />
                                </button>
                            </template>
                        </VDatePicker>
                    </th>
                </tr>
                <tr v-if="weekRange.length" class="estimate__daysdate-tr">
                    <th v-for="(data,ind) in weekRange" :key="ind" :class="{'disbleDate': (data.day === 0 || data.day === 6)}" class="text-center" :style="`${data.today ? 'background-color: #2F3990;' : ''}`">
                        <div class="d-grid">
                            <b :class="{'white': data.today}">{{ addZero(data.date.getDate()) }}</b>
                            <span :class="{'white': data.today}">{{ days[data.day] }}</span>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="user in totalUsers" :key="user.id">
                    <td class="full-width bg-white total__users" :title="user.Employee_Name">
                        <div class="d-flex align-items-center">
                            <!-- <img :src="user.userProfile" class="table-user-w30" /> -->
                            <UserProfile 
                                :data="{
                                    id: user.id,
                                    title: user.Employee_Name,
                                    image: user.Employee_profileImageURL,
                                }"
                                width="30px"
                                :showDot="false"
                            />
                            <span class="font-size-13 font-weight-500 black">{{user.Employee_Name}}</span>
                        </div>
                    </td>
                    <template v-if="Object.keys(selectedWeekDays).length">
                        <td :style="`${element.today ? 'background-color: #DBF1FF;' : ''}`" v-for="element in selectedWeekDays[user.id]" :key="element.id" class="est_esditing_block bg-white p-0" :class="{'disbleDate': (element.day === 0 || element.day === 6)}">
                            <span @click="element.disabled ? '' : showTimeInput(element)" v-if="!element?.edit">
                                <span v-if="false" class="font-size-14" :class="{'gray81': element.disabled || element.day === 0 || element.day === 6}">00:00</span>
                                <span v-else class="font-size-14" :class="{'gray81': element.disabled || element.day === 0 || element.day === 6}"> {{element.time.HH}}:{{element.time.mm}}</span>
                            </span>
                            <span v-else class="vs-con-loading__container" id="div-with-loading-Estimated-TimeInput" @focusout="() => handleClickOutside(element)">
                                <vue-timepicker
                                    :id="`${element.date.getTime()}`"
                                    v-model="element.time"
                                    manual-input
                                    class="durationTimepicker timepicker"
                                    placeholder="hh:mm"
                                    format="HH:mm"
                                    @blur="element.edit = false"
                                    hide-clear-button
                                    hide-dropdown
                                    :input-attrs="{ inputmode: 'numeric', pattern: '[0-9]*' }"
                                    @change="handleUpdate($event, element, user.id)"
                                >
                                </vue-timepicker>
                            </span>
                        </td>
                    </template>
                </tr>
            </tbody>
        </table>
    </div>
</template>
<script setup>
// PACKAGES
import { useCustomComposable, useGetterFunctions, useMoment } from "@/composable";
import { defineProps, defineEmits, ref, onMounted, watch, inject } from "vue";
import { useStore } from 'vuex';


// COMPONENTS
import UserProfile from '@/components/atom/UserProfile/UserProfile';
import VueTimepicker from 'vue3-timepicker';

// UTILS
const { changeDateFormate } = useMoment();
const { getUser } = useGetterFunctions();
const { addZero } = useCustomComposable();
const { getters } = useStore();

import { useI18n } from "vue-i18n";
import { isOwnerOrAdmin } from "@/utils/roles";
const { t } = useI18n();

const emits = defineEmits(['update:updatedETA', 'rangeUpdated'])

const props = defineProps({
    projectId: {
        type: String,
        required: true
    },
    sprintId: {
        type: String,
        required: true
    },
    taskId: {
        type: String,
        required: true
    },
    estimates: {
        type: Array,
        default: () => []
    },
    updatedETA: {
        type: Array,
        default: () => []
    },
    dueDate:{
        type: [String, Object, Date],
        required: true
    },
    createdAt: {
        type: [String, Object, Date],
        required: true
    },
    AssigneeUserId: {
        type: Array,
        default: () => []
    },
    permission : {
        type: [Number, String, Boolean],
        required: false,
        default: null
    },
    isSpinner: {
        type: Boolean,
        default: false
    }
})

// CALENDAR
const weekRange = ref([]);
const selectedWeekDays = ref({});
const days = [t('weekName.sun'),t('weekName.mon'),t('weekName.tue'),t('weekName.wed'),t('weekName.thu'),t('weekName.fri'),t('weekName.sat')]
const dateRange = ref(new Date());
const modelConfig = ref({type: 'string',mask: 'YYYY-MM-DD'});
const attributes = ref([
    {
        highlight: {
            start: { fillMode: 'outline' },
            base: { fillMode: 'light' },
            end: { fillMode: 'outline' },
        },
        dates: { start: new Date(), end: new Date() },
    }
]);

const totalUsers = ref([]);
const updatedItems = ref([]);
const companyUser = ref(getters['settings/companyUserDetail']);

watch(() => props.isSpinner,(newVal,oldVal) => {
    if(newVal !== oldVal){
        updatedItems.value = [];
        dateRange.value = new Date(props.dueDate)
        createRange(dateRange.value);
    }
});

watch(() => props.dueDate,(newVal, oldVal) => {
    if(newVal !== oldVal){
        mapEstimates(new Date(newVal));
    }
});

const userId = inject("$userId")

function showTimeInput(ele) {
    ele.edit = true;
    // const span = document.getElementById(ele.date.getTime());
}

function mapEstimates(date) {
    selectedWeekDays.value = {};
    weekRange.value = [];
    for(let i = 0; i < 7; i++) {
        const specificDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + i);
        const findEtaData = (uid) => {
            const eta = props.estimates.find((x) => new Date(x.Date).getTime() / 1000 === specificDate.getTime() / 1000 && x.UserId === uid);
            const timeObj = {
                HH: eta?.EstimatedTime ? addZero(Math.floor(eta?.EstimatedTime / 60)).toString() : "00",
                mm: eta?.EstimatedTime ? addZero(eta?.EstimatedTime % 60).toString() : "00"
            }
            const eta2 = props.updatedETA.find((x) => x.timeStamp/1000 === specificDate.getTime() / 1000 && x.UserId === uid);
            const timeObj2 = {
                HH: eta2?.minutes ? addZero(Math.floor(eta2?.minutes / 60)).toString() : "00",
                mm: eta2?.minutes ? addZero(eta2?.minutes % 60).toString() : "00"
            }

            let etaData = {
                id: eta?._id || null,
                day: specificDate.getDay(),
                date: specificDate,
                today: new Date().setHours(0, 0, 0, 0) === specificDate.setHours(0,0,0,0),
                prevTime: eta?._id ? eta?.EstimatedTime : null,
                time: eta2 ? timeObj2 : timeObj,
                disabled: new Date(props.dueDate) <= specificDate
            }
            return etaData;
        }

        weekRange.value.push(findEtaData(null))

        props.AssigneeUserId.forEach((uid) => {
            if(selectedWeekDays.value?.[uid]) {
                selectedWeekDays.value[uid].push(findEtaData(uid))
            } else {
                selectedWeekDays.value[uid] = [findEtaData(uid)]
            }
        })
    }
}

watch(() => props.estimates, () => {
    mapEstimates(attributes.value[0].dates.start);
    updatedItems.value = [];
}, { deep: true })

function createRange(date = null) {
    let currentDate;
    if(!date) {
        currentDate = new Date();
    } else {
        currentDate = new Date(dateRange.value);
    }

    let day = currentDate.getDay();
    let diffToMonday = (day === 0 ? 6 : day - 1);
    let weekStart = new Date(currentDate);
    weekStart.setDate(currentDate.getDate() - diffToMonday);
    let weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    emits('rangeUpdated', {start: weekStart, end: weekEnd});

    mapEstimates(weekStart);

    attributes.value[0].dates = {
        start: weekStart,
        end: weekEnd
    };
}

onMounted(() => {
    selectedWeekDays.value = {};
    updatedItems.value = [];
    createRange();
});

function handleUpdate(e, data, uid) {    
    let timeStamp = new Date(data.date).getTime();
    let minutes = (Number(e.data.H?.length ? e.data.H : 0) * 60) + Number(e.data.m?.length ? e.data.m : 0);

    if(minutes === 0 && data.prevTime === null) return;
    let itemIndex = updatedItems.value.findIndex((x) => x.timeStamp === timeStamp && x.UserId === uid);
    if(itemIndex !== -1) {
        updatedItems.value[itemIndex] = {
            ...updatedItems.value[itemIndex],
            minutes,
            id: data?.id || null,
            prevTime: data.prevTime
        }
    } else {
        updatedItems.value.push({
            timeStamp,
            minutes,
            prevTime: data.prevTime,
            id: data?.id || null,
            UserId: uid
        })
    }

    // REMOVE NOT MODIFIED DATA
    updatedItems.value = updatedItems.value.filter((x) => x.minutes !== x.prevTime);

    emits('update:updatedETA', updatedItems.value);
}

props.AssigneeUserId.forEach((element) => {
    if(!isOwnerOrAdmin(companyUser.value.roleType) && props.permission !== 2) {
        if(element === userId.value){
            totalUsers.value.push(getUser(element));
        }
    }else{
        totalUsers.value.push(getUser(element));
    }
})

function handleClickOutside(element) {
    if (!element.time.HH && !element.time.mm) {
        element.time.HH = "00";
        element.time.mm = "00";
    }
}
</script>
<style>
.table-Estimataed-hour-Wrapper .vue__time-picker{
    border-radius: 4px;
    height: 30px !important;
    width: 48px !important;
}
.table-Estimataed-hour-Wrapper .vue__time-picker input.vue__time-picker-input{
    width: 48px !important;
    height: 30px !important;
    border: 1px solid  #DFE1E6;
}
.table-Estimataed-hour-Wrapper .durationTimepicker input {
    border-radius: 5px;
}
</style>
<style scoped src="./style.css">
</style>