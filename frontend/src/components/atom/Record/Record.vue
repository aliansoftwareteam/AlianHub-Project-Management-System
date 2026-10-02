<template>
    <img v-if="!modelValue" @click="sendMeassageAllowed ? record() : null" :src="microphone" alt="microphone" class="mx-1 cursor-pointer" :style="`${!sendMeassageAllowed ? 'cursor: not-allowed !important;' : ''}`" >
    <template v-else>
        <img :src="closeIcon" @click="cancelRecord()" alt="closeIcon" class="mx-1 cursor-pointer">
        <button class="btn-primary ml-1 border-radius-8-px record__btn" @click="stopRecord(true)"><img :src="sendIcon" alt="sendIcon" class="cursor-pointer"></button>
    </template>
    <audio class="d-none" id="audioPlayer" controls @pause="(e) => {e.preventDefault()}"></audio>
</template>

<script setup>
// PACKAGES
import { defineComponent, ref } from "vue";
import MicRecorder from 'mic-recorder-to-mp3'
import moment from "moment";
import { useCustomComposable } from "@/composable";

// UTILS
const {addZero, makeUniqueId} = useCustomComposable();
const recorder = new MicRecorder({
    bitRate: 128
});

// IMAGES
const microphone = require("@/assets/images/footermicrophone.svg");
const closeIcon = require("@/assets/images/svg/CloseSidebar_red.svg");
const sendIcon = require("@/assets/images/footerbtnsend.svg");

defineComponent({
    name: "RecordComponent"
})

const props = defineProps({
    modelValue: {
        type: Boolean,
        required: true
    },
    recordingProgress: {
        type: Number,
        required: true
    },
    recordTime: {
        type: String,
        required: true
    },
    sendMeassageAllowed : {
        type: Boolean,
        required: true
    }
})

const emit = defineEmits(["update:modelValue", "update:recordingProgress", "update:recordTime", "stop", "cancel"])

const recordInterval = ref(null);
const recordedData = ref({});

/* --------------- RECORD MESSAGES --------------- */
// DETECT MICROPHONE
function getDetectRTCData(){
    var DetectRTC = require('detectrtc')
    return new Promise((resolve,reject) => {
        try {
            DetectRTC.load(function() {
                if(DetectRTC.hasMicrophone) {
                    resolve(DetectRTC.hasMicrophone);
                } else {
                    resolve(DetectRTC.hasMicrophone);
                }
            })
        } catch (error) {
            reject(error);
        }
    })
}

// START RECORD
function record() {
    getDetectRTCData().then((res) => {
        if(res == true){
            recorder.start().then((val) => {
                emit('update:modelValue', true)
                handleSuccess(val)
            }).catch((e) => {
                console.error(e);
            });
        } else {
            alert("Microphone is not connected");
        }
    })
    .catch((error) => {
        console.error("ERROR in DETECTING RTC", error);
    })
    ;
}

// START AUDIO PLAYER ON SUCCESS
function handleSuccess(stream) {
    // var self = this;
    const player = document.getElementById('audioPlayer');
    try{
        if ("srcObject" in player) {
            player.srcObject = stream;
        }
        else {
            player.src = window.URL
            .createObjectURL(stream);
        }
        let count = 0;
        emit("update:recordTime", "00:00");
        emit("update:recordingProgress", 0);
        recordInterval.value = setInterval(() => {
            count += 1;
            let time = moment.duration(count, 'seconds');
            emit("update:recordTime", `${addZero(time.minutes())}:${addZero(time.seconds())}`);
            emit("update:recordingProgress", props.recordingProgress + 0.3333333333333333);

            if(props.recordingProgress > 100) {
                clearInterval(recordInterval.value);
                emit("update:recordingProgress", 0);
                count = 0;
            }
        }, 1000)
        player.onloadedmetadata = function () {
            player.play();

            if(props.modelValue) {
                setTimeout(() => {
                    stopRecord(false);
                }, 301000);
            }
        };
    } catch (error) {
        console.error("ERROR in modelValue: ", error);
    }
}

// STOP RECORDING
function stopRecord(directUpload = true){
    const playerAudio = document.getElementById('audioPlayer');
    recorder
    .stop()
    .getMp3().then(([buffer, blob]) => {
        emit("update:modelValue", false);
        emit("update:recordingProgress", 0);
        emit("update:recordTime", "00:00")
        clearInterval(recordInterval.value);
        const file = new File(buffer, 'Recorded.mp3', {
            type: blob.type,
            lastModified: Date.now()
        });
        playerAudio.src = URL.createObjectURL(file);

        recordedData.value = {
            file: {
                data: file,
                name:`audio_${makeUniqueId()}.mp3`,
                fileType: "audio"
            },
        };
        if(directUpload) {
            // self.sendMediaFile([{data: file, name:"audio.mp3", fileType: "audio"}]);
            emit("stop", recordedData.value);
        } else {
            // self.showModalRecord = true;
            emit("stop", recordedData.value);
        }
    }).catch((e) => {
        alert('We could not retrieve your message');
        console.error("ERROR in record stop: ",e)
    });
}

// CANCEL RECORDING
function cancelRecord() {
    clearInterval(recordInterval.value);
    emit("update:recordingProgress", 0);
    emit("update:recordTime", "00:00");

    recorder.stop().getMp3()
    .then(()=>{
        emit("update:modelValue", false)
        emit("cancel");
    })
    .catch(error=>{
        console.error("ERROR in record cancel: ",error)
    })
}
/* --------------- RECORD MESSAGES END --------------- */
</script>

<style scoped>
.record__btn{
    width: 54px !important;
    height: 54px !important;
}
</style>