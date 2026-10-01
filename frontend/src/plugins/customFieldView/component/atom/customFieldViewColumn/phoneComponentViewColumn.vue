<template>
    <div class="custom_field_label formkit__content-view-column" v-if="renderMask">
        <FormKit
            v-if="renderMask && maskValue && props.detail?._id === props?.customFieldId"
            :mask="maskValue"
            :type="'mask'"
            :id="Id"
            v-model="inputValue"
            @blur="handleBlur"
            autocomplete="off"
            :plugins="[inputUpdateValue]"
        >
            <template #prefix>
                <DropDown themed mode="listbox" v-if="checkCountrySelect && checkCountrySelect.length" @isVisible="search='',allCountriesArray = allCountries, addListener()" :id="'security'+makeUniqueId(6)">
                    <template #button>
                        <div ref="outSideClick" @click="handleClick()" class="d-flex align-items-center align-items-center justify-content-between">
                            <span class="ah-sr-only">{{$t('CustomField.country_code')}}</span>
                            <div class="d-flex align-items-center">
                                <div v-if="props?.detail?.fieldCountryObject" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                            </div>
                        </div>
                    </template>
                    <template #search>
                        <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                    </template>
                    <template #options>
                        <div v-if="allCountriesArray && allCountriesArray.length">
                            <DropDownOption v-for="(Country,index) in allCountriesArray" :key="index" :selected="Country.code.toLowerCase() === flag?.toLowerCase()" @click="handleUpdate(Country)">
                                <div class="d-flex align-items-center">
                                    <div :class="`vti__flag ${Country.code.toLowerCase()}`" ></div>
                                    <p class="ownEveryone">{{Country.en}}</p>
                                </div>
                            </DropDownOption>
                        </div>
                        <div class="text-center p-3px" v-else>
                            {{$t('CustomField.no_country_found')}}
                        </div>
                    </template>
                </DropDown>
                <DropDown themed mode="listbox" @isVisible="search='',allCountriesArray = allCountries" v-else-if="!(checkCountrySelect && checkCountrySelect.length) && props?.detail?.fieldCode && props?.detail?.fieldCountryCode && props?.detail?.fieldCode !== props?.detail?.fieldCountryCode" :id="'security'+makeUniqueId(6)">
                    <template #button>
                        <div ref="outSideClick" @click="handleClick()" class="d-flex align-items-center align-items-center justify-content-between phone_pipeline">
                            <span class="ah-sr-only">{{$t('CustomField.country_code')}}</span>
                            <div class="d-flex align-items-center mr-12px">
                                <div v-if="props?.detail?.fieldCountryObject" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                                <p class="font-size-14 font-weight-400">{{code}}</p>
                            </div>
                            <div class="w-9">
                                <img class="rotate-z-90" :src="dropDownArrow" alt="">
                            </div>
                        </div>
                    </template>
                    <template #search>
                        <input type="text" class="customfield__form-control" :placeHolder="$t('PlaceHolder.search')" v-model="search" @input="handleInput">
                    </template>
                    <template #options>
                        <div v-if="allCountriesArray && allCountriesArray.length && (allCountriesArray).filter((x)=>x.code === props.detail.fieldFlag || x.code === props.detail.fieldCountryObject.code).length">
                            <DropDownOption v-for="(Country,index) in (allCountriesArray).filter((x)=>x.code === props.detail.fieldFlag || x.code === props.detail.fieldCountryObject.code)" :key="index" :selected="Country.code.toLowerCase() === flag?.toLowerCase()" @click="handleUpdate(Country)">
                                <div class="d-flex align-items-center">
                                    <div :class="`vti__flag ${Country.code.toLowerCase()}`" ></div>
                                    <p class="ownEveryone">{{Country.en}}</p>
                                </div>
                            </DropDownOption>
                        </div>
                        <div class="text-center p-3px" v-else>
                            {{$t('CustomField.no_country_found')}}
                        </div>
                    </template>
                </DropDown>
                <div v-else>
                    <div ref="outSideClick" @click="handleClick()" class="d-flex align-items-center align-items-center justify-content-between phone_pipeline">
                        <div class="d-flex align-items-center">
                            <div v-if="props?.detail?.fieldCountryObject" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
                            <p class="font-size-14 font-weight-400">{{code}}</p>
                        </div>
                    </div>
                </div>
            </template>
        </FormKit>
        <span
            v-else
            class="text-ellipse d-block text-center cursor-pointer"
            :title="props.detail?.fieldValue ? props.detail?.fieldValue : ''"
            @click="emit('handleClick')"
        >
            <div v-if="props?.detail?.fieldCountryObject && props.detail?.fieldValue" :class="`vti__flag ${flag?.toLowerCase()}`" ></div>
            {{props.detail?.fieldValue ? props.detail?.fieldValue : '-'}}
        </span>
    </div>
