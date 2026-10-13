<template>
    <div class="upw">
        <div class="upw__pin">
            <div class="upw__card">
                <div v-if="props.isImage" class="mb-30px">
                    <img class="upw__image" :src="upgradePlan" alt="">
                </div>
                <div>
                    <h3 class="upw__title font-size-22 font-weight-700 text-center line-height-33">
                        {{firstTitle}} <span class="upw__accent">{{secondTitle}}</span> {{lastTitle}}
                    </h3>
                    <p class="upw__message font-size-16 font-weight-400 text-center line-height-23-68 mt-10px mb-20px">
                        {{props.message}}
                    </p>
                    <button @click="router.push({name: 'Upgrade', params: {cid: companyId}})" class="upw__btn cursor-pointer font-size-16 font-weight-400 text-center line-height-23-68 border-0 border-radius-4-px p3x-14px">
                        {{buttonText}}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
<script setup>
    import { useRouter } from "vue-router";
    const router = useRouter();
    //upgradePlan
    const upgradePlan = require("@/assets/images/png/upgradePlan.png");
    // props
    const props = defineProps({
        isImage:{
            type:Boolean,
            default:true
        },
        message:{
            type:String,
            default:""
        },
        firstTitle:{
            type:String,
            default:""
        },
        secondTitle:{
            type:String,
            default:""
        },
        lastTitle:{
            type:String,
            default:""
        },
        buttonText:{
            type:String,
            default:""
        }
    });
</script>

<style scoped>
/* The wall lies over the whole block it locks, and the notice is pinned inside it to the part that is on
   screen: centred in a block that fits the window, as before, and kept in view down a block that is longer. */
.upw { position: absolute; inset: 0; z-index: 1; box-sizing: border-box; pointer-events: none; }
.upw__pin { position: sticky; top: 0; height: min(100%, 85dvh); display: flex; align-items: center; justify-content: center; }
.upw__card { box-sizing: border-box; width: 100%; padding: 0 var(--sp-8); text-align: center; pointer-events: auto; }
.upw__image { max-width: 100%; height: auto; }
.upw__title { color: var(--ink); }
.upw__accent { color: var(--brand); }
.upw__message { color: var(--ink-label); }
/* #15803d keeps the green call to action at 5:1 under white text; #28C76F was 2.2:1. */
.upw__btn { background: #15803d; color: #fff; }
.upw__btn:hover { background: #166534; }
</style>
