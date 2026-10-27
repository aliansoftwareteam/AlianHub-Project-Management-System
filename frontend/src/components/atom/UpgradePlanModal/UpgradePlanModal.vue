<template>
    <div class="show_warning">
        <div class="mb-15px msg-color">{{ warningMessage }}</div>
        <div class="upgrade-btn-txt d-flex justify-content-center">
            <span @click="navigateToUpgrade" class="cursor-pointer">
                {{ $t('Upgrades.upgrade_your_plan') }}
            </span>
        </div>
    </div>
</template>

<script setup>
import { defineProps,inject } from 'vue';
import { useRouter } from 'vue-router';
import { openUpgrade } from "@/composable/upgradeLink";

const companyId = inject("$companyId");
defineProps({
    warningMessage: String,
});

const router = useRouter();

const navigateToUpgrade = () => {
    openUpgrade(router, companyId.value);
};
</script>

<style src="./style.css">
</style>