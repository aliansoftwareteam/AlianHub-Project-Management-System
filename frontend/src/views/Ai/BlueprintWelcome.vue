<template>
    <div class="ah-page ai-page cya cya--welcome" data-test="blueprint-welcome">
        <div class="ai-page__main">
            <div class="ai-page__body ah-scroll">
                <span class="ah-label">{{ $t('CompanyBlueprint.welcome_kicker') }}</span>
                <h1 class="ah-h2">{{ $t('CompanyBlueprint.welcome_title') }}</h1>
                <BlueprintPicker @loaded="onLoaded" />
                <footer class="cya__foot">
                    <button type="button" class="ah-btn ah-btn--secondary" data-test="blueprint-continue" @click="goHome">{{ $t('CompanyBlueprint.welcome_continue') }}</button>
                    <span class="cya__note">{{ $t('CompanyBlueprint.welcome_note') }}</span>
                </footer>
            </div>
        </div>
    </div>
</template>

<script setup>
import { inject, unref } from "vue";
import { useRouter } from "vue-router";
import BlueprintPicker from "./BlueprintPicker.vue";

defineOptions({ name: "BlueprintWelcome" });

const router = useRouter();
const companyId = inject("$companyId", "");

const goHome = () => router.replace({ name: "Home", params: { cid: unref(companyId) } }).catch(() => {});
/* The step is optional and only worth showing while the dispatcher is on. */
const onLoaded = ({ on, failed }) => {
    if (!on || failed) goHome();
};
</script>

<style>
@import "./style.css";
</style>
