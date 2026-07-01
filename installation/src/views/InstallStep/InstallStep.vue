<template>
    <div class="map-wrapper">
        <div class="card">
            <div style="margin: 60px;">
                <div>
                    <p v-if="mainStep && mainStep !== 100" class="main-text">Please Hold On. Do not refresh the page as we complete the basic installation step.</p>
                    <div class="image-section" v-if="mainStep && mainStep !== 100 && stepDesc[`step${mainStep}Desc`] && stepDesc[`step${mainStep}Desc`].length === 1 && stepDesc[`step${mainStep}Desc`][0].subStep === 2 && stepDesc[`step${mainStep}Desc`][0].status === 'inprogress'">
                        <img :src="inProgressImg" />
                    </div>
                    <div class="image-section" v-if="mainStep && mainStep !== 100 && stepDesc[`step${mainStep}Desc`] && stepDesc[`step${mainStep}Desc`].length === 1 && stepDesc[`step${mainStep}Desc`][0].subStep === 2 && stepDesc[`step${mainStep}Desc`][0].status === 'done'">
                        <img :src="successImg" />
                    </div>
                    <div class="image-section" v-if="mainStep && mainStep !== 100 && stepDesc[`step${mainStep}Desc`] && stepDesc[`step${mainStep}Desc`].length === 1 && stepDesc[`step${mainStep}Desc`][0].subStep === 2 && stepDesc[`step${mainStep}Desc`][0].status === 'error'">
                        <img :src="errorImg" />
                    </div>
                    <div v-if="mainStep && mainStep === 100">
                        <!-- <img :src="successImg" /> -->
                        <p class="text-center">Please Wait a moment</p>
                        <h2 class="text-center">All Step is Done</h2>
                    </div>
                    <div v-if="mainStep && mainStep === 2 && mainStep !== 100">
                        <h1 class="blue title text-center">Verification Your MongoDb</h1>
                        <div v-if="stepDesc[`step${mainStep}Desc`][0].subStep === 1" >
                            <MongoDBVerify @complete="mongoDbVerifySubmit"></MongoDBVerify>
                        </div>
                    </div>
                    <div v-if="mainStep && mainStep === 3 && mainStep !== 100">
                        <h1 class="blue title text-center">Verification Your Storage</h1>
                        <div v-if="stepDesc[`step${mainStep}Desc`][0].subStep === 1" >
                            <StorageVerify @complete="storageVerifySubmit"></StorageVerify>
                        </div>
                    </div>
                    <div v-if="mainStep && mainStep === 4 && mainStep !== 100">
                        <h1 class="blue title text-center">Verification Your Firebase</h1>
                        <div v-if="stepDesc[`step${mainStep}Desc`][0].subStep === 1" >
                            <FirebaseVerify @complete="firebaseVerifySubmit"></FirebaseVerify>
                        </div>
                    </div>
                    <div v-if="mainStep && mainStep === 5 && mainStep !== 100">
                        <h1 class="blue title text-center">Artificial Intelligence</h1>
                        <div v-if="stepDesc[`step${mainStep}Desc`][0].subStep === 1" >
                            <ArtificialIntelligenceVerify @complete="artificialIntelligenceSubmit"></ArtificialIntelligenceVerify>
                        </div>
                    </div>
                    <div v-if="mainStep && mainStep === 6 && mainStep !== 100">
                        <h1 class="blue title text-center">Verification Your SMTP</h1>
                        <div v-if="stepDesc[`step${mainStep}Desc`][0].subStep === 1" >
                            <SMTPVerify @complete="smtpVerifySubmit"></SMTPVerify>
                        </div>
                    </div>
                    <div v-if="mainStep && mainStep === 7 && mainStep !== 100">
                        <h1 class="blue title text-center">Initializations Database</h1>
                    </div>
                    <div v-if="mainStep && mainStep === 8 && mainStep !== 100">
                        <h1 class="blue title text-center">Create Company</h1>
                        <CreateUserAndCompany @complete="createCompanySubmit"></CreateUserAndCompany>
                    </div>
                    <div v-if="mainStep && mainStep === 9 && mainStep !== 100">
                        <h1 class="blue title text-center">Generating Build</h1>
                    </div>
                </div>
                <div v-if="mainStep && mainStep !== 100 && stepDesc[`step${mainStep}Desc`] && stepDesc[`step${mainStep}Desc`].length && stepDesc[`step${mainStep}Desc`].length !== 1">
                    <div style="margin: 30px 0px;">
                        <div class="sub-steps d-flex align-items-center mb-20px" v-for="(row, stepIndex) in stepDesc[`step${mainStep}Desc`]" :key="stepIndex" :class="{'opacity-5' : row.status === 'remaining' }">
                            <span class="">{{row.name}}</span>
                            <img
                                v-if="row.status !== 'remaining'"
                                :src="row.status === 'inprogress' ? inProgressImg : row.status === 'done' ? smallsuccessImg :  smallerrorImg"
                                width="25"
                                height="25"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
    // PACKAGES
    import { defineComponent, onMounted, ref } from "vue";
    import * as env from '@/config/env';
    import { apiRequest } from "../../services";
    import {useToast} from 'vue-toast-notification';
    import CreateUserAndCompany from "./CreateUserAndCompany.vue";
    import MongoDBVerify from "./MongoDBVerify.vue";
    import StorageVerify from "./StorageVerify.vue";
    import FirebaseVerify from "./FirebaseVerify.vue";
    import ArtificialIntelligenceVerify from "./ArtificialIntelligenceVerify.vue";
    import SMTPVerify from "./SMTPVerify.vue";
    import inProgressImg from "@/assets/images/svg/inprogress.gif";
    import successImg from "@/assets/images/svg/sucess.svg";
    import smallsuccessImg from "@/assets/images/svg/smallsucess.svg";
    import errorImg from "@/assets/images/svg/error.svg";
    import smallerrorImg from "@/assets/images/svg/smallerror.svg";
    const $toast = useToast();
    
    defineComponent({
        name: "install-step-page"

    });

    const stepData = ref({});
    const mainStep = ref(0);
    const isMainStep = ref(true);
    const stepDesc = ref({
        step1Desc: [{
            step: 1,
            name: "Domain Checking",
            status: "inprogress",
            subStep: 1
        }],
        step2Desc: [{
            step: 1,
            name: "Verification Your Mongodb",
            status: "inprogress",
            subStep: 1
        }],
        step3Desc: [{
            step: 1,
            name: "Verification Your Storage",
            status: "inprogress",
            subStep: 1
        }],
        step4Desc: [{
            step: 1,
            name: "Verification Your Firebase",
            status: "inprogress",
            subStep: 1
        }],
        step5Desc: [{
            step: 1,
            name: "Artificial Intelligence",
            status: "inprogress",
            subStep: 1
        }],
        step6Desc: [{
            step: 1,
            name: "Verification Your SMTP",
            status: "inprogress",
            subStep: 1
        }],
        step7Desc: [{
            step: 1,
            name: "Initializations Database",
            status: "inprogress",
            subStep: 2
        }],
        step8Desc: [{
            step: 1,
            name: "Create Company",
            status: "inprogress",
            subStep: 1
        }],
        step9Desc: [{
            step: 1,
            name: "Generating Build",
            status: "inprogress",
            subStep: 2
        }]
    })
    function startCallingSteps(bData, bodyData) {
        mainStep.value = bData.step;
        const evId = `ev_${Math.random().toString(16).slice(2)}`;

        // SMTP STEP And CREATE COMPANY
        if (
            (bData.step === 2 && stepDesc.value.step2Desc[0].subStep === 1) ||
            // (bData.step === 3 && stepDesc.value.step3Desc[0].subStep === 1) ||
            (bData.step === 3 && stepDesc.value.step3Desc[0].subStep === 1) ||
            (bData.step === 4 && stepDesc.value.step4Desc[0].subStep === 1) ||
            (bData.step === 5 && stepDesc.value.step5Desc[0].subStep === 1) ||
            bData.step === 6 ||
            bData.step === 8
            ) {
            return;
        }
        
        const source = new EventSource(`${env.API_URI}/api/v1/checkinstallstep/events/${evId}`);
        let step;
        source.onmessage = function(event) {
            // Parse the event data (the progress update)
            const data = JSON.parse(event.data)?.data;
            if (data?.step && data?.step !== 100) {
                step = data?.step;
                stepDesc.value[`step${bData.step}Desc`][step-1].status = "done";
                if (stepDesc.value[`step${bData.step}Desc`].length > step) {
                    stepDesc.value[`step${bData.step}Desc`][step].status = "inprogress";
                }
            } else {
                source.close();
                if (data?.error) {
                    if (!step) {
                        stepDesc.value[`step${bData.step}Desc`][0].status = "error";
                        setTimeout(() => {
                            if (bData.step === 9) {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                            } else {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                            }
                        }, 2000)
                    } else {
                        stepDesc.value[`step${bData.step}Desc`][0].status = "error";
                        setTimeout(() => {
                            if (bData.step === 9) {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                            } else {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                            }
                        }, 2000)
                    }
                    // Error Message
                    return;
                }
                stepDesc.value[`step${bData.step}Desc`][stepDesc.value[`step${bData.step}Desc`].length-1].status = "done";
            }
        };
        source.onerror = function(error) {
            console.error("Event error", error);
            stepDesc.value[`step${bData.step}Desc`][step].status = "done";
            source.close(); // Close the connection in case of error
        };
        try {
            let installStepData = {
                eventId : evId,
                step: bData.step
            };
            if (bodyData) {
                installStepData = {...installStepData, ...bodyData}
            }
            apiRequest("post", env.INSTALL_STEP, installStepData).then((res) => {
                if (res.data.status === true) {
                    if (stepData.value.data[bData.step]) {
                        source.close();
                        mainStep.value = bData.step;
                        startCallingSteps(stepData.value.data[bData.step]);
                    } else {
                        source.close();
                        mainStep.value = 100;
                        setTimeout(() => {
                            window.location.reload();
                        }, 5000);
                    }
                } else {
                    source.close();
                    // Add Error Message
                    $toast.error(`Please check your credentials. ${res.data.error}`,{position: 'top-right'});
                    if (!step) {
                        stepDesc.value[`step${bData.step}Desc`][0].status = "error";
                        setTimeout(() => {
                            if (bData.step === 9) {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                            } else {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                            }
                        }, 2000)
                    } else {
                        stepDesc.value[`step${bData.step}Desc`][0].status = "error";
                        setTimeout(() => {
                            if (bData.step === 9) {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                            } else {
                                stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                            }
                        }, 2000)
                    }
                }
            }).catch((err) => {
                source.close();
                // Add Error Message
                console.error("ERROR IN INSTALL STEP", err);
                stepDesc.value[`step${bData.step}Desc`][0].status = "error";
                
                setTimeout(() => {
                    if (bData.step === 9) {
                        stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                    } else {
                        stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                    }
                    window.location.reload();
                }, 2000)
            })
        } catch (error) {
            source.close();
            // Add Error Message
            stepDesc.value[`step${bData.step}Desc`][0].status = "error";
            setTimeout(() => {
                if (bData.step === 9) {
                    stepDesc.value[`step${bData.step}Desc`][0].subStep = 2;
                } else {
                    stepDesc.value[`step${bData.step}Desc`][0].subStep = 1;
                }
                window.location.reload();
            }, 2000)
        }
    }
    
    function createCompanySubmit() {
        mainStep.value = 9;
        stepDesc.value.step9Desc[0].subStep = 2;
        stepDesc.value.step9Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[8]);
    }
    function mongoDbVerifySubmit(data) {
        mainStep.value = 2;
        stepDesc.value.step2Desc[0].subStep = 2;
        stepDesc.value.step2Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[1], data);
    }
    function storageVerifySubmit(data) {
        mainStep.value = 3;
        stepDesc.value.step3Desc[0].subStep = 2;
        stepDesc.value.step3Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[2], data);
    }
    function firebaseVerifySubmit(data) {
        mainStep.value = 4;
        stepDesc.value.step4Desc[0].subStep = 2;
        stepDesc.value.step4Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[3], data);
    }
    function artificialIntelligenceSubmit(data) {
        mainStep.value = 5;
        stepDesc.value.step5Desc[0].subStep = 2;
        stepDesc.value.step5Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[4], data);
    }
    function smtpVerifySubmit() {
        mainStep.value = 7;
        stepDesc.value.step7Desc[0].subStep = 2;
        stepDesc.value.step7Desc[0].status = "inprogress";
        startCallingSteps(stepData.value.data[6]);
    }
    
    onMounted(() => {
        isMainStep.value = true;
        try {
            apiRequest("get", env.INSTALL_STEP_GET).then((getStepData) => {
                stepData.value = getStepData.data;
                if (getStepData.data.status === true) {
                    const getErrorData = (getStepData.data.data || []).filter((x) => x.status === 'error');
                    if (getErrorData && getErrorData.length) {
                        startCallingSteps(getErrorData[0]);
                        return;
                    }

                    const getInprogressData = (getStepData.data.data || []).filter((x) => x.status === 'inprogress');
                    if (getInprogressData && getInprogressData.length) {
                        startCallingSteps(getInprogressData[0]);
                        return;
                    }
                    const getDoneData = (getStepData.data.data || []).filter((x) => x.status === 'done');

                    if (getDoneData.length === getStepData.data.data.length) {
                        mainStep.value = 100;
                        console.log("All Step Is Done");
                        setTimeout(() => {
                            window.location.reload();
                        }, 5000);
                        return;
                    }

                    if (!(getDoneData && getDoneData.length) && !(getInprogressData && getInprogressData.length)) {
                        startCallingSteps(getStepData.data.data[0]);
                        return;
                    }
                    if (getDoneData && getDoneData.length && !(getInprogressData && getInprogressData.length)) {
                        startCallingSteps(getStepData.data.data[getDoneData.length]);
                    }
                } else {
                    mainStep.value = 0;
                    isMainStep.value = false;
                }
            }).catch((err) => {
                isMainStep.value = false;
                console.error("ERROR IN INSTALL STEP GET 1: ", err);
            })
        } catch (error) {
            mainStep.value = 0;
            isMainStep.value = false;
            console.error("ERROR IN INSTALL STEP GET 2: ", error);
        }
    })
</script>

<style src="./style.css">
</style>
