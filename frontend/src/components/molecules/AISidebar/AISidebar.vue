<template>
    <div class="ai-sidebar-wrapper">
        <Sidebar width="923px" className="ai-sidebar" v-if="currentCompany?.planFeature?.aiPermission">
            <template #head-left>
                <div></div>
            </template>
            <template #head-mid>
                <div>
                    <div class="d-flex flex-column align-items-center">
                        <span class="font-size-22 font-weight-700 white text-center pb-20px head-title">{{$t("AI.ai_title")}}</span>
                        <input type="search" :placeHolder="`${$t('AI.ai_sidebar_placeholder')}`" class="ai-input" v-model="search">
                    </div>
                </div>
            </template>
            <template #head-right>
                <div @click="$emit('closeAi')" class="close-image d-flex align-items-center justify-content-center"><img src="@/assets/images/svg/delete.svg" /></div>
            </template>
            <template #body>
                <template v-if="!isSpinner">
                    <div class="ai-sidebar-body">
                        <template v-if="filterCategories.length">
                            <div v-for="(item, index) in filterCategories" :key="index" class="prompt-wrapper cursor-pointer">
                                <h3 class="p-10px">{{item.categoryName}}</h3>
                                <div class="flex-wrap d-flex prompt-listing">
                                    <div v-for="(prompt, index) in item.readMore ? filterPrompts.filter((x) => x.categoryRef === item.key) : filterPrompts.filter((x) => x.categoryRef === item.key).filter((x, index) => index < 9)" :key="index" class="prompt-div text-ellipsis font-size-12 font-weight-400 GunPowder" @click="openPromptDetail(prompt)">
                                        <span>{{prompt.title}}</span>
                                    </div>
                                    <span v-if="item.readMore ? false : prompts.filter((x) => x.categoryRef === item.key).length > 9" @click="readMoreFun(item)" class="prompt-div text-ellipsis font-size-12 font-weight-400 darkblue read-more-less">{{$t('AI.read_more')}}</span>
                                    <span v-if="item.readMore" class="prompt-div text-ellipsis font-size-12 font-weight-400 darkblue read-more-less" @click="item.readMore = false">{{$t('AI.read_less')}}</span>
                                </div>
                            </div>
                        </template>
                        <div v-else>
                            {{$t('Header.no_data_found')}}
                        </div>
                    </div>
                </template>
                <SpinnerComp v-else :is-spinner="isSpinner" />
            </template>
        </Sidebar>
        <Sidebar v-else-if="!currentCompany?.planFeature?.aiPermission" width="923px">
            <template #head-left>
                <span></span>
            </template>
            <template #head-right>
                <div @click="$emit('closeAi')" class="close-image d-flex align-items-center justify-content-center"><img src="@/assets/images/svg/delete.svg" /></div>
            </template>
            <template #body>
                <UpgradePlan
                :buttonText="$t('Upgrades.upgrade_your_plan')"
                :lastTitle="$t('AI.to_unlock_ai')"
                :secondTitle="$t('Upgrades.unlimited')"
                :firstTitle="$t('Upgrades.upgrade_to')"
                :message="$t('Upgrades.the_feature_not_available')"
            />
            </template>
        </Sidebar>
        <PromptSidebar v-if="isOpenPromptDetail" @closePrompt="isOpenPromptDetail = false" :selectedPrompt="selectedPrompt" @closeMainSidebar="$emit('closeAi')" @closeAllSidebar="$emit('closeAi')" />
    </div>
</template>

<script setup>
import { onMounted, ref, computed} from 'vue'
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue";
import PromptSidebar from "@/components/molecules/PromptSidebar/PromptSidebar.vue"
import UpgradePlan from '@/components/atom/UpgradYourPlanComponent/UpgradYourPlanComponent.vue';
import { useStore } from "vuex";
import * as env from '@/config/env';
import { apiRequest } from '../../../services';
import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp'

const aiCategories = ref([]);
const prompts = ref([]);
const isOpenPromptDetail = ref(false);
const selectedPrompt = ref({});
// const selectedCategory = ref({});
// const readMore = ref(false);
const search = ref('');
const isSpinner = ref(false)

const { getters } = useStore();

const currentCompany = computed(() => getters["settings/selectedCompany"]);

onMounted(() => {
    isSpinner.value = true;
    apiRequest("post",env.GETAICATEGORY).then((result)=>{
        if(result.data.status === true){
            aiCategories.value = result.data.statusText;
        }
    }).catch(() => {
        isSpinner.value = false;
    })
    apiRequest("post",env.GETPROMPTS).then((result)=>{
        if(result.data.status === true){
            prompts.value = result.data.statusText;
            isSpinner.value = false;
        }else{
            isSpinner.value = false;
        }
    }).catch(() => {
        isSpinner.value = false;
    })
})

function openPromptDetail (data) {
    data.fields.forEach((x) => {
        if(x.type === 'text' || x.type === 'textArea'){
            x.value = '',
            x.error = ''
        }
    })
    isOpenPromptDetail.value = true;
    selectedPrompt.value = data;
}

function readMoreFun(item){
    item.readMore = true;
}

const filterPrompts = computed(() => {
    if(search.value){
        return prompts.value.filter(x => x.title.toLowerCase().includes(search.value.toLowerCase()));
    }else{
        return prompts.value
    }
})

const filterCategories = computed(() => {
    const categoryRefs = filterPrompts.value.map(prompt => prompt.categoryRef);
    let data = aiCategories.value.filter(category =>
        categoryRefs.includes(category.key)
    );
    return data;
})
</script>
<style>
.import_category{
    background: linear-gradient(104.48deg, var(--rail-ok) 2.11%, var(--brand) 53.8%, var(--agent) 100.06%);
    border: none;
    height: 30px;
}
.ai-sidebar-body{
    padding: 20px;
    background: var(--canvas);
    box-shadow: 0px 2px 12px 3px var(--shadow-ink);
}
.prompt-div{
    background: var(--surface);
    width: 100%;
    height: 38px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    /* width: calc(25% - 20px); */
    /* max-width: calc(25% - 20px); */
    margin: 0 0px 20px !important;
}
.prompt-wrapper{
    /* padding: 20px 5px;
    margin: 0 -10px; */
    width: 100%;
    box-sizing: content-box;
}
.ai-sidebar .sidebar-content .sidebar-head {
    height: 178px !important;
    background: linear-gradient(104.48deg, var(--rail-ok) 2.11%, var(--brand) 53.8%, var(--agent) 100.06%);
}
.ai-sidebar .close-image{
    text-align: center;
    width: 30px;
    height: 30px;
    background: var(--fill);
    position: absolute;
    top: 15px;
    right: 15px;
    border-radius: 5px;
}
.read-more-div{
    border: 1px solid var(--border);
    width: 106.14px;
    height: 88px;
    border-radius: 6px;
    text-align: center;
    margin: 0px 10px;
}
.ai-sidebar .ai-input{
    height: 44px;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 20px 10px 20px;
    font-family: var(--font-ui);
    font-weight: 400;
    color: var(--ink-2);
    font-size: 16px;
    width: 667px;
}

.ai-sidebar .sidebar-head div:nth-of-type(2) {
    width: 100%;
    margin-top: 10px;
}

.ai-sidebar .prompt-listing {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))    ;
    column-gap: 10px;
}

.read-more-less {
    border: 1px solid var(--brand);
}

@media (max-width:576px) {
    .ai-sidebar .head-title {
        max-width: 250px;
    }
}
</style>