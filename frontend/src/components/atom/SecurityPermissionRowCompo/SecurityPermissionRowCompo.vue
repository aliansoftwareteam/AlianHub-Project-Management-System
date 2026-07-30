<template>
    <tr v-if="item.key === 'artificial_intelligence' && !currentCompany?.planFeature?.aiPermission">
        <td :colspan="withoutOwnerRoles.length">
            <div class="d-flex justify-content-center align-items-center flex-column">
                <img :src="upgradePlan">
                <h2>{{$t('AI.please_upgrade_plan_to_use_ai')}}</h2>
                <div>
                    <button @click="router.push({name: 'Upgrade', params: {cid: companyId}})" class="cursor-pointer font-size-16 font-weight-400 text-center line-height-23-68 black white bg-dark-green-light border-0 border-radius-4-px p3x-14px">
                        {{$t('Upgrades.upgrade_your_plan')}}
                    </button>
                </div>
            </div>
        </td>
    </tr>
    <tr v-else class="hover_securtiy_permisson">
        <td class="position-sti z-index-1 actionListName">
            <label :style="`font-weight: ${!item.isParent ? '400' : '600'}`">
                {{ $t(`SecurityAndPermission.${item.key}`)}}
            </label>
            <p>{{item.desc}}</p>
        </td>
        <td v-for="(hItem, hIndex) in withoutOwnerRoles.filter((x) => x.key !== 2)" :key="hIndex">
            <div class="d-flex justify-content-around">
                <template v-for="(permission, pIndex) in permissions">
                    <div class="securityPermission__equalCell" v-if="item.key !== 'milestone_report' && (advancedPermissionBody.filter((x) => !item.isParent && item.parentId === x._id && x.key === 'sheet_settings').length || item.key === 'task_estimated_hours' || item.key === 'show_tasks') || (item.key === 'per_user_generate_limit' && pIndex === 2) || item.selectionField === true" :key="`${hIndex}_${permission.key}'_${bIndex}_${pIndex}`">
                        <template v-if="pIndex === 0 && item.key !== 'per_user_generate_limit'">
                            <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-if="item.roles.filter((x) => x.key === hItem.key)[0].disabled"/>
                            <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-else @click="changeRule(permission.key, item, hItem)" :checked="item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission === permission.key" :name="hItem.name+bIndex+permission.key" :value="permission.key"/>
                        </template>
                        <template v-else-if="pIndex === 1 && item.key === 'task_estimated_hours'">
                            <!-- Read column for Task Estimated Hours. This row previously
                                 rendered only None (pIndex 0) and the Own/Everyone selector
                                 (pIndex 2), leaving the Read cell empty so the level could
                                 never be granted. The value scheme has room for it:
                                 None = null, Read = false, Own = 1, Everyone = 2. The API
                                 already treats false as read-only (permissionGuard.js
                                 isWritable/isReadable) and the task detail shows the field
                                 whenever the permission !== null, so only this radio was
                                 missing. Gated on this key so no other selection-field
                                 row gains a Read option. -->
                            <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-if="item.roles.filter((x) => x.key === hItem.key)[0].disabled"/>
                            <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-else @click="changeRule(permission.key, item, hItem)" :checked="item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission === permission.key" :name="hItem.name+bIndex+permission.key" :value="permission.key"/>
                        </template>
                        <template v-else-if="pIndex === 2">
                            <template v-if="item.key === 'per_user_generate_limit'">
                                <InputText
                                    :modelValue="item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission || 0"
                                    type="text"
                                    :inputId="`per_user_limit_${hItem.key}`"
                                    @keyup="inputValidation($event.event)"
                                    @paste="inputValidation($event.event)"
                                    @input="changeRule(Number($event.event.target.value),item,hItem)"
                                    @keypress="onlyNumber($event.event),inputValidation($event.event)"
                                    :min="minLimit"
                                    :max="maxLimit"
                                    class="amountCurr text-center"
                                    :isDisabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled"
                                ></InputText>
                            </template>
                            <template v-else>
                                <DropDown :options="planCondition ? true : false" :id="'security'+makeUniqueId(6)"  v-if="!item.roles.filter((x) => x.key === hItem.key)[0].disabled">
                                    <template #button>
                                        <div class="d-flex align-items-center justify-content-center securitydropdown">
                                        <a class="a-icon" href.prevent>
                                                {{
                                                    item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission === 1 ?
                                                    $t('Permissions.own'):
                                                    item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission === 2 ?
                                                    $t('Projects.everyone') : $t('Permissions.select')
                                                }}
                                            </a>
                                        </div>
                                    </template>
                                    <template #options v-if="planCondition">
                                        <DropDownOption @click="changeRule(1, item, hItem)">
                                            <div class="d-flex align-items-center">
                                                <span class="ownEveryone">{{$t('Permissions.own')}}</span>
                                            </div>
                                        </DropDownOption>
                                        <DropDownOption  @click="changeRule(2, item, hItem)">
                                            <div class="d-flex align-items-center">
                                                <span class="ownEveryone">{{$t('Projects.everyone')}}</span>
                                            </div>
                                        </DropDownOption>
                                    </template>
                                </DropDown>
                                <div class="selectOption" v-else>
                                    {{$t('Permissions.select')}}
                                </div>
                            </template>
                        </template>
                    </div>
                    <div v-else-if="item.key !== 'per_user_generate_limit'" :key="`${hIndex}_${permission.key}'_${bIndex}_${pIndex}`" class="securityPermission__equalCell">
                        <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-if="item.roles.filter((x) => x.key === hItem.key)[0].disabled"/>
                        <input type="radio" :disabled="!planCondition || item.roles.filter((x) => x.key === hItem.key)[0].disabled" v-else @click="changeRule(permission.key, item, hItem)" :checked="item.roles.filter((x) => x.key === hItem.key).length && item.roles.filter((x) => x.key === hItem.key)[0].permission === permission.key" :name="hItem.name+bIndex+permission.key" :value="permission.key"/>
                    </div>
                </template>
            </div>
        </td>
    </tr>
