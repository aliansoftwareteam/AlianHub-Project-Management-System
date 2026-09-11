<template>
    <DropDown :id="uniqueId" :bodyClass="{'countrycode__dropdown' : true}" @isVisible="checkDropdown">
        <template #button>
            <div class="dropdown">
                <span class="imageCountry text-ellipsis">
                <div class="vti__flag" :class="activeCountry?.isoCode.toLowerCase()"></div>
                <span :ref="uniqueId" v-if="enabledCountryCode" class="black activeCountrydialCode">+{{ activeCountry?.dialCode }}</span>
                </span>
                <img v-if="enabledArrowIcon" :src="arrow" alt="dropdown-arrow" class="dropdown-arrow">
            </div>
        </template>
        <template #head>
            <div>
                <InputText
                    v-model="search"
                    :place-holder="$t('PlaceHolder.search')"
                    type="text"
                    width="100%"
                    :isOutline="false"
                    class="border-0"
                    :style="[{paddingTop : clientWidth > 767 ? '10px !important' : '0 !important', paddingLeft : clientWidth > 767 ? '20px' : '0',}]"
                />
            </div>
        </template>
        <template #options>
            <DropDownOption
                v-for="(country, index) in sortedCountries"
                :key="'phone'+index"
                @click="$emit('onSelect', activeCountry),selectedComapany(country),$refs[uniqueId].click(),search = ''"
                :highlight="index === highlightIndex"
                :id="'item'+index"
            >
                <div class="d-flex align-items-center w-100">
                    <div  class="vti__flag" v-if="enabledFlags" :class="country?.isoCode.toLowerCase()" ></div>
                    <span class="text-ellipsis d-block ml-10px pr-7px" :style="[{maxWidth : clientWidth > 767 ? '100%' : '100%' }]">{{ country.name }}</span>
                    <span v-if="enabledCountryCode" :class="clientWidth <= 767 ? 'd-flex justify-content-end' : ''">+{{ country?.dialCode }}</span>
                </div>
            </DropDownOption>
        </template>
    </DropDown>
    
</template>

<script setup>
    import { defineComponent, onMounted, ref,defineEmits ,defineProps , computed , inject, nextTick, watch} from "vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { useCustomComposable } from "@/composable";
    import allCountries from "./allCountry.js";
    const arrow = require("@/assets/images/dropdownarrow.png")
    const {makeUniqueId} = useCustomComposable();
    const activeCountry = ref({isoCode:''});
    defineComponent({
        name: 'Phone-Component',
        components: {
            DropDown,
            DropDownOption
        }
    })
    const props =  defineProps({
        enabledCountryCode: {
            type: Boolean,
            default: false
        },
        enabledFlags: {
            type: Boolean,
            default: true
        },
        preferredCountries: {
            type: Array,
            default: () => []
        },
        enabledArrowIcon: {
            type: Boolean,
            default: false
        },
        phoneObj: {
            type: Object,
            default: () => {}
        }
    })
    const search = ref('');
    const emit = defineEmits(["onSelect"]);
    const clientWidth = inject("$clientWidth");
    const uniqueId = ref("")
    const highlightIndex = ref(0);

    onMounted(() => {
        uniqueId.value = `phoneCountry-${makeUniqueId()}`
        setTimeout(() => {
            const [initialCountry] = getCountries(props.preferredCountries);
            if (initialCountry) selectedComapany(initialCountry);
        }, 10);
    })      

    watch(() => props.phoneObj, (newValue) => {
        if(newValue){
            activeCountry.value = findCountry(newValue.isoCode);
        }
    })

    const filteredCountries = computed(() => {
        return allCountries;
    })

    const sortedCountries = computed(() => {
        if(search.value){
            return filteredCountries.value.filter(country => country.name.toLowerCase().includes(search.value.toLowerCase()));
        }else{
            const preferredCountries = getCountries(props.preferredCountries).map(country => ({ ...country }));
            return [...preferredCountries, ...filteredCountries.value];
        }
    });

    const getCountries = (list = []) => {
        return list.map(countryCode => findCountry(countryCode)).filter(Boolean);
    }

    const findCountry = (iso = "") => { 
        return allCountries.find(country => country.isoCode === iso.toUpperCase());
    }
    const selectedComapany = (country) => {
        activeCountry.value = country;
        emit("onSelect", activeCountry.value);
    }

    function startListener() {
        document.addEventListener("keydown", keyListener)
    }

    function stopListener() {
        document.removeEventListener("keydown", keyListener)
    }

    function keyListener(event) {
        if(event.keyCode === 13) { // Enter
            emit('onSelect', activeCountry.value),
            selectedComapany(sortedCountries.value[highlightIndex.value])
            let timeZoneInput = document.getElementById('item'+highlightIndex.value)
            timeZoneInput?.click();
            search.value= ''
            highlightIndex.value = 0;
        } else if(event.keyCode === 38){ // UP
            highlightIndex.value = highlightIndex.value > 0 ? highlightIndex.value-1 : 0;
            nextTick(() => {
                document.getElementById('item'+highlightIndex.value)?.scrollIntoView({behavior: "smooth", block: 'end'})
            })
        } else if (event.keyCode === 40){ // DOWN
            highlightIndex.value = highlightIndex.value < sortedCountries.value.length-1 ? highlightIndex.value+1 : sortedCountries.value.length-1;
            nextTick(() => {
                document.getElementById('item'+highlightIndex.value)?.scrollIntoView({behavior: "smooth", block: 'nearest', inline: 'start'})
            })
        }
    }

    function checkDropdown(e) {
        if(e) {
            startListener();
        } else {
            stopListener();
        }
    }
</script>
<style src="./style.css">
</style>