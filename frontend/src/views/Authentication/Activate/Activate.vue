<template>
    <NewPasswordCard
        activation
        :portal-url="publicConfig.hosting?.portalUrl || ''"
        :title="$t('Auth.set_password_title')"
        :submit-label="$t('Auth.activate_submit')"
        success-toast="Auth.activate_done"
    />
</template>

<script setup>
defineOptions({ name: "ActivatePage" });
import NewPasswordCard from "../ResetPassword/NewPasswordCard.vue";
import { publicConfig } from "@/config/publicConfig";
</script>
