<template>
    <span class="d-flex align-items-center custom_field_wrapper border-radius-7-px m-20px" :style="[{'border':`1.5px solid ${props.cfPrimaryColor || 'var(--border)'}`}]">
        <span class="custom_field__wrapper-image">
            <ShellIcon v-if="props.icon" :name="props.icon" :size="20" class="custom_field__wrapper-icon" />
            <img v-else :src="getImageData(props.cfIcon)" alt="">
        </span>
        <span class="custom_field__wrapper-tittle">
            <span class="font-ui font-size-14 font-weight-500 line-height-22px custom_field__wrapper-name">{{props.cfTitle}}</span>
            <span class="font-ui font-size-13 font-weight-400 custom_field__wrapper-hint">{{props.cfDescrption}}</span>
        </span>
    </span>
</template>

<script setup>
import ShellIcon from '@/components/organisms/Shell/ShellIcon.vue';
import useCustomFieldImage from '@/composable/customFieldIcon.js';
const { getImageData } = useCustomFieldImage();
    const props = defineProps({
        cfIcon:{
            type:String,
            default:""
        },
        cfDescrption:{
            type:String,
            default:""
        },
        cfTitle:{
            type:String,
            default:""
        },
        cfPrimaryColor:{
            type:String,
            default:""
        },
        icon:{
            type:String,
            default:""
        }
    })
</script>
<style scoped>
    @import './style.css';
    .custom_field__wrapper-icon { display: block; margin: 0 auto; color: var(--ink-2); }
    /* The margin the name had as an h5, before the card became the content of a button. */
    .custom_field__wrapper-name { display: block; margin: 1.67em 0; color: var(--ink); }
    .custom_field__wrapper-hint { color: var(--ink-2); }
    .custom_field__wrapper-image, .custom_field__wrapper-tittle { display: block; }
</style>
