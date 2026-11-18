<template>
    <tr>
        <td></td>
        <td>
            <div class="milestone-date">
                <InputText
                    v-model.trim="formData.fixMilestone.value"
                    type="text"
                    :id="`milestonename`"
                    :placeHolder="$t('PlaceHolder.Enter_Text')"
                    :inputId="`milestonename`"
                    @keyup="checkErrors({'field':formData.fixMilestone,
                        'name':'name',
                        'validations':formData.fixMilestone.rules,
                        'type':formData.fixMilestone.type,
                        'event':$event.event})"
                ></InputText>
                <small class="fix-milestone-input-red" v-if="formData.fixMilestone.error">{{formData.fixMilestone.error}}</small>
            </div>
        </td>
        <td>
            <div class="startdateinput">
                <MilestoneDate
                    id="startdate"
                    :displyDate="startDate ? startDate : ''"
                    :isShowDateAndicon="true"
                    :calenderImage="true"
                    :InputDesign="true"
                    @SelectedDate="($event) => updateStartDate($event)"
                    :inputIdProps="`startDate`"
                ></MilestoneDate>
            </div>
        </td>
        <td>
            <MilestoneDate
                id="enddate"
                :displyDate="endDate ? endDate : ''"
                :isShowDateAndicon="true"
                :minDate="minDate"
                :calenderImage="true"
                :InputDesign="true"
                @SelectedDate="($event) => updateEndDate($event)"
                :inputIdProps="`endDate`"
            ></MilestoneDate>
        </td>
        <td>
            <MilestoneDate
                id="duedate"
                :displyDate="dueDate ? dueDate : ''"
                :isShowDateAndicon="true"
                :minDate="minDate"
                :calenderImage="true"
                :InputDesign="true"
                @SelectedDate="($event) => updateDueDate($event)"
                :inputIdProps="`dueDate`"
            ></MilestoneDate>
        </td>
        <td>
            <div class="milestone-date">
                <div class="d-flex position-re">
                    <span class="currency">{{props?.currencyMilestone?.symbol}}</span>
                    <InputText
                        v-model.number="formData.amount.value"
                        type="number"
                        :id="`amount`"
                        :placeHolder="$t('PlaceHolder.Enter_Amount')"
                        :inputId="`amount`"
                        @keypress="onlyNumber($event.event)"
                        @keyup="checkErrors({'field':formData.amount,
                            'name':'amount',
                            'validations':formData.amount.rules,
                            'type':formData.amount.type,
                            'event':$event.event})"
                        @input="handleInputNum()"
                        min="1"
                        class="amountCurr"
                    ></InputText>
                </div>
                <small class="fix-milestone-input-red" v-if="formData.amount.error">{{formData.amount.error}}</small>
                <small class="fix-milestone-input-red" v-if="err">{{$t(`Milestone.${err.replaceAll(' ',"_")}`)}}</small>
            </div>
        </td>
        <td>
            <div class="milestone-date">
                <InputText
                    v-model="status"
                    type="text"
                    :id="`status`"
                    :placeHolder="$t('PlaceHolder.Select')"
                    :inputId="`status`"
                    isReadonly
                    @click="isVisible = true,handleFocusStatusDate"
                    @focus="isVisible = true"
                ></InputText>
            </div>
        </td>
        <td>
            <MilestoneDate
                v-if="status"
                id="AddstatusDate"
                :displyDate="statusDate ? statusDate : ''"
                :isShowDateAndicon="true"
                :calenderImage="true"
                :InputDesign="true"
                :minDate="statusObj.isFuture === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isFuture === false && statusObj.isPast === false ? new Date() : ''"
                :maxDate="statusObj.isPast === true ? statusObj.isFuture === true && statusObj.isPast === true ? '' : new Date() : statusObj.isPast === false && statusObj.isFuture === false ? new Date() : ''"
                @SelectedDate="($event) => updateStatusDate($event)"
                :inputIdProps="`statusDate`"
                :autoposition="'top'"
            ></MilestoneDate>
        </td>
        <td>
            <div class="d-flex align-items-center refund-delete-image">
                <img :src="saveImage" alt="save" @click="handleFixMilestone" class="cursor-pointer refund_delete">
                <img :src="deleteImage" alt="deleteedit" @click="handleClearMilestone,$emit('addMilestone','clear')" class="cursor-pointer">
            </div>
        </td>
        <Sidebar
            class="task-milestone-status-sidebar"
            v-model:visible="isVisible"
            :title="$t('Milestone.mileston_status')"
            :enable-search="true"
            :options="options"
            :listenKeys="true"
            @selected="selectedObj($event)"
        >
        </Sidebar>
    </tr>
</template>

