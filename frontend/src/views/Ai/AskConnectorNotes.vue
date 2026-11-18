<template>
    <ul v-if="proposals.length || notes.length" class="ask-apps" data-test="ask-apps">
        <li v-for="(waiting, index) in proposals" :key="`waiting-${waiting.proposalId || index}`" class="ask-apps__row" data-test="ask-app-waiting">
            <ShellIcon name="inbox" :size="13" />
            <span>{{ $t('Ask.connector_waiting', { app: waiting.app }) }}</span>
            <router-link class="ask-apps__link" :to="{ name: 'AiInbox', params: { cid: companyId } }">{{ $t('Ask.connector_open_inbox') }}</router-link>
        </li>
        <li v-for="(note, index) in notes" :key="`note-${note.provider}-${index}`" class="ask-apps__row ask-apps__row--note" data-test="ask-app-note">
            <ShellIcon name="alert" :size="13" />
            <span>{{ noteText(note) }}</span>
            <router-link v-if="CONNECT_CODES.includes(note.code)" class="ask-apps__link" :to="{ name: 'Connections', params: { cid: companyId } }">{{ $t('Ask.connector_open_connections') }}</router-link>
        </li>
    </ul>
</template>

<script setup>
import { computed, inject, unref } from "vue";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { connectorNoteKey } from "./askComposer";

defineOptions({ name: "AskConnectorNotes" });

const props = defineProps({
    connectors: { type: Object, default: () => ({}) }
});

const CONNECT_CODES = Object.freeze(["not_connected", "broken", "scope_missing"]);

const { t } = useI18n();
const injectedCompany = inject("$companyId", "");
const companyId = computed(() => unref(injectedCompany));

const proposals = computed(() => (Array.isArray(props.connectors.proposals) ? props.connectors.proposals : []));
const notes = computed(() => (Array.isArray(props.connectors.notes) ? props.connectors.notes : []));

/* A code the screen knows is said in the asker's language; any other keeps the server's own sentence. */
const noteText = (note) => {
    const key = connectorNoteKey(note.code);
    return key ? t(key, { app: note.app }) : String(note.text || "");
};
</script>

<style>
.ask-apps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.ask-apps__row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); color: var(--ink); font: var(--text-small); }
.ask-apps__row--note { color: var(--ink-2); }
.ask-apps__link { font-weight: 600; }
</style>
