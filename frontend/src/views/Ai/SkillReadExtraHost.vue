<template>
    <div class="sk-read__extra" data-test="read-extra-host-row">
        <div class="sk-read__host">
            <input :id="id" :value="host" type="text" class="ah-input ah-mono" :class="{ 'ah-input--error': error }" data-test="read-extra-host" :aria-label="$t('Ai.skill_read_hosts_item', { n: position })" :placeholder="$t('Ai.skill_read_hosts_placeholder')" autocomplete="off" spellcheck="false" @input="emit('update', $event.target.value.trim())" />
            <span v-if="chip" class="ah-chip ah-chip--sm" :class="chip.tone" data-test="read-extra-host-state" aria-live="polite">{{ chip.text }}</span>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" data-test="read-extra-host-remove" :aria-label="$t('Ai.skill_read_hosts_remove', { n: position })" @click="emit('remove')">
                <ShellIcon name="trash" :size="14" />
            </button>
        </div>
        <span v-if="state === 'not_declarable'" class="ah-field__hint">{{ reasonText }}</span>
        <template v-if="state === 'not_listed'">
            <router-link v-if="instanceAdmin" class="ah-small sk-read__link" :to="{ name: 'InstanceEgress', params: { cid } }">{{ $t('Ai.skill_read_open_egress') }}</router-link>
            <span v-else class="ah-field__hint">{{ $t('Ai.skill_read_ask_owner') }}</span>
        </template>
        <span v-if="error" class="ah-field__error" data-test="read-extra-host-error">{{ error }}</span>
    </div>
</template>

<script setup>
import { inject } from "vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useHostCheck } from "./useHostCheck";

defineOptions({ name: "SkillReadExtraHost" });

const props = defineProps({
    id: { type: String, required: true },
    position: { type: Number, required: true },
    host: { type: String, default: "" },
    instanceAdmin: { type: Boolean, default: false },
    error: { type: String, default: "" }
});
const emit = defineEmits(["update", "remove"]);

const cid = inject("$companyId", "");
const { state, chip, reasonText } = useHostCheck(() => props.host);
</script>
