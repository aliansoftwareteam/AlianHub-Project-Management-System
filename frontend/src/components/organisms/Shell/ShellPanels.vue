<template>
    <NotepadPanel v-model="shellState.notepad" />
    <ClipsPanel v-model="shellState.clips" />
    <ReminderPanel v-model="shellState.reminders" />
    <ClipRecorder />
    <TalkToTextPopover v-model="shellState.talkToText" />
</template>

<script setup>
import NotepadPanel from "@/components/molecules/Notepad/NotepadPanel.vue";
import ClipsPanel from "@/components/molecules/Clips/ClipsPanel.vue";
import ReminderPanel from "@/components/molecules/GeneralReminder/ReminderPanel.vue";
import ClipRecorder from "@/components/molecules/ClipRecorder/ClipRecorder.vue";
import TalkToTextPopover from "@/components/molecules/TalkToText/TalkToTextPopover.vue";
import { shellState } from "./shellState";
</script>
