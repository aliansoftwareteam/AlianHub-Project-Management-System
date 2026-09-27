<template>
    <div class="mt-1 custom-field__bg" :class="[{'custom-field__height':props.planPermission === false && (!customFieldList || customFieldList?.filter((val)=>(val?.isDelete) && (val?.global || val?.projectId === props?.projectDetail?._id))?.length < 3)}]">
        <div class="d-flex justify-content-between mb-1" v-if="props.editPermission === true">
            <h5 class="font-ui text-right font-size-14 font-weight-700 font-normal black">{{$t('CustomField.custom_field')}}</h5>
            <h5 class="font-ui text-right font-size-14 font-weight-500 font-normal text-decoration-underline blue cursor-pointer" @click="emit('isCustomField',true)">+ {{$t('CustomField.custom_field')}}</h5>
        </div>
        <template v-if="customFieldList && customFieldList.length">
            <template v-for="(item, index) in customFieldList?.filter((val)=>(val?.isDelete) && (val?.type === 'project') && (val?.global || val?.projectId?.includes(props?.projectDetail?._id)))" :key="index">
                <div class="position-re custom__field_project_detail_wrapper" :class="[{'pointer-event-none':props.editPermission === false}]">
                    <component
                        :is="getView(item?.fieldType)"
                        @inputUpdate="(val)=> item.fieldValue = val"
                        @blurUpdate="handleEmit"
                        :detail="item"
                        @handleEdit="handleEdit(item)"
                        @handleUpdate="handleUpdate"
                        :isProjectDetail="true"
                    />
                </div>
            </template>
        </template>
    </div>
</template>

<script setup>
    import { useStore } from 'vuex';
    import { computed,watch, onMounted } from 'vue';
    import TextComponentListing from '../../atom/customFieldTaskView/textComponentListing.vue'
    import CheckboxComponentListing from '../../atom/customFieldTaskView/checkboxComponentListing.vue'
    import DropdownComponentListing from '../../atom/customFieldTaskView/dropdownComponentListing.vue'
    import DateComponentListing from '../../atom/customFieldTaskView/dateComponentListing.vue'
    import MoneyComponentListing from '../../atom/customFieldTaskView/moneyComponentListing.vue'
    import TextareaComponentListing from '../../atom/customFieldTaskView/textareaComponentListing.vue'
    import NumberComponentListing from '../../atom/customFieldTaskView/numberComponentListing.vue'
    import EmailComponentListing from '../../atom/customFieldTaskView/emailComponentListing.vue'
    import PhoneComponentListing from '../../atom/customFieldTaskView/phoneComponentListing.vue'


    const { getters } = useStore();
    const customFieldList = computed(() => (getters['settings/finalCustomFields'] && getters['settings/finalCustomFields'].length) ? getters['settings/finalCustomFields']: []);
    const props = defineProps({
        projectDetail:{
            type: Object,
            default: () => {}
        },
        editPermission:{
            type: [Boolean, Number],
            default: false
        },
        planPermission:{
            type: [Boolean, Number],
            default:false
        }
    })
    const emit = defineEmits(['blurUpdate','isCustomField','editCustomField']);
    // const clientWidth = inject("$clientWidth");
    // watch
    watch(() => getters['settings/finalCustomFields'],(val) => {
        customFieldList.value = val;
    });

    onMounted(()=>{
        manageCustomField(customFieldList.value);
    });
    watch(() => props.projectDetail,(newValue,oldValue) => {
        if(newValue?._id !== oldValue?._id){
            manageCustomField(customFieldList.value);
        }
    });
    
    // function
    const manageCustomField = (data) => {
        if (!(data && data.length)) {
            return;
        }
        if(props.projectDetail && props.projectDetail?.customField && Object.keys(props.projectDetail?.customField)?.length){
            customFieldList.value.forEach((val,index)=>{
                if(props.projectDetail?.customField[val._id]){
                    customFieldList.value[index] = {
                        ...val,
                        fieldValue:props.projectDetail?.customField[val._id]?.fieldValue,
                        fieldCode:props.projectDetail?.customField[val._id]?.fieldCode || '',
                        fieldPattern:props.projectDetail?.customField[val._id]?.fieldPattern || '',
                        fieldFlag:props.projectDetail?.customField[val._id]?.fieldFlag || ''
                    };
                }else{
                    delete val?.fieldValue
                    delete val?.fieldCode
                    delete val?.fieldPattern
                    delete val?.fieldFlag
                    customFieldList.value[index] = val;
                }
            });
        }else{
            if(data && data.length){
                data.forEach((val)=>{
                    delete val?.fieldValue;
                    delete val?.fieldCode;
                    delete val?.fieldPattern;
                    delete val?.fieldFlag;
                });
            }
            customFieldList.value = data;
        }
    };
    

    const handleEdit = (val) => {
        emit("editCustomField",val);
    };
    const handleUpdate = (value,detail,id) => {
        emit('blurUpdate',value,detail,id,true);
    };

    const getView = (val) => {
        switch(val){
            case 'text':
                return TextComponentListing
            case 'checkbox':
                return CheckboxComponentListing
            case 'dropdown':
                return DropdownComponentListing
            case 'date':
                return DateComponentListing
            case 'money':
                return MoneyComponentListing
            case 'textarea':
                return TextareaComponentListing
            case 'number':
                return NumberComponentListing
            case 'email':
                return EmailComponentListing
            case 'phone':
                return PhoneComponentListing
        }
    };

    const handleEmit = (value,detail,id) => {
        if(value && detail?.fieldType === 'phone'){
            let index = customFieldList.value.findIndex((x)=>x._id === detail._id);
            if(index > -1){
                customFieldList.value[index].fieldValue = value;
                detail.fieldValue = value;
            }
        }
        emit('blurUpdate',value,detail,id);
    };
</script>
<style>
    @import '../customFieldTaskView/style.css';
</style>