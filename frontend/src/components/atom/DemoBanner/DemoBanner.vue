<template>
    <div v-if="demoMode" class="demo-banner">
        <span class="demo-banner__msg">
            🚀 {{ $t('Demo.banner') }}
            <span v-if="demoEmail" class="demo-banner__creds">
                {{ $t('Demo.login_with') }} <strong>{{ demoEmail }}</strong><template v-if="demoPassword"> / <strong>{{ demoPassword }}</strong></template>
            </span>
        </span>
        <span class="demo-banner__links">
            <a :href="githubUrl" target="_blank" rel="noopener noreferrer">⭐ {{ $t('Demo.star') }}</a>
            <a :href="deployUrl" target="_blank" rel="noopener noreferrer">{{ $t('Demo.deploy') }}</a>
        </span>
    </div>
</template>

<script setup>
import { computed } from "vue";
import { useStore } from "vuex";

const store = useStore();

const GITHUB_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System';
const DEPLOY_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System#quick-start';

const brand = computed(() => store.getters['brandSettingTab/brandSettings'] || {});
const demoMode = computed(() => brand.value.demoMode === true);
const demoEmail = computed(() => brand.value.demoEmail || '');
const demoPassword = computed(() => brand.value.demoPassword || '');
const githubUrl = GITHUB_URL;
const deployUrl = DEPLOY_URL;
</script>

<style scoped>
.demo-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px 16px;
    background: #2f3990;
    color: #fff;
    font-size: 12.5px;
    line-height: 1.3;
    padding: 6px 14px;
    text-align: center;
}
.demo-banner__creds {
    opacity: 0.92;
    margin-left: 6px;
}
.demo-banner__links {
    display: inline-flex;
    gap: 14px;
    white-space: nowrap;
}
.demo-banner__links a {
    color: #fff;
    text-decoration: underline;
    font-weight: 600;
}
.demo-banner__links a:hover {
    opacity: 0.85;
}
</style>
