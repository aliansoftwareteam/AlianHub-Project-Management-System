<template>
    <NewPasswordCard
        :title="$t('AuthV2.set_password_title')"
        :submit-label="$t('AuthV2.save_password')"
        success-toast="Toast.Password_set_new_has_been_successfully"
    />
</template>

<script setup>
defineOptions({ name: "SetNewPasswordPage" });
import NewPasswordCard from "./NewPasswordCard.vue";
</script>
