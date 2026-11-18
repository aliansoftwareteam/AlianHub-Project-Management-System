<template>
    <SpinnerComp :is-spinner="isSpinner" />
    <div>
        <h2 class="task_priority_wrapper_value">{{ $t('Milestone.milestone_weekly_range') }}</h2>
        <div class="mySettingSection priorityWrapper">
            <div v-if="!milestoneCheck && props.editPermission" :class="[{'Company-pointer-event-none':isSpinner}]">
                <div class="vs-component vs-con-input-label vs-input inputx vs-input-primary">
                    <DropDown mode="listbox">
                        <template #button>
                            <div class=" vs-inputx vs-input--input normal" :ref="milestonefromate">
                                {{ milestoneformat }}
                            </div>
                        </template>
                        <template #options>
                            <DropDownOption v-for="(date, index) in dateArray" :key="index" :selected="date === milestoneformat" @click="handleSelect(date),$refs[milestonefromate].click()">
                                <div class="w-100">{{date}}</div>
                            </DropDownOption>
                        </template>
                    </DropDown>
                </div>
                <div class="d-flex">
                    <button type="submit" class="blue_btn" id="blue_btn" :class="[{'Company-pointer-event-none':isSpinner}]" @click="saveData">{{ $t('Projects.save') }}</button>
                    <button type="button" name="button"
                        :class="[{'Company-pointer-event-none':isSpinner}]" class="vs-component vs-button white_btn vs-button-primary vs-button-filled" @click="cancelData">
                        {{ $t('Projects.cancel') }}
                    </button>
                </div>
            </div>
            <span v-else>{{ milestoneformat }}</span>
        </div>
    </div>
</template>

<script setup>
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import * as env from '@/config/env';
import { apiRequest } from "@/services";
import { useToast } from 'vue-toast-notification';
import DropDown from "@/components/molecules/DropDown/DropDown.vue";
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
import { defineComponent, ref, computed ,defineProps, watch, onMounted} from "vue";
import DropDownOption from "@/components/molecules/DropDownOption/DropDownOption.vue";
const { t } = useI18n();

const $toast = useToast();
const dateArray = ref(['Mon - Sun', 'Sun - Mon'])
const milestonefromate = ref("")
const { getters,commit } = useStore();
const isSpinner = ref(false);
const milestoneformat = ref('');
const milestoneCheck = ref(false);
defineComponent({
    name: 'Company-Details',
    components: {
        DropDown,
        DropDownOption,
        SpinnerComp,
    }
})
const props = defineProps({
    editPermission: {
        type: [Boolean],
        default: false
    }
});
const milestone = computed(() => getters["settings/milestoneweeklyrange"]);
watch(milestone,(newValue)=>{
    milestoneformat.value = newValue;
});
onMounted(()=>{
    getMongodbData();
})
// GET WEEKLY MILESTONE 
async function getMongodbData() {
    try {
        await apiRequest("get",`${env.MILESTONE}/Weekly`).then((result) => {
            if(result.status === 200){
                if(result?.data && Object.keys(result?.data)?.length){
                    milestoneCheck.value = true;
                }else{
                    milestoneCheck.value = false;
                }
            }else{
                milestoneCheck.value = false;
            }
            milestoneformat.value = milestone.value;
        }).catch((error) => {
            milestoneCheck.value = false;
            console.error("Error in getFixMilestoneData",error);
        });
    } catch (error) {
        milestoneCheck.value = false;
        console.error("Error in getFixMilestoneData",error);
    }
}
// SAVE DATA MILESTONE WEEKLY RANGE ///
async function saveData() {
    if (milestoneformat.value) {
        if(milestone.value !== milestoneformat.value){
            try {
                isSpinner.value = true;
                let queryObj = {
                    action:milestoneformat.value
                };
                const res = await apiRequest("post",env.MILESTONE,queryObj);
                if(res.status === 200){
                    commit("settings/mutateProjectMilestoneWeeklyRange", {data: milestoneformat.value,op: "modified"})
                    $toast.success(t("Toast.Milestone_weekly_range_updated_successfully"), { position: 'top-right' });
                }else{
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                }
                isSpinner.value = false;
            } catch (error) {
                isSpinner.value = false;
                console.error("Error in updating the weekly range")
            }
        }
    }
}
const cancelData = () => {
    milestoneformat.value = milestone.value;
};
const handleSelect = (value) => {
    milestoneformat.value = value;
};
</script>

<style scoped>
@import './style.css';


.blue_btn {
    margin-left: 0px !important;
}

.normal {
    width: 264px !important;
    height: 30px !important;
}
.inputx {
    margin-bottom: 20px !important;
}
.font_family_status_date {
    font-family: var(--font-ui);
    font-size: 16px;
    font-weight: 400;
    line-height: 19px;
    letter-spacing: 0px;
    text-align: left;
    display: block;
}
@media(max-width: 1199px){
.inputx {
    margin-bottom: 25px !important;
}
}
@media(max-width: 480px){
    .normal {width: 100% !important;}
}
@media(max-width: 375px){
    .normal {margin-bottom: 10px;width: 100% !important;}
    .inputx {
    margin-bottom: 0px !important;
}
}
</style>