<template>
    <div v-if="stepDesc.subStep === 1">
        <div class="install-form">
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="apiKey">API Key</label>
                        <InputText
                            id="apiKey"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.apiKey.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.apiKey,
                            'name':formData.apiKey.name,
                            'validations':formData.apiKey.rules,
                            'type':formData.apiKey.type,
                            'event':$event.event})"
                            @input="formData.apiKey.value = formData.apiKey.value"
                            maxlength="254"
                            ref="apiKey"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.apiKey.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="autoDomain">Auth Domain</label>
                        <InputText
                            id="autoDomain"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.autoDomain.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.autoDomain,
                            'name':formData.autoDomain.name,
                            'validations':formData.autoDomain.rules,
                            'type':formData.autoDomain.type,
                            'event':$event.event})"
                            @input="formData.autoDomain.value = formData.autoDomain.value"
                            maxlength="254"
                            ref="autoDomain"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.autoDomain.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="projectId">Project Id</label>
                        <InputText
                            id="projectId"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.projectId.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.projectId,
                            'name':formData.projectId.name,
                            'validations':formData.projectId.rules,
                            'type':formData.projectId.type,
                            'event':$event.event})"
                            @input="formData.projectId.value = formData.projectId.value"
                            maxlength="254"
                            ref="projectId"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.projectId.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="storageBucket">Storage Bucket</label>
                        <InputText
                            id="storageBucket"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.storageBucket.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.storageBucket,
                            'name':formData.storageBucket.name,
                            'validations':formData.storageBucket.rules,
                            'type':formData.storageBucket.type,
                            'event':$event.event})"
                            @input="formData.storageBucket.value = formData.storageBucket.value"
                            maxlength="254"
                            ref="storageBucket"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.storageBucket.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="messageingSenderId">Messageing SenderId</label>
                        <InputText
                            id="messageingSenderId"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.messageingSenderId.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.messageingSenderId,
                            'name':formData.messageingSenderId.name,
                            'validations':formData.messageingSenderId.rules,
                            'type':formData.messageingSenderId.type,
                            'event':$event.event})"
                            @input="formData.messageingSenderId.value = formData.messageingSenderId.value"
                            maxlength="254"
                            ref="messageingSenderId"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.messageingSenderId.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="appId">App Id</label>
                        <InputText
                            id="appId"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.appId.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.appId,
                            'name':formData.appId.name,
                            'validations':formData.appId.rules,
                            'type':formData.appId.type,
                            'event':$event.event})"
                            @input="formData.appId.value = formData.appId.value"
                            maxlength="254"
                            ref="appId"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.appId.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="measurementId">MeasurementId</label>
                        <InputText
                            id="measurementId"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.measurementId.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.measurementId,
                            'name':formData.measurementId.name,
                            'validations':formData.measurementId.rules,
                            'type':formData.measurementId.type,
                            'event':$event.event})"
                            @input="formData.measurementId.value = formData.measurementId.value"
                            maxlength="254"
                            ref="measurementId"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.measurementId.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                </div>
            </div>
            <div class="form-group">
                <div class="mt-20 font-size-20">
                    For any further queries, please refer to our <a href="https://help.alianhub.com/app-installation-and-start-guide/4.-installation-guide/4.5-firebase-configuration" target="_blank" class="blue font-weight-600">documentation.</a>
                </div>
                <button class="btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer btn-full mt-20" :disabled="!isSubmitSend" :class="{'disabled': !isSubmitSend}" @click="handleSubmit" tabindex="3">Submit</button>
                <p class="skip-step__note">Push notifications stay off until you add these. Everything else works.</p>
                <button type="button" class="skip-step font-roboto-sans cursor-pointer" @click="$emit('skip')">Skip for now</button>
            </div>
        </div>
    </div>
</template>
<script setup>
    import { defineEmits, ref } from "vue";
    import InputText from "@/components/atom/InputText/InputText.vue";
    import { useValidation } from "@/composable/Validation.js";
    const  { checkErrors , checkAllFields } = useValidation();
    const emit = defineEmits(["complete", "skip"]);

    const formData = ref({
        apiKey: {
            value: "",
            rules:
            "required",
            name: "API Key",
            error: "",
        },
        autoDomain: {
            value: "",
            rules:
            "required",
            name: "Auth Domain",
            error: "",
        },
        projectId: {
            value: "",
            rules:
            "required",
            name: "Project Id",
            error: "",
        },
        storageBucket: {
            value: "",
            rules:
            "required",
            name: "Storage Bucket",
            error: "",
        },
        messageingSenderId: {
            value: "",
            rules:
            "required",
            name: "Messageing Sender Id",
            error: "",
        },
        appId: {
            value: "",
            rules:
            "required",
            name: "App Id",
            error: "",
        },
        measurementId: {
            value: "",
            rules:
            "required",
            name: "Measurement Id",
            error: "",
        }
    });
    const isSubmitSend = ref(true);
    const stepDesc = ref({
        name: "Verification Your Firebase",
        subStep: 1
    })
    
    const handleSubmit = () => {
        isSubmitSend.value = false;
        checkAllFields(formData.value).then((valid)=>{
            if(valid){
                stepDesc.value.subStep = 2;
                isSubmitSend.value = true;
                emit("complete", {
                    apiKey: formData.value.apiKey.value,
                    projectId: formData.value.projectId.value,
                    autoDomain: formData.value.autoDomain.value,
                    storageBucket: formData.value.storageBucket.value,
                    messageingSenderId: formData.value.messageingSenderId.value,
                    appId: formData.value.appId.value,
                    measurementId: formData.value.measurementId.value
                });
            } else {
                stepDesc.value.subStep = 1;
                isSubmitSend.value = true;
            }
        })
    }
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
    width: 100%;
    background: none;
    border: none;
    font-size: 13.5px;
    color: #2f6fdb;
    text-decoration: underline;
    padding: 4px 0;
}
</style>