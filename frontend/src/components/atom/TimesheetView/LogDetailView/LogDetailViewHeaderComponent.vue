<template>
     <div class="logdetailview-header-wrapper">
        <div>
            <div class="d-flex logdetailview__wrapper">
                <span><img class="logdetailview__leftarrow-img position-re" src="@/assets/images/rectangle_leftArrow.png" @click="dateChange('left')"></span>
                <span class="logdetailview-calender-wrapper">
                    <CalenderCompo
                        class="logdetailview-calender"
                        v-model:model-value="dateValue"
                        :isShowDateAndicon="true"
                        @update:model-value="($event) => {dateUpdate($event)}"
                    />
                </span>
                <span><img class="logdetailview__rightarrow-img position-re" src="@/assets/images/rectangle_rightArrow.png" @click="dateChange('right')" ></span>
            </div>
        </div>
        <div v-if="userData.length > 1">
            <div class="d-flex align-items-center userProfileFilter">
                <UserProfile
                    v-for="user in userData.filter((x, index) => index < (clientWidth > 1199 ? 4 : 2))"
                    :key="user.id"
                    :showDot="false"
                    :data="{
                        id: user.id,
                        image: user.profileImage || '',
                        title: user.Employee_Name
                    }"
                    width="30px"
                    :thumbnail="'30x30'"
                    class="cursor-pointer timelog-user-status"
                    :class="[{'selected-blue-border-img border-radius-10-px': usersFilterIDsArray.includes(user.id)}]"
                    @click="usersFilter(user)"
                />
                <DropDown :id="'timeloguser_'+makeUniqueId(6)" v-if="userData.length > 4" :bodyClass="{'timelog-usercount-dropdown' : true}">
                    <template #button>
                        <div class="d-flex align-items-center justify-content-center profile-image GunPowder blue text-nowrap border-2px-blue" :style="{width: '30px', height: '30px'}">
                            +{{userData.length - 4}}
                        </div>
                    </template>
                    <template #options>
                        <DropDownOption
                            v-for="(user, index) in userData.filter((x, index) => index >= 4).map((x) => ({...x,label: x.Employee_Name, image: x.profileImage}))"
                            :key="'user'+index"
                            @click="usersFilter(user)"
                        >
                            <div class="d-flex align-items-center" :title="user.label">
                                <input type="checkbox" :id="'checkbox'+user.id" v-model="user.isChecked" :class="[{'checkboxBlue' : user.isChecked}]"/>
                                <UserProfile
                                    :showDot="false"
                                    :data="{
                                        image: user.image,
                                        title: user.label
                                    }"
                                    width="30px"
                                    class="cursor-pointer profile-image"
                                    :class="[{'selected-blue-border-img border-radius-10-px': usersFilterIDsArray.includes(user.id)}]"
                                />
                                <!-- <img :src="user.image" class="profile-image" alt="user image" :class="[{'selected-blue-border-img border-radius-10-px': usersFilterIDsArray.includes(user.id)}]"> -->
                                <span  class="userfilter-list" :class="{'font-size-16' : clientWidth <=767}">{{ user.label }}</span>
                            </div>
                        </DropDownOption>
                    </template>
                </DropDown>
            </div>
        </div>
        <div class="logdetailview-header-time-wrapper">    
            <div class="logdetailview-header-time-container">
                <div class="d-flex">
                    <div class="circlegreen"></div>
                    <div class="time-title">{{ $t('TimeTracker.tracked') }}</div>
                </div>
                <div class="time-number">{{ $t('TimeTracker.hours_value', { time: convertedTimeString(trackTime,'update') ? convertedTimeString(trackTime,'update') : 0 }) }}</div>
            </div>
            <div class="logdetailview-header-time-container">
                <div class="d-flex">
                    <div class="circlePurple"></div>
                    <div  class="time-title">{{ $t('TimeTracker.manual') }}</div>
                </div>
                <div class="time-number">{{ $t('TimeTracker.hours_value', { time: convertedTimeString(maualTime,'update') ? convertedTimeString(maualTime,'update') : 0 }) }}</div>
            </div>
            <div class="logdetailview-header-time-container">
                <div  class="time-title">{{$t("TimeTracker.total")}}</div>
                <div class="time-total">{{ $t('TimeTracker.hours_value', { time: convertedTimeString(totalTime,'update') ? convertedTimeString(totalTime,'update') : 0 }) }}</div>
            </div>
        </div>
    </div>
