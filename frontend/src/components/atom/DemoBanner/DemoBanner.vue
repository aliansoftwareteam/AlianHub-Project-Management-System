<template>
    <div v-if="demoMode" class="demo-banner">
        <span class="demo-banner__msg">
            🚀 {{ $t('Demo.banner') }}
            <span v-if="demoEmail" class="demo-banner__creds">
                {{ $t('Demo.login_with') }} <strong>{{ demoEmail }}</strong><template v-if="demoPassword"> / <strong>{{ demoPassword }}</strong></template>
            </span>
        </span>
        <span class="demo-banner__links">
            <span v-if="showcase" class="demo-banner__industry" data-test="demo-industry">{{ industryOf(current) }}</span>
            <router-link v-if="guideRoute" :to="guideRoute" data-test="demo-guide">{{ $t('Demo.guide') }}</router-link>
            <a v-else :href="helpUrl" target="_blank" rel="noopener noreferrer" data-test="demo-guide">{{ $t('Demo.guide') }}</a>
            <button type="button" data-test="demo-switch" @click.stop="openSwitcher">{{ $t('Demo.switch_industry') }}</button>
            <a :href="githubUrl" target="_blank" rel="noopener noreferrer">⭐ {{ $t('Demo.star') }}</a>
            <a :href="deployUrl" target="_blank" rel="noopener noreferrer">{{ $t('Demo.deploy') }}</a>
        </span>
    </div>
</template>

<script setup>
import { computed, inject, unref } from "vue";
import { useStore } from "vuex";
import { useDemoIndustry, industryKeyOf } from "@/composable/useDemoIndustry";
import { shellState } from "@/components/organisms/Shell/shellState";

const store = useStore();
const companyId = inject("$companyId", null);
const { industryOf } = useDemoIndustry();

const GITHUB_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System';
const DEPLOY_URL = 'https://github.com/aliansoftwareteam/AlianHub-Project-Management-System#quick-start';
const HELP_URL = 'https://help.alianhub.com';

const brand = computed(() => store.getters['brandSettingTab/brandSettings'] || {});
const demoMode = computed(() => brand.value.demoMode === true);
const demoEmail = computed(() => brand.value.demoEmail || '');
const demoPassword = computed(() => brand.value.demoPassword || '');
const githubUrl = GITHUB_URL;
const deployUrl = DEPLOY_URL;
const helpUrl = HELP_URL;

const companies = computed(() => store.getters['settings/companies'] || []);
const current = computed(() => companies.value.find((company) => String(company._id) === String(unref(companyId) || '')) || null);
const showcase = computed(() => (industryKeyOf(current.value) ? current.value.demoShowcase || {} : null));
// In a workspace a visitor made, the guide is the first demo company's they belong to.
const guideCompany = computed(() => (showcase.value && showcase.value.guidePageId ? current.value
    : companies.value.find((company) => industryKeyOf(company) && company.demoShowcase && company.demoShowcase.guidePageId) || null));
const guideRoute = computed(() => (guideCompany.value
    ? { name: 'PageEditor', params: { cid: String(guideCompany.value._id), pageId: String(guideCompany.value.demoShowcase.guidePageId) } }
    : null));

// The workspace list with each industry lives in the rail's profile menu.
const openSwitcher = () => { shellState.profileOpen = true; };
</script>

<style scoped>
.demo-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px 16px;
    background: var(--brand);
    color: var(--on-brand);
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
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 14px;
    white-space: nowrap;
}
.demo-banner__industry {
    font-weight: 600;
}
.demo-banner__links a,
.demo-banner__links button {
    color: var(--on-brand);
    text-decoration: underline;
    font: inherit;
    font-weight: 600;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
}
.demo-banner__links a:hover,
.demo-banner__links button:hover {
    opacity: 0.85;
}
</style>
