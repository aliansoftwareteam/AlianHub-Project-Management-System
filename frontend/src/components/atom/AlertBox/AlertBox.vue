<template>
    <Teleport to="body">
        <div v-if="visible" class="alert-modal-overlay">
            <div class="alert-box w-500px bg-white border-radius-10-px overflow-hidden box-shadow-6 text-center">
                <div :class="headerClass" class="position-re d-flex align-items-center justify-content-center">
                    <div class="error-icon-container position-re d-flex justify-content-center w-100">
                        <div :class="bgColorShadow"
                            class="top-50px position-re w-120px h-120px border-radius-50-per d-flex align-items-center justify-content-center border-thick-white">
                            <img :src="icon" alt="icon" class="w-40px" />
                        </div>
                    </div>
                </div>

                <div class="custom-padding-1">
                    <h2 class="font-size-22 font-weight-bold dark-gray font-roboto">{{ title }}</h2>
                    <p class="font-size-16 mt-10px color52 font-roboto" v-if="isHtml" v-html="sanitizeHtml(message)"></p>
                    <p class="font-size-16 mt-10px color52 font-roboto" v-else>{{ message }}</p>
                    <div v-if="fields.length" class="gap d-flex justify-content-center flex-wrap mt-10px">
                        <span v-for="field in fields" :key="field"
                            class="border-gray p-5px border-radius-5-px font-size-14 font-weight-bold dark-gray font-roboto">{{
                                field
                            }}</span>
                    </div>
                    <div class="mt-30px d-flex justify-content-center gap">
                        <button v-if="showCancel" @click="handleAction(false)" class="outline-secondary min-width-70">
                            {{ cancelButtonText }}
                        </button>
                        <button @click="handleAction(true)" class="btn-primary min-width-70">{{ confirmButtonText
                            }}</button>
                    </div>
                </div>

            </div>
        </div>
    </Teleport>
</template>


<script setup>
import { defineProps, defineEmits, ref, onMounted, computed } from "vue";
import { useCustomComposable } from "@/composable";
import { sanitizeHtml } from "@/utils/sanitizeHtml";

const { makeUniqueId } = useCustomComposable();
const visible = ref(true);

const props = defineProps({
    modelValue: Boolean,
    type: {
        type: String,
        default: "error",
    },
    title: {
        type: String,
        default: "Error",
    },
    message: {
        type: String,
        default: "",
    },
    fields: {
        type: Array,
        default: () => [],
    },
    confirmButtonText: {
        type: String,
        default: "OK",
    },
    cancelButtonText: {
        type: String,
        default: "Cancel",
    },
    showCancel: {
        type: Boolean,
        default: true,
    },
    isHtml : {
        type: Boolean,
        default: false,
    }
});

const emit = defineEmits(["close"]);

const uid = ref("");
onMounted(() => {
    if (props.id) {
        uid.value = props.id
    } else {
        uid.value = makeUniqueId();
    }
})

const typeMappings = {
    warning: {
        icon: require("@/assets/images/svg/WarningWhite.svg"),
        headerClass: "bg-orange",
        bgColorShadow: "box-shadow-orange bg-orange"

    },
    info: {
        icon: require("@/assets/images/svg/info_icon_white.svg"),
        headerClass: "bg-blue",
        bgColorShadow: "box-shadow-blue bg-blue"
    },
    success: {
        icon: require("@/assets/images/svg/White_tick.svg"),
        headerClass: "bg-dark-greenmodal",
        bgColorShadow: "box-shadow-green bg-dark-greenmodal"
    },
    error: {
        icon: require("@/assets/images/svg/white_cross.svg"),
        headerClass: "bg-dark-redmodal",
        bgColorShadow: "box-shadow-red bg-dark-redmodal"
    },

};

const icon = computed(() => typeMappings[props.type]?.icon);
const headerClass = computed(() => typeMappings[props.type]?.headerClass);
const bgColorShadow = computed(() => typeMappings[props.type]?.bgColorShadow);

const handleAction = (confirmed) => {
    visible.value = false;
    emit("close", confirmed); // Emit event when action is chosen
};
</script>

<style>
.gap {
    gap: 10px;
}

.font-roboto {
    font-family: "Roboto";
}

.top-50px {
    top: 50px;
}

.custom-padding-1 {
    padding: 73px 50px 50px 50px;
}

.min-width-70 {
    min-width: 70px;
}

.error-backdrop {
    z-index: 99 !important;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

.alert-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 999;
}

@keyframes popIn {
    0% {
        opacity: 0;
        transform: scale(0.7);
    }
    45% {
        opacity: 1;
        transform: scale(1.05);
    }
    60% {
        transform: scale(0.95);
    }
    100% {
        transform: scale(1);
    }
}

.alert-box {
    animation: popIn 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
}
</style>