<template>
    <div class="d-flex cursor-pointer align-items-center custom_field_wrapper border-radius-7-px m-20px" :style="[{'border':`1.5px solid ${props.cfPrimaryColor || 'var(--border)'}`}]">
        <div class="custom_field__wrapper-image">
            <ShellIcon v-if="props.icon" :name="props.icon" :size="20" class="custom_field__wrapper-icon" />
            <img v-else :src="getImageData(props.cfIcon)" :alt="props.cfTitle">
        </div>
        <div class="custom_field__wrapper-tittle">
            <h5 class="font-ui font-size-14 font-weight-500 line-height-22px">{{props.cfTitle}}</h5>
            <span class="font-ui font-size-13 font-weight-400 gray">{{props.cfDescrption}}</span>
        </div>
    </div>
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
</style>
