<template>
    <div class="bg-light-gray h-100">
        <div class="border-bottom p-10px">
            <InputText
                v-model="searchText"
                :placeholder="`${$t('Projects.search')}...`"
            />
        </div>
        <div class="overflow-y-auto  filter__chat-wrapper" @scroll="checkScroll">
            <Transition>
                <div v-if="!loading">
                    <div v-if="data?.length">
                        <TransitionGroup>
                            <Comment
                                v-for="item in data" :key="item._id"
                                :message="item"
                                :mainChat="mainChat"
                                @highlight="''"
                                :showOptions="false"
                                :showUser="!item.sent"
                            />
                        </TransitionGroup>
                        <template v-if="loading">
                            <Skelaton v-for="i in 5" :key="i" class="border-radius-5-px w-auto m-5px skelaton__loading-data"/>
                        </template>
                    </div>
                    <div v-else class="text-center">
                        <span class="cursor-default text-center font-weight-normal d-block mt-1">{{$t('Header.no_data_found')}}</span>
                    </div>
                </div>
                <div v-else-if="!props.searchOnMount && loading" class="text-center">
                    <img :src="noProjectsIcon" class="mt-2 w-70"/>
                    <h3 class="m-0">{{$t('Header.search_results')}}</h3>
                </div>
            </Transition>
        </div>
    </div>
</template>

<script setup>
// PACKAGES
import { 
    inject,
    nextTick,
    // inject, nextTick, 
    onMounted, ref, watch 
} from "vue"
import { useCustomComposable } from "@/composable";

// COMPONENTS
import Comment from "@/components/organisms/Comment/Comment.vue";
import InputText from "@/components/atom/InputText/InputText.vue"
import Skelaton from "@/components/atom/Skelaton/Skelaton.vue"
import * as env from '@/config/env';
import { apiRequest } from "@/services";

// UTILS
// const companyId = inject("$companyId");
const userId = inject("$userId");
const {debounce} = useCustomComposable();

// IMAGES
const noProjectsIcon = require("@/assets/images/svg/No-Search-Result.svg");

const props = defineProps({
    searchOnMount: {
        type: Boolean,
        default: true
    },
    mainChat: {
        type: Boolean,
        default: false
    },
    per_page: {
        type: Number,
        default: 35
    },
    projectId: {
        type: String,
    },
    sprintId: {
        type: String
    },
    taskId: {
        type: String
    },
    isPinnedMessage: {
        type: Boolean
    }
})

const page = ref(1);
const searchText = ref("");
const data = ref([]);

const loading = ref(true);

onMounted(() => {
    page.value = 1;
    if(props.searchOnMount) {
        getTypesenseData(true);
    }
})

watch(searchText, debounce(() => {
    page.value = 1;
    if(props.searchOnMount) {
        getTypesenseData(true);
    } else {
        if(searchText.value?.trim()?.length) {
            getTypesenseData(true);
        } else {
            loading.value = true;
            data.value = [];
        }
    }
}, 1000))

const checkScroll = debounce((e) => {
    if(e.target.scrollTop >= (e.target.scrollHeight - e.target.clientHeight) - 200) {
        getTypesenseData();
    }
}, 500)

function hightlight(msg, wrapStart = `<b class="mentioned">`, wrapEnd = `</b>`) {
    const mentionRegex = /@\[[\w ]+?\]\(\w{4,30}\)/gi;
    let mentions = msg.match(mentionRegex);

    if(mentions !== null) {
        mentions.forEach((mention) => {
            msg = msg.replace(mention, `${wrapStart}@${mention.split("]")[0].replace("@[", "")}${wrapEnd}`)
        })
    }
    if(searchText.value){
        // AHE-3834 — escape regex metacharacters. A search containing `(`, `[`, `*`
        // etc. previously threw inside RegExp and silently killed the highlight.
        const escaped = searchText.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return msg.replace(regex, '<mark>$1</mark>');
    }else{
        return msg;
    }
}

function getTypesenseData(reset = false) {
    if(!page.value) {
        return;
    }
    loading.value = true;
    if(reset) {
        data.value = [];
    }

    const url = `${env.API_COMMENTS}/get-searched-messages?` +
            `searchText=${searchText.value}` +
            `&projectId=${props.projectId}` +
            `&sprintId=${props.sprintId}` +
            `&taskId=${props.taskId}` +
            `&isPinnedMessage=${props.isPinnedMessage}` +
            `&skip=${props.per_page*(page.value - 1)}` +
            `&limit=${props.per_page}`;

    apiRequest("get", url).then((response) => {
        const results = response.data;

        if (results.data.length) {
            let messages = results.data.map((x) => {
                let messageData = x;
                messageData.sent = userId.value === messageData.userId;
                if(["text", "link"].includes(messageData.type)) {
                    messageData.overflow = messageData.message.length > 465;
                    messageData.message = hightlight(messageData.message);
                }

                return messageData;
            })
            data.value = [
                ...data.value,
                ...messages
            ]

            if(data.value.length === results.data.length) {
                page.value = null;
            } else {
                page.value += 1;
            }
        }

        nextTick(() => {
            loading.value = false;
        });
    })
    .catch((error) => {
        nextTick(() => {
            loading.value = false;
        });
        console.error(`Error in getTypesenseData hook => ${error}`);
    })
}
</script>

<style lang="css">
.v-enter-active,
.v-leave-active {
  transition: all 0.2s ease;
}
.v-enter-from,
.v-leave-to {
  opacity: 0;
}
.filter__chat-wrapper{
    max-height: calc(100% - 52px);
}
.skelaton__loading-data{
    height: 35px;
}
</style>