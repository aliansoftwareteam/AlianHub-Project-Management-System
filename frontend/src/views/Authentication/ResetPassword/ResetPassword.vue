<template>
    <NewPasswordCard
        :title="$t('Auth.new_password_title')"
        :submit-label="$t('Auth.save_password')"
        success-toast="Toast.Password_reset_has_been_successfully"
    />
</template>

<script setup>
defineOptions({ name: "ResetPasswordPage" });
import NewPasswordCard from "./NewPasswordCard.vue";
</script>
