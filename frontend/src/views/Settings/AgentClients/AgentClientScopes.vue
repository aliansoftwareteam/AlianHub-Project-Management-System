<template>
    <div class="acs">
        <fieldset class="acs__set">
            <legend class="ah-small">{{ $t('AgentClients.scopes_legend') }}</legend>
            <label v-for="scope in PLAIN_SCOPES" :key="scope" class="acs__scope">
                <input v-model="scopes" type="checkbox" :value="scope" :data-test="`scope-${scope}`" />
                <span>{{ $t(scopeNameKey(scope)) }}</span>
            </label>
        </fieldset>
        <fieldset class="acs__set acs__set--stacked" data-test="manage-scopes">
            <legend class="ah-small">{{ $t('AgentClients.manage_legend') }}</legend>
            <label v-for="scope in OPT_IN_SCOPES" :key="scope" class="acs__scope acs__scope--top">
                <input v-model="scopes" type="checkbox" :value="scope" :data-test="`scope-${scope}`" />
                <span class="acs__text">
                    <span>{{ $t(scopeNameKey(scope)) }} <span v-if="asked.includes(scope)" class="ah-chip" :data-test="`asked-${scope}`">{{ $t('AgentClients.asked_for') }}</span></span>
                    <span class="ah-small">{{ $t(scopeSentenceKey(scope)) }}</span>
                </span>
            </label>
        </fieldset>
        <label class="acs__scope">
            <input v-model="privateSprints" type="checkbox" data-test="private-sprints" />
            <span>{{ $t('AgentClients.private_label') }}</span>
        </label>
    </div>
</template>

<script setup>
import { PLAIN_SCOPES, OPT_IN_SCOPES, scopeNameKey, scopeSentenceKey } from "@/views/OAuth/oauthShared";

defineOptions({ name: "AgentClientScopes" });

defineProps({ asked: { type: Array, default: () => [] } });

const scopes = defineModel("scopes", { type: Array, required: true });
const privateSprints = defineModel("privateSprints", { type: Boolean, default: false });
</script>

<style>
.acs { display: grid; gap: 8px; }
.acs__set { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.acs__set--stacked { display: grid; }
.acs__scope { display: inline-flex; gap: 6px; align-items: center; }
.acs__scope--top { align-items: flex-start; }
.acs__text { display: grid; gap: 2px; }
</style>
