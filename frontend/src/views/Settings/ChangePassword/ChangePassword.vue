<template>
    <div class="position-re mySettingsWrapper p-1">
        <SpinnerComp :is-spinner="isSpinner" />
        <div class="my-settings-main" :class="[{ 'pointer-events-none': isSpinner }]">
            <div class="row">
                <div class="col-md-2 settingprofile">
                    <div class="col-md-10 settingprofileform setting_profile_mobile_responsive">
                        <div class="profileform">
                            <form class="form_wrapper">
                                <div class="">
                                    <div class="inputfield position-re">
                                        <label>
                                            {{ $t('errorPage.current_password') }} *
                                        </label>
                                        <input
                                            :type="viewCurrentPassword"
                                            class="logininput password_input"
                                            placeHolder="*****"
                                            v-model.trim="formDataChangePassword.currentPassword.value"
                                            tabindex="1"
                                            @keyup="(e) => handleSelect(e,'currentPassword')" 
                                            id="current_password"
                                        />
                                        <span @click="togglePasswordInput('currentpassword')" class="cursor-pointer position-ab d-flex align-items-center eye_hide_show">
                                            <img v-if="viewCurrentPassword === 'password'" src="@/assets/images/password_view_hide.png" class="password-view"/>
                                            <img v-else src="@/assets/images/password_view_show.png" class="password-view"/>
                                        </span>
                                        <div class="invalid-feedback red pt-5px error-capitalize">{{ formDataChangePassword.currentPassword.error }}
                                        </div>
                                    </div>
                                    <div class="inputfield position-re">
                                        <label>
                                            {{ $t('errorPage.new_password') }} *
                                        </label>
                                        <input
                                            :type="viewPassword"
                                            class="logininput password_input" 
                                            placeHolder="*****"
                                            v-model.trim="formDataChangePassword.newPassword.value"
                                            tabindex="2"
                                            @keyup="(e) => handleSelect(e,'newPassword')"
                                            id="new_password"
                                        />
                                        <span @click="togglePasswordInput('password')" class="cursor-pointer position-ab d-flex align-items-center eye_hide_show">
                                            <img v-if="viewPassword === 'password'" src="@/assets/images/password_view_hide.png" class="password-view"/>
                                            <img v-else src="@/assets/images/password_view_show.png" class="password-view"/>
                                        </span>
                                        <div class="invalid-feedback red pt-5px error-capitalize">{{ formDataChangePassword.newPassword.error }}</div>
                                    </div>
                                    <div class="inputfield position-re">
                                        <label>
                                            {{ $t('errorPage.confirm_password') }} *
                                        </label>
                                        <input
                                            :type="viewConfirmPassword"
                                            class="logininput password_input"
                                            placeHolder="*****"
                                            v-model="formDataChangePassword.confirmNewPassword.value" 
                                            tabindex="3"
                                            @keyup="(e) => handleSelect(e,'confirmNewPassword')"
                                            id="confirm_password"
                                        />
                                        <span @click="togglePasswordInput('confirmpassword')" class="cursor-pointer position-ab d-flex align-items-center eye_hide_show">
                                            <img v-if="viewConfirmPassword === 'password'" src="@/assets/images/password_view_hide.png" class="password-view"/>
                                            <img v-else src="@/assets/images/password_view_show.png" class="password-view"/>
                                        </span>
                                        <div class="invalid-feedback red pt-5px error-capitalize">{{ confirmationErr }}</div>
                                    </div>
                                </div>
                                <div class="d-flex align-items-center justify-content-start mysetiing_save">
                                    <button :disabled="isSpinner" @click.prevent="handleChangePassword()"
                                        :class="[{ 'pointer-events-none': isSpinner }]"
                                        class="btn_btn mysetting_save_btn ml-15px">{{ $t('Settings.save_changes')
                                        }}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    import * as env from '@/config/env';
    import {useToast} from 'vue-toast-notification';
    import { useValidation } from "@/composable/Validation.js";
    import { ref, inject } from "vue";
    import SpinnerComp from '@/components/atom/SpinnerComp/SpinnerComp.vue';
    import { apiRequest,useAuth } from "../../../services";
    import { useI18n } from 'vue-i18n';
    import { MIN_PASSWORD_LENGTH, PASSWORD_PATTERN } from '@passwordRule';
    const { t } = useI18n();
    const { logOut } = useAuth();

    const $toast = useToast();
    const { checkErrors, checkAllFields } = useValidation();
    // inject
    const userId = inject("$userId");
    //ref
    const confirmationErr = ref('');
    const viewPassword = ref("password");
    const viewCurrentPassword = ref("password");
    const viewConfirmPassword = ref("password");
    const isSpinner = ref(false);
    const formDataChangePassword = ref({
        currentPassword: {
            value: "",
            rules:"required",
            name: "current password",
            error: "",
        },
        newPassword: {
            value: "",
            rules:`required | regex: ${PASSWORD_PATTERN.source} | min:${MIN_PASSWORD_LENGTH}`,
            name: "new password",
            error: "",
        },
        confirmNewPassword: {
            value: "",
            rules:"",
            name: "confirm new password",
            error: "",
        }
    });


    const handleSelect = (e,id) => {
        if(id === 'currentPassword'){
            checkErrors({
                'field': formDataChangePassword.value.currentPassword,
                'name': formDataChangePassword.value.currentPassword.name,
                'validations': formDataChangePassword.value.currentPassword.rules,
                'type': formDataChangePassword.value.currentPassword.type,
                'event': e.event
            })
        }else if(id === 'newPassword'){
            checkErrors({
                'field': formDataChangePassword.value.newPassword,
                'name': formDataChangePassword.value.newPassword.name,
                'validations': formDataChangePassword.value.newPassword.rules,
                'type': formDataChangePassword.value.newPassword.type,
                'event': e.event
            })
            updateConfirmation();
        }else if(id === 'confirmNewPassword'){
            checkErrors({
                'field': formDataChangePassword.value.confirmNewPassword,
                'name': formDataChangePassword.value.confirmNewPassword.name,
                'validations': formDataChangePassword.value.confirmNewPassword.rules,
                'type': formDataChangePassword.value.confirmNewPassword.type,
                'event': e.event
            })
            updateConfirmation();
        }
    };
    const updateConfirmation = () => {
        if(formDataChangePassword.value.confirmNewPassword.value === ''){
            return;
        }else{
            if(formDataChangePassword.value.confirmNewPassword.value === ''){
                confirmationErr.value = t('errorPage.The_confirm_password_field_is_required');
            }else if(formDataChangePassword.value.newPassword.value !== formDataChangePassword.value.confirmNewPassword.value){
                confirmationErr.value = t('errorPage.The_confirm_password_confirmation_does_not_match');
            }else{
                confirmationErr.value = '';
            }
        }
    };
    const confirmationPassValidation = () => {
        let err = ""
        if(formDataChangePassword.value.confirmNewPassword.value === ''){
            err = t('errorPage.The_confirm_password_field_is_required');
        }else if(formDataChangePassword.value.newPassword.value !== formDataChangePassword.value.confirmNewPassword.value){
            err = t('errorPage.The_confirm_password_confirmation_does_not_match');
        }
        confirmationErr.value = err;
        return err;
    };
    const handleChangePassword = () => {
        checkAllFields(formDataChangePassword.value).then(async(valid)=>{
            const passwordMatched = confirmationPassValidation();
            if(valid && passwordMatched === ''){
                isSpinner.value = true;
                await apiRequest("patch",`${env.AUTH}/${userId.value}/change-password` , {
                    oldPassword:formDataChangePassword.value.currentPassword.value,
                    newPassword:formDataChangePassword.value.newPassword.value
                }).then((res)=>{
                    if(res.status ===  200){
                        apiRequest("delete",`${env.DELETE_SESSION}/${userId.value}`).then(() => {
                            isSpinner.value = false;
                            $toast.success(t("Toast.Password_reset_has_been_successfully"),{position: 'top-right'});
                            logOut();
                        }).catch(() => {
                            isSpinner.value = false;
                            $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
                            logOut();
                        });
                    }else{
                        isSpinner.value = false;
                        $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
                    }
                    resetPassword();
                }).catch((error) => {
                    if(error?.response?.data?.message === 'Auth.too_many_request' || error?.response?.data?.message === 'Auth.previous_wasnot_valid' || error?.response?.data?.message === 'Auth.password_wasnot_valid'){
                        $toast.error(t(error.response.data.message),{position: 'top-right'});
                    }else{
                        $toast.error(t('Toast.something_went_wrong'),{position: 'top-right'});
                    }
                    resetPassword();
                    isSpinner.value = false;
                    console.error('error in change password',error);
                });
            }
        });
    };
    const togglePasswordInput = (key) => {
        if(key === "password") {
            viewPassword.value = (viewPassword.value === "password") ? "text": "password";
        }else if(key === 'confirmpassword'){
            viewConfirmPassword.value = (viewConfirmPassword.value === "password") ? "text": "password";
        }else{
            viewCurrentPassword.value = (viewCurrentPassword.value === "password") ? "text": "password";
        }
    };
    const resetPassword = () => {
        formDataChangePassword.value.confirmNewPassword.value = '';
        formDataChangePassword.value.newPassword.value = '';
        formDataChangePassword.value.currentPassword.value = '';
        formDataChangePassword.value.confirmNewPassword.error = '';
        formDataChangePassword.value.newPassword.error = '';
        formDataChangePassword.value.currentPassword.error = '';
        confirmationErr.value = '';
    };
</script>

<style scoped>
@import '../MySettings/style.css';
</style>
