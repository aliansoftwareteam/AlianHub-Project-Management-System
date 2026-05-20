<template>
    <Sidebar :hideHeader="true" :title="title" :visible="modelValue" @update:visible="showSpinner ? '' : $emit('update:modelValue', $event), confirmName = ''" width="607px" :top="clientWidth <= 767 ? '0px' : '46px'">
        <template #body>
            <div class="bg-light-gray p-020 position-re style-scroll overflow-auto conformation__sidebar-component">
                <div class="w-100 h-100 bg-dark-gray3 position-ab d-flex align-items-center justify-content-center z-index-7" v-if="showSpinner">
                    <Spinner :isSpinner="true"/>
                </div>
                <div class="bg-white border-radius-12-px d-flex align-items-center flex-column p-040 position-re">
                     <slot name="head">
                        <img @click="$emit('update:modelValue', false), confirmName = ''" :src="closeImage" alt="closeImage" class="position-ab cursor-pointer closeee__image-icon">
                    </slot>
                    <img :src="frameImage" alt="frameImage" class="mb-1 mw-100">
                    <div class="style-scroll overflow-auto archieve__titledesc--wrapper text-center w-100 mw-100">
                        <h4 class="mb-0 text-center archive-delete-title font-weight-700">{{title}}</h4>
                        <p v-if="message" class="text-center archive-delete-desc font-weight-400 font-size-16 gray81" v-html="sanitizeInline(message)"></p>
                        <slot name="body"> 
                            <strong class="font-weight-500 text-center d-block mb-7px dark-gray type__confirmation-string">{{ $t('conformationmsg.type') }} <i>{{confirmationString}}</i></strong>

                            <InputText
                                v-model="confirmName"
                                :placeholder="confirmationString"
                                :isDirectFocus="true"
                                class="text-center font-size-16 font-weight-400 archive-delete-input w-100 gray"
                                height="56px"
                            />
                        </slot>
                    </div>
                        <div class="d-flex align-items-center archive-delete-btnwrapper mb--10px mt-30px">
                            <button class="outline-primary mr-1 font-size-16 d-flex align-items-center font-roboto-sans" @click="$emit('update:modelValue', false), confirmName = ''">{{$t('Projects.cancel')}}</button>
                            <button v-if="confirmName !== confirmationString && isShowInput" class="btn-secondary cursor-default font-size-16 px3-py14 font-roboto-sans">{{acceptButton}}</button>
                            <button v-else :class="acceptButtonClass" class="px-1 font-size-16 font-roboto-sans" @click="$emit('confirm'), confirmName=''">{{acceptButton}}</button>
                        </div>
                    </div>
            </div>
        </template>
    </Sidebar>
</template>

<script setup>
// PACKAGES
import {defineProps, defineEmits, ref , inject} from "vue";

// COMPONENTS
import InputText from "@/components/atom/InputText/InputText.vue"
import Sidebar from "@/components/molecules/Sidebar/Sidebar.vue"
import Spinner from "@/components/atom/SpinnerComp/SpinnerComp.vue"

// UTILS
import { sanitizeInline } from "@/utils/sanitizeHtml";

// IMAGES
const frameImage = require("@/assets/images/Frame.png");
const closeImage = require("@/assets/images/svg/deletearchiveSvg.svg");
const clientWidth = inject("$clientWidth");
defineProps({
    title: {
        type: String,
        default: "",
    },
    message: {
        type: String,
        default: "",
    },
    confirmationString: {
        type: String,
        default: ""
    },
    acceptButtonClass: {
        type: String,
        default: "Accept",
    },
    acceptButton: {
        type: String,
        default: "Accept",
    },

    modelValue: {
        type: Boolean,
        required: true
    },
    showSpinner: {
        type: Boolean,
        default: false
    },
    isShowInput: {
        type: Boolean,
        default: true
    },
})

defineEmits(["confirm", "update:modelValue"])

const confirmName = ref("");
</script>

<style src="./style.css">
</style>