<template>
    <div class="mt-card" data-test="maintenance-card">
        <section class="ah-card mt-card__box" aria-labelledby="mt-card-title">
            <h1 id="mt-card-title" class="ah-h2">{{ $t('Instance.maintenance_card_title') }}</h1>
            <p class="mt-card__body">{{ $t('Instance.maintenance_card_body') }}</p>
        </section>
    </div>
</template>

<script setup>
defineOptions({ name: "MaintenanceCard" });
</script>

<style scoped>
.mt-card { display: flex; justify-content: center; padding: 18dvh 16px 48px; }
.mt-card__box { max-width: 480px; width: 100%; padding: 24px; text-align: center; }
.mt-card__body { margin: 8px 0 0; font: var(--text-body); color: var(--ink-2, var(--ink)); }
</style>
