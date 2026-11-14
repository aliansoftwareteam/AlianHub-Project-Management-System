<template>
    <span class="cx-tile" :class="[`cx-tile--${size}`, { 'cx-tile--logo': logo }]" aria-hidden="true">
        <img v-if="logo" :src="logo" alt="" class="cx-tile__logo" draggable="false" />
        <span v-else class="cx-tile__initials">{{ initials }}</span>
    </span>
</template>

<script setup>
import { computed } from "vue";
import canva from "@/assets/images/connectors/canva.svg";
import dropbox from "@/assets/images/connectors/dropbox.svg";
import github from "@/assets/images/connectors/github.svg";
import google from "@/assets/images/connectors/google.svg";
import hubspot from "@/assets/images/connectors/hubspot.svg";
import notion from "@/assets/images/connectors/notion.svg";
import outlook from "@/assets/images/connectors/outlook.svg";
import slack from "@/assets/images/connectors/slack.svg";
import supabase from "@/assets/images/connectors/supabase.svg";
import upwork from "@/assets/images/connectors/upwork.svg";
import wisprflow from "@/assets/images/connectors/wisprflow.png";
import { initialsOf } from "./connectorCatalog";

defineOptions({ name: "ConnectorTile" });

/* A custom server has no logo of its own, so it keeps its initials. */
const LOGOS = Object.freeze({ canva, dropbox, github, google, hubspot, notion, outlook, slack, supabase, upwork, wisprflow });

const props = defineProps({
    provider: { type: String, required: true },
    name: { type: String, default: "" },
    size: { type: String, default: "md" }
});

const logo = computed(() => LOGOS[props.provider] || "");
const initials = computed(() => initialsOf(props.name || props.provider));
</script>

<style scoped>
.cx-tile { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--r-card); background: var(--brand-tint); color: var(--brand); overflow: hidden; }
.cx-tile--lg { width: 44px; height: 44px; }
.cx-tile--logo { background: var(--logo-plate); border: 1px solid var(--hairline); }
.cx-tile__logo { width: 22px; height: 22px; object-fit: contain; }
.cx-tile--lg .cx-tile__logo { width: 26px; height: 26px; }
.cx-tile__initials { font: 600 13px/1 var(--font-ui); letter-spacing: .02em; }
.cx-tile--lg .cx-tile__initials { font-size: 15px; }
</style>
