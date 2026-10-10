<template>
    <div class="gen" role="status" data-egress-blocked>
        <span>{{ $t('AppConnections.egress_blocked', { host }) }}</span>
        <div v-if="owner" class="gen__actions">
            <button v-if="host === GITHUB_API_HOST" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" data-allow-host @click="allow">
                {{ $t('AppConnections.egress_allow', { host }) }}
            </button>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-egress-settings @click="openEgress">{{ $t('AppConnections.egress_settings') }}</button>
        </div>
        <span v-else data-ask-owner>{{ $t('AppConnections.egress_ask_owner', { host }) }}</span>
        <span v-if="error" class="gen__error" role="alert">{{ error }}</span>
    </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { GITHUB_API_HOST, allowHost, isInstanceOwner } from "./githubEgress";

defineOptions({ name: "GithubEgressNotice" });

const props = defineProps({ host: { type: String, required: true } });
const emit = defineEmits(["allowed"]);

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const owner = ref(false);
const busy = ref(false);
const error = ref("");

const companyIdOf = () => route?.params?.cid || localStorage.getItem("selectedCompany") || "";

const openEgress = () => router.push({ name: "InstanceEgress", params: { cid: companyIdOf() } });

const allow = async () => {
    busy.value = true;
    error.value = "";
    try {
        await allowHost(companyIdOf(), props.host);
        emit("allowed", props.host);
    } catch (e) {
        error.value = t("AppConnections.egress_allow_failed", { host: props.host });
    } finally {
        busy.value = false;
    }
};

onMounted(async () => { owner.value = await isInstanceOwner(); });
</script>

<style scoped>
.gen { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 8px 10px; border-radius: 6px; background: var(--warn-bg); color: var(--warn-ink); font: var(--text-small); }
.gen__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gen__error { color: var(--danger-ink); }
</style>
