<template>
    <SpinnerComp :is-spinner="isSpinner" />
    <div>
        <h2 class="task_priority_wrapper_value mt-0px">{{ $t('Milestone.project_milestone_Status') }}</h2>
        <div class="mySettingSection priorityWrapper">
            <div>
                <form class="pb-30px" v-if="props.editPermission ==true">
                    <div class="d-flex wrapper_setting" >
                        <div class="wrapper_milestone">
                            <h3 class="date_milestone">{{$t('Milestone.milestone_status_name')}}</h3>
                            <div
                                class="vs-component vs-con-input-label vs-input inputx inputx_milestone_status vs-input-primary">
                                <div class="vs-con-input">
                                    <div class="color_picker">
                                        <input type="color" v-model="formData.colorvalue" :aria-label="$t('Milestone.milestone_status_name')"
                                            class="vs-inputx vs-input--input normal hasValue cursor-pointer"/>
                                    </div>
                                    <InputText type="text" class="vs-inputx vs-input--input normal milestone__value-input" 
                                        :placeholder="$t('PlaceHolder.Enter_Milestone_Status')" v-model.trim="formData.milestone_status.value"
                                        @keyup="checkErrors({
                                                'field': formData.milestone_status,
                                                'name': formData.milestone_status.name,
                                                'validations': formData.milestone_status.rules,
                                                'type': formData.milestone_status.type,
                                                'event': $event.event,
                                            })" />
                                    <div class="invalid-feedback red Milestone_invalid">{{ formData.milestone_status.error }}</div>
                                </div>
                            </div>
                        </div>
                        <div class="date_value_displayed">
                            <h3 class="date_milestone">{{$t('Milestone.date_displaye')}}</h3>
                            <div class="d-flex">
                                <div class="form-group-milestone">
                                    <input type="checkbox" id="pastdate" class="input_checkbox"
                                        @click="isPast = !isPast" />
                                    <label class="past_future mr-20px" for="pastdate">{{ $t('Milestone.past') }}</label>
                                </div>
                                <div class="form-group-milestone">
                                    <input type="checkbox" class="input_checkbox" id="futuredate"
                                        @click="isFuture = !isFuture" />
                                    <label for="futuredate" class="past_future">{{ $t('Milestone.feature') }}</label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex">
                        <button type="button" class="blue_btn" id="blue_btn" @click="saveData">{{$t('Projects.save')}}</button>
                        <button type="button" name="button"
                            class="vs-component vs-button white_btn vs-button-primary vs-button-filled" @click="cancel()">
                            {{$t('Projects.cancel')}}
                        </button>
                    </div>
                </form>
                <div class="milestone-table-overflow milestone_status_button_wrapper">
                    <table class="milestone_wrapper_table">
                        <thead>
                            <tr>
                                <th class="pl-30px">{{ $t('Milestone.milestone_status_name') }}</th>
                                <th>{{$t('Milestone.date_displaye')}}</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(item, index) in arrayobject" :key="index">
                                <td>
                                    <div class="d-flex color_box_main pl-20px">
                                        <span class="color_box" :style="{ backgroundColor: item.backgroundColor }"></span>
                                        <span class="overflow-auto style-scroll w-100"> {{ item.name }}</span>
                                    </div>
                                </td>
                                <td>
                                    <span>
                                        {{ item.isPast === false && item.isFuture === false ? '-' : '' }} 
                                        {{ item.isPast === true ? 'Past' : '' }} 
                                        {{ item.isFuture === true && item.isPast === true ? ',' : '' }} 
                                        {{ item.isFuture === true ? 'Future' : '' }}
                                    </span>
                                </td>
                                <td>
                                    <div class="d-flex Rename_Delete_wrapper justify-content-end" id="modelComponent0">
                                        <DropDown class="mr-1" mode="menu" v-if="!item.isDefault && props.editPermission ==true">
                                            <template #button>
                                                <img :src=addIcon :alt="$t('Milestone.status_actions', { name: item.name })" class="cursor-pointer">
                                            </template>
                                            <template #options>
                                                <DropDownOption @click="EditData(index)">
                                                    <img :src='renameicon' alt="">
                                                    <label class="dropRename">{{$t('Projects.rename')}}</label>
                                                </DropDownOption>
                                                <DropDownOption @click="deletetask(index)" v-if="item.isCount == 0">
                                                    <img :src='deleteicon' alt="">
                                                    <label class="dropDelete">{{ $t('Projects.delete') }}</label>
                                                </DropDownOption>
                                            </template>
                                        </DropDown>
                                    </div>
                                </td>
                            </tr>
                            <ConfirmModal
                                :modelValue="showConfirmModal"
                                :acceptButtonText="$t('Home.Confirm')"
                                :cancelButtonText="$t('Projects.cancel')"
                                maxlength="150"
                                :header="true"
                                :showCloseIcon="false"
                                @accept="DeleteData"
                                @close="showConfirmModal = false"
                            >
                                <template #header>
                                    <h3 class="m-0">{{ $t('Home.Confirm') }}</h3>
                                </template>
                                <template #body>
                                    <span>{{$t('Filters.are_you_sure')}}?</span>
                                </template>
                            </ConfirmModal>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    //import
    import { useStore } from "vuex";
    import { useI18n } from "vue-i18n";
    import * as env from '@/config/env';
    import { apiRequest } from "@/services";
    import { useToast } from 'vue-toast-notification';
    import { useValidation } from "@/composable/Validation.js";
    import ConfirmModal from '@/components/atom/Modal/Modal.vue';
    import InputText from "@/components/atom/InputText/InputText.vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';
    import { ref, computed, watchEffect, defineComponent, onMounted ,defineProps} from "vue";
    const { t } = useI18n();

    const $toast = useToast();
    const { getters,commit } = useStore();
    const { checkErrors } = useValidation();
    // variable
    const isPast = ref(false);
    const rename = ref(false);
    const valueindex = ref('');
    const selectedvalue=ref(null);
    const isFuture = ref(false);
    const arrayobject = ref([]);
    const isSpinner = ref(false);
    const showConfirmModal = ref(false);
    const formData = ref({
        milestone_status: {
            value: "",
            rules:
                "required | min:3",
            name: "milestone status",
            error: "",
        },
        colorvalue: '#818181'
    });
    //computed
    const status = computed(() => getters['settings/projectMilestoneStatus']);
    // image
    const renameicon = require("@/assets/images/editmilestone.png");
    const deleteicon = require("@/assets/images/Deletemilestone.png");
    const addIcon = require("@/assets/images/svg/addIconmilestoneSvg.svg");

    defineComponent({
        name: 'Milestone-Status',
        components: {
            DropDown,
            DropDownOption,
            InputText,
            SpinnerComp
        }
    })
    // props
    const props = defineProps({
        editPermission: {
            type: [Boolean],
            default: false
        }
    })
    // onMounted
    onMounted(() => {
        arrayobject.value = status.value
    });

    watchEffect(() => {
        arrayobject.value = status.value.map((x) => ({ ...x, value: x.value, name: x.name, backgroundColor: x.backgroundColor, isFuture: x.isFuture, isPast: x.isPast, isDeleted: x.isDeleted, milestoneStatusDate: x.milestoneStatusDate ,isDefault: x.isDefault ,isCount:x.isCount}));
    });

    /// UPDATE DATA IN DATABASE  ////
    async function saveData() {
        if (formData.value.colorvalue === '#ffffff' || formData.value.colorvalue === '#fff') {
            formData.value.milestone_status.error = t('Milestone.white_color_not_allowed');
            return formData.value.colorvalue = '#818181'

        }
        if (formData.value.milestone_status.value == '') {
            formData.value.milestone_status.error = (t('Milestone.The_milestone_status_field_is_required'));
            return
        }
        if (formData.value.milestone_status.value.length < 3) {
            formData.value.milestone_status.error =(t('Milestone.The_milestone_status_field_must_be_at_leat_characters'));
            return
        }

        if (rename.value == false) {
            const nameExists = arrayobject.value.some((item) => {
                return item.name.replaceAll(" ","").toLowerCase() === formData.value.milestone_status.value.replaceAll(" ","").toLowerCase();
            });

            if (nameExists) {
                formData.value.milestone_status.error = (t('Milestone.Name_already_exists'));
                return
            }
            isSpinner.value = true;

            let obj = {
                name: formData.value.milestone_status.value, milestoneStatusDate: new Date(), backgroundColor: formData.value.colorvalue,
                isFuture: isFuture.value, isPast: isPast.value, isDeleted: true, value: Math.random().toString(36).substring(2, 15),isDefault:false,isCount:0
            }

            arrayobject.value.push(obj);
            try {
                const queryUpdate = {
                    key: '$push',
                    updateObject:{settings: {...obj}}
                };
                const result = await apiRequest("put",env.MILESTONE_STATUS,queryUpdate);
                if(result.status === 200){
                    $toast.success(t("Toast.Project_milestone_status_added_successfully"), { position: 'top-right' });
                    commit("settings/mutateProjectMilestoneStatus", {data:obj,op:'added'});
                }else{
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                }
                isSpinner.value = false;
            } catch (error) {
                isSpinner.value = false;
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                console.error('Error in adding the milestone status',error);
            }
        }
        else {
            if(arrayobject.value[valueindex.value].name == formData.value.milestone_status.value &&
                arrayobject.value[valueindex.value].backgroundColor == formData.value.colorvalue &&
                arrayobject.value[valueindex.value].isFuture == isFuture.value &&
                arrayobject.value[valueindex.value].isPast == isPast.value){
                    return $toast.error(t('Toast.Nothing_to_update'), { position: 'top-right' });
            }
            let sIndex = arrayobject.value.findIndex((elem) => {
                return (elem.name.replaceAll(" ","").toLowerCase() == formData.value.milestone_status.value.replaceAll(" ","").toLowerCase() && elem.value !== arrayobject.value[valueindex.value].value)
            })

            if (sIndex <= -1) {
                arrayobject.value[valueindex.value].name = formData.value.milestone_status.value;
                arrayobject.value[valueindex.value].backgroundColor = formData.value.colorvalue;
                arrayobject.value[valueindex.value].isFuture = isFuture.value;
                arrayobject.value[valueindex.value].isPast = isPast.value;
                try {
                    const queryUpdate = {
                        key: "$set",
                        updateObject: { 'settings.$[elementIndex]': arrayobject.value[valueindex.value] },
                        arrayFilters: [ { "elementIndex.value": arrayobject.value[valueindex.value].value } ]
                    };
                    const result = await apiRequest("put",env.MILESTONE_STATUS,queryUpdate);
                    if(result.status === 200){
                        $toast.success(t("Toast.Project_milestone_status_updated_successfully"), { position: 'top-right' });
                        commit("settings/mutateProjectMilestoneStatus", {data:arrayobject.value[valueindex.value],op:'modified'});
                    }else{
                        $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                    }
                    isSpinner.value = false;
                } catch (error) {
                    isSpinner.value = false;
                    console.error('Error in editing the milestone status',error);
                    $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                    
                }
            } else {
                formData.value.milestone_status.error = ('Name already exists')
                return;
            }
        }

        formData.value.milestone_status.value = ''
        isFuture.value = false
        isPast.value = false
        document.getElementById("pastdate").checked = false;
        document.getElementById("futuredate").checked = false;
        rename.value = false;
        formData.value.colorvalue='#818181'
    }

    /// Edited milestone status field function ////
    function EditData(index) {
        const obj = arrayobject.value[index]
        valueindex.value = index
        formData.value.milestone_status.value = obj.name
        formData.value.colorvalue = obj.backgroundColor
        isFuture.value = obj.isFuture
        isPast.value = obj.isPast
        document.getElementById("pastdate").checked = isPast.value;
        document.getElementById("futuredate").checked = isFuture.value;
        rename.value = true;

    }
    // All Fields Are Empty //
    function cancel() {
        formData.value.milestone_status.value = ''
        isFuture.value = false
        isPast.value = false
        document.getElementById("pastdate").checked = false;
        document.getElementById("futuredate").checked = false;
        rename.value = false;
        formData.value.milestone_status.error = ''
        formData.value.colorvalue='#818181'
    }
    // Delete Selected Status //
    function deletetask(index){
        showConfirmModal.value = true;
        selectedvalue.value =index
    }
    // Delete milestoneStatus
    async function DeleteData() {
        try {
            isSpinner.value = true;
            const deleteMilestone = arrayobject.value[selectedvalue.value];
            const queryUpdate = {
                key:"$pull",
                updateObject:{ settings: {value:deleteMilestone.value} },
            };
            const result = await apiRequest("put", env.MILESTONE_STATUS, queryUpdate);
            
            if(result.status === 200){
                $toast.success(t("Toast.Project_milestone_status_Deleted_successfully"), { position: 'top-right' });
                commit("settings/mutateProjectMilestoneStatus", {data:deleteMilestone,op:'removed'});
            }else{
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });    
            }
            isSpinner.value = false;
            showConfirmModal.value = false;
        } catch (error) {
            isSpinner.value = false;
            showConfirmModal.value = false;
            console.error("Error in deleting the milestone status");
            $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
        }
    }
</script>

<style scoped>
@import './style.css';
.style-scroll::-webkit-scrollbar {
    height: 4px;
}
.input__color-value{
    height: 25px !important;
}
.milestone__value-input{
    width:264px !important;
    color: var(--ink-2) !important;
}
</style>