</template>
<script setup>
    import { defineProps, computed} from "vue";
    import DropDown from '@/components/molecules/DropDown/DropDown.vue'
    import DropDownOption from '@/components/molecules/DropDownOption/DropDownOption.vue'
    import InputText from '@/components/atom/InputText/InputText.vue';
    import { useCustomComposable } from "@/composable";
    // import { ValidationFunction } from "@/composable/DefaultValidationFunction";
    import { useStore } from 'vuex';
    import { useRouter } from "vue-router";
    const {makeUniqueId} = useCustomComposable();
    defineProps({
        item: {
            type: Object,
        },
        withoutOwnerRoles: {
            type: Array,
        },
        permissions: {
            type: Array,
        },
        advancedPermissionBody: {
            type: Array,
        },
        changeRule: {
            type: Function,
        },
        bIndex: {
            type: Number,
        },
        planCondition:{
            type:Boolean,
            default:false
        }
    })
    const {getters} = useStore();

    const currentCompany = computed(() => getters["settings/selectedCompany"]);
    const upgradePlan = require("@/assets/images/png/upgradePlan.png");
    const router = useRouter();

    function onlyNumber(event) {
        const char = String.fromCharCode(event.keyCode);
        const input = event.target.value;
        if (!/[\d-]/.test(char)) {
            event.preventDefault();
        }
        if (char === '-' && (input.indexOf('-') !== -1 || event.target.selectionStart !== 0)) {
            event.preventDefault();
        }
    }
    const maxLimit = computed(() => {
        if(currentCompany.value?.planFeature?.aiRequest === undefined){
            return 0;
        }
        if(currentCompany.value?.planFeature?.aiRequest === null){
            return null;
        }else{
           return currentCompany.value?.planFeature?.aiRequest;
        }
    })

    const minLimit = computed(() => {
        if(currentCompany.value?.planFeature?.aiRequest === undefined){
            return 0;
        }
        if(currentCompany.value?.planFeature?.aiRequest === null){
            return -1;
        }else{
           return 0;
        }
    })

    function inputValidation (event) {
        const inputValue = Number(event?.target.value);
        if(maxLimit.value === null){
            if(parseInt(inputValue) < minLimit.value){
                event.preventDefault();
                event.target.value = minLimit.value;
            }
        }else{
            if (parseInt(inputValue) > maxLimit.value) {
                event.preventDefault();
                event.target.value = maxLimit.value;
            } else if (parseInt(inputValue) < minLimit.value) {
                event.preventDefault();
                event.target.value = minLimit.value;
            }
        }
    }
</script>
<style src="./style.css">
</style>