</template>
<script setup>
    import {inject, ref,watch} from "vue";
    import { useCustomComposable } from "@/composable";
    import CalenderCompo from '@/components/atom/CalenderCompo/CalenderCompo.vue';
    import { getConvertedTimeString } from '@/composable/commonFunction';
    import UserProfile from "@/components/atom/UserProfile/UserProfile.vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    const emit = defineEmits(["update:dateChange", "update:filterUser"]);
    const {makeUniqueId} = useCustomComposable();
    const clientWidth = inject('$clientWidth');
    const props = defineProps({
        date: {type: Date},
        total: {type: Number, default: 0},
        manual: {type: Number , default: 0},
        tracked: {type: Number , default: 0},
        userData: {type: Array, default:()=>([])}
    });
    const maualTime = ref(props.manual)
    const trackTime = ref(props.tracked)
    const totalTime = ref(props.total)
    const usersFilterIDsArray = ref([]);
    const userData = ref(props.userData)
    watch(()=> props.userData,(newValue) => {
        userData.value = newValue;
    })
    watch(()=> props.manual,(newValue) => {
        maualTime.value = newValue;
    })
    watch(()=> props.total,(newValue) => {
        totalTime.value = newValue;
    })
    watch(()=> props.tracked,(newValue) => {
        trackTime.value = newValue;
    })
    const dateValue = ref(props.date);
    const dateUpdate = (date) => {
        usersFilterIDsArray.value = [];
        emit("update:dateChange",date);
    }
    const usersFilter = (obj) => {
        try {
            userData.value.map((ele)=>{
                if(ele.id == obj.id) {
                    ele.isChecked = !ele.isChecked;
                }
                return ele;
            })
            let ind = usersFilterIDsArray.value.indexOf(obj.id);
            if(ind == -1){
                usersFilterIDsArray.value.push(obj.id);
                emit("update:filterUser",usersFilterIDsArray.value);
            } else{
                usersFilterIDsArray.value.splice(ind, 1);
                emit("update:filterUser",usersFilterIDsArray.value);
            }
        } catch (error) {
            usersFilterIDsArray.value = [];
            emit("update:filterUser",usersFilterIDsArray.value);
            console.error(error,"ERROR");
        }
    }
    const convertedTimeString = (n, type)=>{
        return getConvertedTimeString(n,type);
    }
    const dateChange = (type) => {
        if (type == 'left') {
            dateValue.value =  new Date(new Date(dateValue.value).setDate(dateValue.value.getDate() - 1));
        } else {
            dateValue.value =  new Date(new Date(dateValue.value).setDate(dateValue.value.getDate() + 1));
        }
        usersFilterIDsArray.value = [];
        emit("update:dateChange",dateValue.value);
    }
</script>
<style scoped>
.circlegreen {
  width: 10px;
  height: 10px;
  background-color: #1CB303;
  border-radius: 50%;
  margin-right:6px;
  margin-top:4px;
}
.circlePurple {
  width: 10px;
  height: 10px;
  background-color: #7367F0;
  border-radius: 50%;
  margin-right:6px;
  margin-top:4px;
}
.logdetailview-calender {
    margin-left: 10px;
}
.logdetailview-header-wrapper{
    justify-content:space-between;
    display: flex;
    padding: 20px;
}
.logdetailview-calender-wrapper{
    border:1px solid #DFE1E6;
    height: 30px;
    background-color: #FFFFFF;
}
.logdetailview-header-time-wrapper{
    width: 375px;
    display: flex;
    justify-content: space-between;
}
.logdetailview-header-time-container{
    line-height: 1.5;
}
.time-title{
    width: 50px;
    font-weight: 400;
    font-size: 14px;
}
.time-number{
    width:84px;
    font-size: 18px;
    font-weight: 400;
}
.time-total{
    width:84px;
    font-size: 18px;
    font-weight: 700;
}
.checkboxBlue {
    background-color: #2F3990 !important;
    border: 1px solid #2F3990 !important;
}
.logdetailview__wrapper{
    width:200px;
}
.logdetailview__leftarrow-img{
    right:-2px;
    min-width: 32px;
    height: 30px;
    cursor: pointer;
}
.checkboxBlue:before {
    opacity: 1 !important;
}
.logdetailview__rightarrow-img{
    left:-2px;
    min-width: 32px;
    height: 30px;
    cursor: pointer;
}
@media(max-width: 767px){
    .logdetailview-header-wrapper{
        display: block;
        line-height: 1.3;
    }
    .logdetailview-header-time-wrapper{
        margin-top: 8px;
    }
}
@media(max-width: 390px){
    .timelogText {width: 65%;}
    .logdetailview-header-time-wrapper{
        display: block;
    }
    .logdetailview-header-time-container{
        margin-top: 5px;
    }
    .logdetailview-header-time-wrapper{width: inherit;}
}
</style>