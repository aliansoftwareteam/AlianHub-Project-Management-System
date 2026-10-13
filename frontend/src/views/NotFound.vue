<template>
    <AppState kind="notfound" :title="$t('Inbox.state_route_notfound_title')" :body="$t('Inbox.state_route_notfound_body')" />
</template>

<script setup>
import AppState from '@/components/molecules/AppState/AppState.vue';

defineOptions({ name: 'NotFound' });
</script>
