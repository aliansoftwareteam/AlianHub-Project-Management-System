<template>
    <div v-if="smtpStep === 1">
        <div class="install-form">
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="smtpEmail">SMTP Email</label>
                        <InputText
                            id="smtpEmail"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model.trim="formData.smtpEmail.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.smtpEmail,
                            'name':formData.smtpEmail.name,
                            'validations':formData.smtpEmail.rules,
                            'type':formData.smtpEmail.type,
                            'event':$event.event})"
                            @input="formData.smtpEmail.value = formData.smtpEmail.value.toLowerCase()"
                            maxlength="254"
                            ref="smtpEmail"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.smtpEmail.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="smtpEmailPassword">SMTP Email Password</label>
                        <InputText
                            id="smtpEmailPassword"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.smtpEmailPassword.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.smtpEmailPassword,
                            'name':formData.smtpEmailPassword.name,
                            'validations':formData.smtpEmailPassword.rules,
                            'type':formData.smtpEmailPassword.type,
                            'event':$event.event})"
                            @input="formData.smtpEmailPassword.value = formData.smtpEmailPassword.value"
                            maxlength="254"
                            ref="smtpEmailPassword"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.smtpEmailPassword.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="smtpHost">SMTP Host</label>
                        <InputText
                            id="smtpHost"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.smtpHost.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.smtpHost,
                            'name':formData.smtpHost.name,
                            'validations':formData.smtpHost.rules,
                            'type':formData.smtpHost.type,
                            'event':$event.event})"
                            @input="formData.smtpHost.value = formData.smtpHost.value"
                            maxlength="254"
                            ref="smtpHost"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.smtpHost.error}}</div>
                    </div>
                </div>
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="smtpPort">SMTP Port</label>
                        <InputText
                            id="smtpPort"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formData.smtpPort.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.smtpPort,
                            'name':formData.smtpPort.name,
                            'validations':formData.smtpPort.rules,
                            'type':formData.smtpPort.type,
                            'event':$event.event})"
                            @input="formData.smtpPort.value = formData.smtpPort.value"
                            maxlength="254"
                            ref="smtpPort"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.smtpPort.error}}</div>
                    </div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6 mb-10">
                    <div class="form-group">
                        <label for="toEmail">To Email</label>
                        <InputText
                            id="toEmail"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model.trim="formData.toEmail.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formData.toEmail,
                            'name':formData.toEmail.name,
                            'validations':formData.toEmail.rules,
                            'type':formData.toEmail.type,
                            'event':$event.event})"
                            @input="formData.toEmail.value = formData.toEmail.value.toLowerCase()"
                            maxlength="254"
                            ref="codetoEmail"
                            type="text"
                            @enter="handleSubmit"
                        />
                        <div class="invalid-feedback red">{{formData.toEmail.error}}</div>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <div class="mt-20 font-size-20">
                    For any further queries, please refer to our <a href="https://help.alianhub.com/app-installation-and-start-guide/4.-installation-guide/4.8-smtp-configuration-gmail" target="_blank" class="blue font-weight-600">documentation.</a>
                </div>
                <button class="btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer btn-full mt-20" :disabled="!isSubmitSend" :class="{'disabled': !isSubmitSend}" @click="handleSubmit" tabindex="3">Submit</button>
                <p class="skip-step__note">Without mail you can still use AlianHub on your own, but invitations and password resets cannot be sent.</p>
                <button type="button" class="skip-step font-roboto-sans cursor-pointer" @click="$emit('skip')">Skip for now</button>
            </div>
        </div>
    </div>
    <div v-if="smtpStep === 2">
        <div class="install-form">
            <div class="">
                <div class="mb-10">
                    <div class="text-center">
                        <p>We've sent it on</p>
                        <p class="blue">{{ formData.toEmail.value }} <img class="cursor-pointer" :src="editImg" @click="editEmail()" /> </p>
                    </div>
                    <div class="form-group">
                        <label for="code">Code</label>
                        <InputText
                            id="code"
                            class="login-input mt-10"
                            placeHolder="XXXXXXX"
                            v-model="formCodeData.code.value"
                            height="48px"
                            width="calc(100% - 32px)"
                            @keyup="checkErrors({'field':formCodeData.code,
                            'name':formCodeData.code.name,
                            'validations':formCodeData.code.rules,
                            'type':formCodeData.code.type,
                            'event':$event.event})"
                            @input="formCodeData.code.value = formCodeData.code.value"
                            maxlength="254"
                            ref="code"
                            type="text"
                            @enter="handleCodeSubmit"
                        />
                        <div class="invalid-feedback red">{{formCodeData.code.error}}</div>
                    </div>
                </div>
            </div>
            <div style="display: flex;">
                <button class="font-roboto-sans cursor-pointer btn-full mt-20 outline-primary mr-10" @click="handleSubmit()">Resend</button>
                <button class="btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer btn-full mt-20 ml-10" :disabled="!isSubmitSMPTverify" :class="{'disabled': !isSubmitSMPTverify}" @click="handleCodeSubmit">Submit</button>
            </div>
        </div>
    </div>