<script setup>
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    import { computed,ref,defineProps,defineEmits,nextTick,onMounted,defineComponent, onUnmounted } from 'vue';
    import InputText from '@/components/atom/InputText/InputText.vue';
    import MilestoneDate from '@/components/molecules/FixMilestoneDate/FixMilestoneDate.vue';
    import { useValidation } from "@/composable/Validation";
    import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import { useI18n } from "vue-i18n";
    const { t } = useI18n();
    const  { checkErrors,checkAllFields } = useValidation();
    defineComponent({
        name: 'FixMilestoneInput'
    });
    //props
    const props = defineProps({
        settingMilestoneStatusAdd : {
            type:Array,
            required:true
        },
        currencyMilestone: {
            type:Object,
            required:true
        }
    });
    const saveImage = require('@/assets/images/save.png');
    const deleteImage = require('@/assets/images/delete1.png');
    const startDate = ref('');
    const endDate = ref('');
    const dueDate = ref('');
    const status = ref('');
    const statusDate = ref('');
    const minDate = ref(new Date());
    const isVisible = ref(false);
    const statusObj = ref({});
    const statusArrayMilestone = ref([]);
    const milestoneStatusArray = ref(props.settingMilestoneStatusAdd);
    const formData = ref({
        fixMilestone: {
            type: 'text',
            name: 'name',
            value: '',
            rules: "required|min:3|"
        },
        amount: {
            type: 'number',
            name: 'amount',
            value: '',
            rules: "required"
        }
    });
    const err = ref('');
    const emit = defineEmits(['addMilestone']);
    
    nextTick(() => {
        document.getElementById(`milestonename`).focus();
    });
    
    const handleInputNum = () => {
        if(formData.value.amount.value === 0 || formData.value.amount.value === ''){
            formData.value.amount.value = '';
            err.value = "";
        }
        if(formData.value.amount.value){
            const value = Number(formData.value.amount.value);
            let val = String(value).split(".");
            if(val[1]?.length > 2){
                err.value = t('Milestone.Max_2_decimal_places_allowed');
            }else{
                err.value = "";
            }
        }
    };
    const handleClearMilestone = () => {
        formData.value.amount.value ='';
        formData.value.fixMilestone.value = '';
        startDate.value = '';
        endDate.value = '';
        dueDate.value = '';
        status.value = '';
        statusDate.value = '';
    };
    const updateEndDate = (val) => {
        endDate.value = val.dateVal;
    };
    const updateDueDate = (val) => {
        dueDate.value = val.dateVal;
    };
    const updateStartDate = (val) => {
        startDate.value = val.dateVal;
        minDate.value = val.dateVal;
    };
    const updateStatusDate = (val) => {
        statusDate.value = val.dateVal;
    };
    const selectedObj = (val) => {
        statusObj.value = val;
        status.value = val.name;
        statusDate.value = new Date();
    };
    const onlyNumber = (event) => {
        ValidationFunction.onlyNumberMilestone(event);
    };
    const options = computed(() => {
        return milestoneStatusArray.value.filter(status => status.value !== 'CANCELLED' && status.value !== 'REFUNDED').map((status) => {
            return {
                ...status,
                label: status.name
            }
        });
    });
    const handleFixMilestone = () => {
        checkAllFields(formData.value).then((valid)=>{
            if(valid && err.value === ''){
                statusArrayMilestone.value = [];
                if(status.value){
                    statusArrayMilestone.value.push({
                        statusDateValue: statusDate.value,
                        milestoneStatusColor:statusObj.value.value
                    });
                }
                const obj = {
                    milestoneName: formData.value.fixMilestone.value,
                    startDate: startDate.value,
                    endDate: endDate.value,
                    dueDate: dueDate.value,
                    amount: Number(formData.value.amount.value),
                    refundedAmount:[],
                    statusArray:statusArrayMilestone.value,
                    statusId:statusObj.value && Object.keys(statusObj.value).length ? statusObj.value.value : '',
                    statusDate:statusDate.value ? statusDate.value : '',
                    minRefundDate:'',
                    maxRefundDate:''
                };
                emit('addMilestone','add',obj,statusObj.value && Object.keys(statusObj.value).length ? statusObj.value : '');
                handleClearMilestone();
            }
        });
    };
    const handleEnter = (event) => {
        if (event.keyCode === 13){
            handleFixMilestone();
        }
    };
    const addKeyUpListener = () => {
        document.addEventListener("keyup", handleEnter);
    };
    const removeKeyUpListener = () => {
        document.removeEventListener("keyup", handleEnter);
    };
    onMounted(() => {
        addKeyUpListener();
    });
    onUnmounted(() => {
        removeKeyUpListener();
    });
    const handleFocusStatusDate = () => {
        setTimeout(() => {document.getElementById(`statusDateFocus`).focus();});
    }
</script>

<style scoped>
.fix-milestone-input-red {
    color: var(--danger-ink);
}
</style>
