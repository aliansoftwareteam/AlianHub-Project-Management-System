<template>
    <div v-if="stepDesc.subStep === 1">
        <div class="install-form">
            <div class="row">
                <div class="col-md-12 mb-10">
                    <div class="form-group">
                        <label for="aiToken">OpenAI Secret Key</label>
                        <InputText
                            id="aiToken"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.aiToken.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.aiToken,
                            'name':formData.aiToken.name,
                            'validations':formData.aiToken.rules,
                            'type':formData.aiToken.type,
                            'event':$event.event})"
                            @input="formData.aiToken.value = formData.aiToken.value"
                            maxlength="254"
                            ref="aiToken"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.aiToken.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-12 mb-10">
                    <span class="formLabel">OpenAI Library </span>
                    <select class="install-form-control mt-10 w-100" v-model="formData.aiModel.value">
                        <option v-for="(aModel,index) in allModels" :key="index" :value="aModel?.value">
                            {{aModel?.label}}
                        </option>
                    </select>
                    <div class="errorMessage">{{ formData.aiModel.error }}</div>
                </div>
            </div>
            <div class="form-group">
                <div class="mt-20 font-size-20">
                    For any further queries, please refer to our <a href="https://help.alianhub.com/app-installation-and-start-guide/4.-installation-guide/4.6-ai-configuration" target="_blank" class="blue font-weight-600">documentation.</a>
                </div>
                <button class="btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer btn-full mt-20" :disabled="!isSubmitSend" :class="{'disabled': !isSubmitSend}" @click="handleSubmit" tabindex="3">Submit</button>
                <p class="skip-step__note">AI features stay off until you add a key. Everything else works.</p>
                <a class="blue font-weight-500 font-18 cursor-pointer skip-step" @click="$emit('complete', { isDoItLater: true })">Skip for now</a>
            </div>
        </div>
    </div>
</template>
<script setup>
    import { defineEmits, onMounted, ref } from "vue";
    import InputText from "@/components/atom/InputText/InputText.vue";
    import { useValidation } from "@/composable/Validation.js";
    const  { checkErrors , checkAllFields } = useValidation();
    const emit = defineEmits(["complete"]);
    import * as env from '@/config/env';
    import { apiRequest } from "../../services";

    const confirmationErr = ref("");
    const formData = ref({
        aiToken: {
            value: "",
            rules:
            "required",
            name: "OpenAI Secret Key",
            error: "",
        },
        aiModel:{
            value:"",
            rules:
            "required",
            name: "OpenAI Library",
            error:""
        }
    });
    const isSubmitSend = ref(true);
    const allModels = ref(true);
    const stepDesc = ref({
        name: "Artificial Intelligence",
        subStep: 1
    })
    const handleSubmit = () => {
        isSubmitSend.value = false;
        checkAllFields(formData.value).then((valid)=>{
            if(valid && confirmationErr.value === ''){
                stepDesc.value.subStep = 2;
                isSubmitSend.value = true;
                emit("complete", {
                    isDoItLater: false,
                    aiToken: formData.value.aiToken.value,
                    aiModel: formData.value.aiModel.value
                });
            } else {
                stepDesc.value.subStep = 1;
                isSubmitSend.value = true;
            }
        })
    }
    onMounted(() => {
        apiRequest("get", env.GETAIMODELS).then((res) => {
            if (res?.data?.status) {
                allModels.value = res.data.data;
                isSubmitSend.value = true;
                formData.value.aiModel.value = res.data.data[0].value;
                return;
            }
            allModels.value = [];
            formData.value.aiModel.value = "";
            isSubmitSend.value = true;
        }).catch((err) => {
            console.error("err", err);
            allModels.value = [];
            formData.value.aiModel.value = "";
            isSubmitSend.value = true;
            // Add Error Message
        })
    })
</script>
<style scoped>

.skip-step__note {
    font-size: 12.5px;
    line-height: 1.45;
    color: #8c8c8c;
    margin: 14px 0 6px;
    text-align: center;
}
.skip-step {
    display: block;
    text-align: center;
    margin-top: 4px;
}
</style>