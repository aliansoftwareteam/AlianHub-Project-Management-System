<template>
    <button v-if="installAvailable" type="button" class="ah-pop__item" role="menuitem" data-test="install-app" @click="install">
        <ShellIcon name="download" :size="size" /><span>{{ $t('Shell.install_app') }}</span>
    </button>
</template>

<script setup>
import { defineEmits, defineProps } from 'vue';
import ShellIcon from './ShellIcon.vue';
import { installAvailable, promptInstall } from '@/serviceWorker/installPrompt';

defineOptions({ name: 'InstallAppItem' });
defineProps({ size: { type: Number, default: 15 } });
const emit = defineEmits(['done']);

const install = async () => {
    await promptInstall();
    emit('done');
};
</script>
