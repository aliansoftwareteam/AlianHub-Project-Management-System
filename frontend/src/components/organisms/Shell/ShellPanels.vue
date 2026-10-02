<template>
    <NotepadPanel v-model="shellState.notepad" />
    <ClipsPanel v-model="shellState.clips" />
    <ReminderPanel v-model="shellState.reminders" />
    <ClipRecorder />
    <TalkToTextPopover v-model="shellState.talkToText" />
</template>

<script setup>
import ReminderPanel from "@/components/molecules/GeneralReminder/ReminderPanel.vue";
import { NotepadPanel, ClipsPanel, ClipRecorder, TalkToTextPopover } from "@/config/shellParts";
import { shellState } from "./shellState";
</script>
