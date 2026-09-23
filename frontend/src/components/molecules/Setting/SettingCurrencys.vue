<template>
    <div>
        <h2 class="task_priority_wrapper_value">{{ $t('Settings.currencies') }}</h2>
        <template v-if="currencyArray && currencyArray.length">
            <div class="mySettingSection priorityWrapper">
                <button type="button" class="blue_btn" id="blue_btn" @click="isVisible = true" v-if="checkPermission('project.project_milestone') === true">{{ $t('Settings.add_remove_cur') }}</button>
                <template v-if="removedOption && removedOption.length">
                    <div class="addExtentionWrapper">
                        <span class="font_family_status currencies_wrapper_setting" v-for="(currency,index) in removedOption" :key="index">
                            {{currency.name}}
                        </span>
                    </div>
                </template>
            </div>
            <Sidebar
                v-model:visible="isVisible"
                :title="$t('Settings.currencies')"
                :enable-search="true"
                :options="option"
                :multiSelect="true"
                :showClear="false"
                :listenKeys="true"
                @selected="handleSelect"
                @removed="handleRemove"
                :value="removedOption"
                :isDefault="true"
            ></Sidebar>
        </template>
    </div>
</template>

<script setup>
    // import 
    import { useStore } from "vuex";
    import { useI18n } from "vue-i18n";
    import * as env from '@/config/env';
    import { useToast } from "vue-toast-notification";
    import { ref, computed, inject, watch } from "vue";
    import { useCustomComposable } from '@/composable';
    import { apiRequest } from '../../../services/index';
    import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
    const { t } = useI18n();
    const { checkPermission } = useCustomComposable();
    // getter
    const $toast = useToast();
    const { getters,commit } = useStore();
    //inject
    const companyId = inject("$companyId");
    // variable
    const isVisible = ref(false);
    // computed
    const currencyArray = ref(getters['settings/allCurrencyArray']);
    const option = computed(()=>{
        if(currencyArray.value && currencyArray.value.length){
            let filterCurency = JSON.parse(JSON.stringify(currencyArray.value));
            const currency = filterCurency.map((x)=> ({
                ...x,
                label: x.name,
                value:x.code
            }))
            return currency.sort((a, b) => {
                const labelComparison = (a.label?.trim()?.toLowerCase() > b.label?.trim()?.toLowerCase()) ? 1 : -1;
                
                if (a.isDelete && !b.isDelete) {
                    return -1;
                } else if (!a.isDelete && b.isDelete) {
                    return 1;
                } else {
                    return labelComparison;
                }
            });
        }else{
            return [];
        }
    });
    const removedOption = computed (() => {
        if(currencyArray.value && currencyArray.value.length){
            let filterCurency = JSON.parse(JSON.stringify(currencyArray.value));
            const currency = filterCurency.filter((xt)=> xt.isDelete === true).map((x)=> ({
                ...x,
                label: x.name,
                value:x.code
            }));
            return currency.sort((a, b) => {
                const labelComparison = (a.label?.trim()?.toLowerCase() > b.label?.trim()?.toLowerCase()) ? 1 : -1;
                
                if (a.isDelete && !b.isDelete) {
                    return -1;
                } else if (!a.isDelete && b.isDelete) {
                    return 1;
                } else {
                    return labelComparison;
                }
            });
        }else{
            return [];
        }
    });
    watch(() => getters['settings/allCurrencyArray'], (newVal) => {
        currencyArray.value = newVal;
    });

    // function
    const handleSelect = (item) => {
        updateFunction(item,true);
    };
    const handleRemove = (item) => {
        updateFunction(item,false);
    };
    const updateFunction = async(item,action) =>{
        try {
            let updateObject = {
                updateObject:{
                    isDelete: action
                },
                key:'$set'
            };
            await apiRequest("put",`${env.CURRENCY}/${companyId.value}/${item._id}`,updateObject).then(() => {
                if(action === true){
                    currencyArray.value = currencyArray.value.map((x)=> x._id === item._id ? {...x, isDelete: action } : x);
                    $toast.success(t("Toast.Currency_added_successfully"),{position: 'top-right'});
                }else{
                    currencyArray.value = currencyArray.value.map((x)=> x._id === item._id ? {...x, isDelete: action } : x);
                    $toast.success(t("Toast.Currency_removed_successfully"),{position: 'top-right'});
                }
                commit("settings/setCurrencyArray", {data:currencyArray.value,op:'inital'});
            }).catch((error) => {
                $toast.error(t('Toast.something_went_wrong'), { position: 'top-right' });
                console.error("ERROR in currency", error);
            });
        } catch (error) {
            console.error("ERROR in updating the currency", error);
        }
    };
</script>
<style scoped>
    .currencies_wrapper_setting {
        background: #ECEEF1;
        padding: 3.5px 10px !important;
        border-radius: 23px;
        margin: 0px 10px 10px 0px !important;
    }
</style>