</template>
<script setup>
    import { defineEmits, ref } from "vue";
    import * as env from '@/config/env';
    import InputText from "@/components/atom/InputText/InputText.vue";
    import {useToast} from 'vue-toast-notification';
    import { useValidation } from "@/composable/Validation.js";
    import editImg from "@/assets/images/svg/edit.svg";
    import { apiRequest } from "../../services";
    const  { checkErrors , checkAllFields } = useValidation();
    const emit = defineEmits(["complete", "skip"]);

    const formData = ref({
        smtpEmail: {
            value: "",
            rules:
            "required | regex: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$",
            name: "SMTP Email",
            error: "",
        },
        smtpEmailPassword : {
            value: "",
            rules:
            "required",
            name: "SMTP Email Password",
            error: "",
        },
        smtpHost: {
            value: "",
            rules:
            "required",
            name: "SMTP Host",
            error: "",
        },
        smtpPort: {
            value: "",
            rules:
            "required",
            name: "SMTP Port",
            error: "",
        },
        toEmail: {
            value: "",
            rules:
            "required | regex: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$",
            name: "To Email",
            error: "",
        }
    });
    const formCodeData = ref({
        code: {
            value: "",
            rules:
            "required",
            name: "Code",
            error: "",
        }
    });
    const isSubmitSend = ref(true);
    const isSubmitSMPTverify = ref(true);
    const smtpStep = ref(1);
    // const stepDesc = ref({
    //     name: "Verification Your SMTP",
    //     subStep: 1
    // });
    const $toast = useToast();
    
    const handleSubmit = () => {
        isSubmitSend.value = false;
        checkAllFields(formData.value).then((valid)=>{
            if(valid){
                const smtpReqData = {
                    step: 6,
                    smtpEmail: formData.value.smtpEmail.value,
                    smtpEmailPassword: formData.value.smtpEmailPassword.value,
                    smtpHost: formData.value.smtpHost.value,
                    smtpPort: formData.value.smtpPort.value,
                    toEmail: formData.value.toEmail.value,
                    key: 1
                }
                apiRequest("post", env.INSTALL_STEP, smtpReqData).then((res) => {
                    if (res.data.status === true) {
                        smtpStep.value = 2;
                        isSubmitSend.value = true;
                        $toast.success("Verification mail has been send successfully.Please check your inbox",{position: 'top-right'});
                        return;
                    }
                    isSubmitSend.value = true;
                    $toast.error(`Please check your SMTP credentials. ${res.data.error}`,{position: 'top-right'});
                }).catch((err) => {
                    // Add Error Message
                    $toast.error(`Please check your SMTP credentials. ${err}`,{position: 'top-right'});
                })
            } else {
                isSubmitSend.value = true;
            }
        })
    }

    const handleCodeSubmit = () => {
        isSubmitSMPTverify.value = false;
        checkAllFields(formCodeData.value).then((valid)=>{
            if(valid){
                const smtpReqData = {
                    step: 6,
                    code: formCodeData.value.code.value,
                    key: 2
                }
                apiRequest("post", env.INSTALL_STEP, smtpReqData).then((res) => {
                    if (res.data.status === true) {
                        isSubmitSMPTverify.value = true;
                        $toast.success("Your SMTP is suceessfully verify.",{position: 'top-right'});
                        emit("complete", {...formCodeData, ...formData});
                        return;
                    }
                    isSubmitSMPTverify.value = true;
                    $toast.error(`Your verification code invalid. Please check your code.`,{position: 'top-right'});
                }).catch((err) => {
                    // Add Error Message
                    $toast.error(`Your verification code invalid. ${err}`,{position: 'top-right'});
                })
            } else {
                isSubmitSMPTverify.value = true;
            }
        })
    }
    function editEmail() {
        smtpStep.value = 1;
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