<script setup>
import { defineProps } from 'vue';

const props = defineProps({
    title: {
        type: String,
        required: true
    },
    alt: {
        type: String,
        required: true,
        default:"Feature illustration"
    },
    description: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: null
    },
    backgroundColor: {
        type: String,
        default: ''
    },
    badge: {
        type: String,
        default: null
    }
});
</script>

<template>
    <div class="feature-card">
        <div class="card-image" :style="[{'background-color': props.backgroundColor}]">
            <img v-if="props.image" :src="image" :alt="props.alt" />
            <slot name="image" v-else></slot>

            <span v-if="props.badge" class="badge">{{ props.badge }}</span>
        </div>

        <div class="card-content">
            <h3 class="card-title" :title="props.title">{{ props.title }}</h3>
            <p class="para-overflow card-description" :title="props.description">{{ props.description }}</p>
        </div>
    </div>
</template>

<style scoped>
.feature-card {
    background-color: var(--surface);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
    width: 100%;
    height: 14.375rem;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    overflow: hidden;
}

.feature-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
}

.card-image {
    flex: 135px;
    max-height: 135px;
    overflow: hidden;
    text-align: center;
}
.card-image img {
    margin: 12px 12px 0px 12px;
    max-width: 250px;
    max-height: fit-content;
}

.badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background-color: var(--surface);
    color: var(--ink);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
}

.card-content {
    flex: 72px;
    padding: 12px 16px 16px 16px;
}

.card-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    padding: 0;
    margin-bottom: 8px !important;
    color: var(--ink);
}

.card-description {
    margin: 0;
    padding: 0;
    font-size: 14px;
    color: var(--ink-2);
    line-height: 1.5;
    -webkit-line-clamp: 2 !important;
}
@media(max-width:1199px){
    .card-image img  {
        max-width: 230px;
    }
}
@media(max-width:480px){
    .card-image img  {
        max-width: 225px;
    }
}
</style>