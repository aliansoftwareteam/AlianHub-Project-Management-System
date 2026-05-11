<template>
    <div class="container">
        <div class="box">
        <p>
            If you are not automatically redirected, click or tap
            <strong>Continue</strong> button.
        </p>
        <button @click="redirect" class="continue_btn">Continue</button>
        </div>
    </div>
</template>
<script setup>
    import {onMounted,inject} from 'vue';
    import { tokenStore } from '@/services/tokenStore';
    const userId = inject("$userId");
    const refreshToken = tokenStore.getRefreshToken();
    onMounted(()=>{
        redirect();
    })

    function redirect() {
        window.location.href = `myapp://authorize?client_id=${userId.value}&client_secret=${refreshToken}`
    }
</script>
<style scoped>
    .container {
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: #f0f4f8;
    }

    .box {
        border: 2px solid #333;
        padding: 20px;
        background: #fff;
        box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        text-align: center;
    }

    .continue_btn {
        font-size: 16px;
        background: #2f3990 !important;
        padding: 7px 10px;
        height: 30px;
        border-radius: 4px;
        border: 0;
        color: #fff;
        cursor: pointer;
        margin-left: 15px;
    }
</style>