</template>
<script setup>
    import { FormKit } from '@formkit/vue';
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
    import { useCustomComposable } from "@/composable";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue';
    import allCountries from "@/components/molecules/PhoneComponent/allCountry.js";
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue';

    const {makeUniqueId} = useCustomComposable();

    // props
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        },
        customFieldId:{
            type:String,
            default:''
        }
    });
    
    //EMIT
    const emit = defineEmits(['blurUpdate','inputUpdate','handleUpdate','outSideClick']);

    // ref
    const code = ref('');
    const prev = ref('');
    const flag = ref('');
    const search = ref('');
    const renderMask = ref(true);
    const Id = ref(makeUniqueId(5));
    const allCountriesArray = ref(allCountries);
    const maskValue = ref('');
    const inputValue = ref('');
    const checkCountrySelect = ref([]);
    const checkValue = ref('');
    const dropDownToggle = ref(false);
    const outSideClick = ref();

    // Image
    const dropDownArrow = require('@/assets/images/svg/triangleBlack.svg');

    // watch
    watch(()=> props.detail?.fieldCountryObject?.maskWithDialCode,(val) =>{
        if(!props.detail?.fieldCode){
            renderMask.value = false;
            setTimeout(()=>{
                maskValue.value = val;
                code.value = props?.detail?.fieldCode ? props?.detail?.fieldCode : props?.detail?.fieldCountryCode;
                flag.value = props.detail?.fieldFlag ? props?.detail?.fieldFlag?.toLowerCase() : props?.detail?.fieldCountryObject?.code?.toLowerCase() ;
                renderMask.value = true;
            });
        }
    });

    watch(()=> props?.detail?.fieldValue, (newValue) => {
        prev.value = newValue
    }, { deep: true });

    watch(()=> props.detail?.fieldPattern, (newValue) => {
        maskValue.value = newValue;
    }, { deep: true });

    watch(()=> props?.detail?.fieldCountrySelect, (newValue) => {
        checkCountrySelect.value = newValue
    }, { deep: true });

    watch(()=> props?.customFieldId, (newValue) => {
        if(newValue){
            if(props.detail?._id === props?.customFieldId){
                renderMask.value = false;
                Id.value = makeUniqueId(5);
                nextTick(()=>{
                    maskValue.value = props.detail?.fieldPattern ? props.detail?.fieldPattern : props.detail?.fieldCountryObject?.maskWithDialCode;
                    inputValue.value = props?.detail?.fieldValue || '';
                    code.value = props?.detail?.fieldCode ? props?.detail?.fieldCode : props?.detail?.fieldCountryCode;
                    flag.value = props.detail?.fieldFlag ? props?.detail?.fieldFlag?.toLowerCase() : props?.detail?.fieldCountryObject?.code?.toLowerCase() ;
                    checkCountrySelect.value = props?.detail?.fieldCountrySelect && props?.detail?.fieldCountrySelect.length ? props?.detail?.fieldCountrySelect : [];
                    renderMask.value = true;
                    setTimeout(()=>{
                        document.getElementById(`${Id.value}`).focus();
                        addListener();
                    })
                })
            }else{
                setTimeout(()=>{
                    removeListener();
                })
            }
        }else{
            setTimeout(()=>{
                removeListener();
            })
        }
    });

    function addListener() {
        document.addEventListener("click", listener)
    }
    function removeListener() {
        document.removeEventListener("click", listener)
    }

    function listener(e) {
        const container = document.getElementById(Id.value);
        if(!container?.contains(e?.target)) {
            emit("outSideClick");
        }
    }

    //onMounted
    onMounted(()=>{
        renderMask.value = false;
        nextTick(()=>{
            maskValue.value = props.detail?.fieldPattern ? props.detail?.fieldPattern : props.detail?.fieldCountryObject?.maskWithDialCode;
            inputValue.value = props?.detail?.fieldValue || '';
            code.value = props?.detail?.fieldCode ? props?.detail?.fieldCode : props?.detail?.fieldCountryCode;
            flag.value = props.detail?.fieldFlag ? props?.detail?.fieldFlag?.toLowerCase() : props?.detail?.fieldCountryObject?.code?.toLowerCase() ;
            checkCountrySelect.value = props?.detail?.fieldCountrySelect && props?.detail?.fieldCountrySelect.length ? props?.detail?.fieldCountrySelect : [];
            renderMask.value = true;
        });
    });

    onBeforeUnmount(() => {
        removeListener();
    })

    const handleUpdate = (val) => {
        emit('blurUpdate',val,props.detail,Id.value,true);
        renderMask.value = false;
        nextTick(()=>{
            maskValue.value = val.maskWithDialCode;
            inputValue.value = "";
            prev.value = "";
            code.value = val.dialCode;
            flag.value = val.code;
            search.value = "";
            renderMask.value = true;
        });   
    };
    
    const handleBlur = () => {
        emit('blurUpdate',checkValue.value,props.detail,Id.value); 
    };

    const inputUpdateValue = (node) => {
        node.hook.input((value,next)=>{
            checkValue.value = next(value);
            emit('inputUpdate',next(value))
            return next(value);
        });
    };
    const handleInput = () => {
        allCountriesArray.value = allCountries;
        if(search.value){
            const filters = allCountriesArray.value.filter(x => x.en.toLowerCase().includes(search.value.toLowerCase()) || x.dialCode.includes(search.value));
            allCountriesArray.value = filters;
        }
    }

    const handleClick = () => {
        removeListener();
        dropDownToggle.value = true;
    }
</script>