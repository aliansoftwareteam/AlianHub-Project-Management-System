<template>
    <div class="userAndCompanyWrapper">
        <div class="mb-10 text-center" style="color:red;font-size:20px;font-weight:500">{{errorMessage}}</div>

        <div class="install-form" v-if="!isCompanyProcess">
            <div class="row">
                <div class="col-md-6">
                    <span class="formLabel">First Name </span>
                    <input 
                        class="install-form-control mt-10"
                        type="text" 
                        placeholder="Enter FirstName"
                        v-model="formData.firstName.value"
                        :maxlength="25"
                        @keyup="checkErrors({'field':formData.firstName,
                        'name':formData.firstName.name,
                        'validations':formData.firstName.rules,
                        'type':formData.firstName.type,
                        'event':$event.event})"
                    />
                    <div class="errorMessage">{{ formData.firstName.error }}</div>
                </div>
                <div class="col-md-6">
                    <span class="formLabel">Last Name </span>
                    <input 
                        class="install-form-control mt-10"
                        type="text" 
                        placeholder="Enter LastName"
                        :maxlength="25"
                        v-model="formData.lastName.value"
                        @keyup="checkErrors({'field':formData.lastName,
                        'name':formData.lastName.name,
                        'validations':formData.lastName.rules,
                        'type':formData.lastName.type,
                        'event':$event.event})"
                    />
                    <div class="errorMessage">{{ formData.lastName.error }}</div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <span class="formLabel">Email </span>
                    <input 
                        class="install-form-control mt-10"
                        type="text" 
                        placeholder="Enter Email"
                        :maxlength="254"
                        v-model.trim="formData.email.value"
                        @keyup="checkErrors({'field':formData.email,
                        'name':formData.email.name,
                        'validations':formData.email.rules,
                        'type':formData.email.type,
                        'event':$event.event})"
                    />
                    <div class="errorMessage">{{ formData.email.error }}</div>
                </div>
                <div class="col-md-6">
                    <span class="formLabel">Company Name</span>
                    <input 
                        class="install-form-control mt-10"
                        type="text" 
                        placeholder="Enter Company Name"
                        v-model="formData.companyName.value"
                        :maxlength="25"
                        @keyup="checkErrors({'field':formData.companyName,
                        'name':formData.companyName.name,
                        'validations':formData.companyName.rules,
                        'type':formData.companyName.type,
                        'event':$event.event})"
                    />
                    <div class="errorMessage">{{ formData.companyName.error }}</div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <span class="formLabel">Password </span>
                    <input
                        class="install-form-control mt-10"
                        type="password" 
                        placeholder="Enter Password"
                        :maxlength="15"
                        v-model="formData.password.value"
                        @keyup="checkErrors({'field':formData.password,
                        'name':formData.password.name,
                        'validations':formData.password.rules,
                        'type':formData.password.type,
                        'event':$event.event}),updateConfirmation()"
                    />
                    <div class="errorMessage">{{ formData.password.error }}</div>
                </div>
                <div class="col-md-6">
                    <span class="formLabel">Confirm Password </span>
                    <input 
                        class="install-form-control mt-10"
                        type="password" 
                        placeholder="Enter Confirm Password"
                        :maxlength="15"
                        v-model="formData.confirmPassword.value"
                        @keyup="confirmationPassValidation()"
                        />
                    <div class="errorMessage">{{ confirmationErr }}</div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <span class="formLabel">Phone Number </span>
                    <div style="display: flex;">
                        <select class="install-form-control mt-10" v-model="formData.phoneCode.value" style="width: 50%;margin-right: 5px; padding: 0 5px;">
                            <option disabled value="">Select PhoneCode</option>
                            <option v-for="(phoneCodes,index) in phoneCode" :key="index" :value="phoneCodes.value">
                                {{phoneCodes.label}}
                            </option>
                        </select>
                        <input 
                            class="install-form-control mt-10"
                            type="text" 
                            placeholder="Enter Phone Number"
                            v-model="formData.phoneNumber.value"
                            :maxlength="25"
                            @keyup="checkErrors({'field':formData.phoneNumber,
                            'name':formData.phoneNumber.name,
                            'validations':formData.phoneNumber.rules,
                            'type':formData.phoneNumber.type,
                            'event':$event.event})"
                        />
                    </div>
                    <div class="errorMessage">{{ formData.phoneNumber.error === '' ? formData.phoneCode.error : formData.phoneNumber.error }}</div>
                </div>
                <div class="col-md-6">
                    <span class="formLabel">Country </span>
                    <select class="install-form-control mt-10" v-model="formData.country.value" @change="setState()">
                        <option disabled value="">Select Country</option>
                        <option v-for="(countries,index) in coutryArray" :key="index">
                            {{countries?.key}}
                        </option>
                    </select>
                    <div class="errorMessage">{{ formData.country.error }}</div>
                </div>
            </div>
            <div class="row">
                <div class="col-md-6">
                    <span class="formLabel">State </span>
                    <select class="install-form-control mt-10" v-model="formData.state.value" @change="setCity()">
                        <option disabled value="">Select State</option>
                        <option v-for="(states,index) in stateArray" :key="index">
                            {{states.key}}
                        </option>
                    </select>
                    <div class="errorMessage">{{ formData.state.error }}</div>
                </div>
                <div class="col-md-6">
                    <span class="formLabel">City </span>
                    <select class="install-form-control mt-10" v-model="formData.city.value">
                        <option disabled value="">Select City</option>
                        <option v-for="(city,index) in cityArray" :key="index">
                            {{city.key}}
                        </option>
                    </select>
                    <div class="errorMessage">{{ formData.city.error }}</div>    
                </div>
            </div>
            <div class="row">
                <div class="col-md-12">
                    <span class="formLabel">What does your team mainly do?</span>
                    <select class="install-form-control mt-10" v-model="formData.teamFocus.value">
                        <option value="">Something else / not sure</option>
                        <option value="software">Building software</option>
                        <option value="marketing">Marketing and campaigns</option>
                        <option value="design">Design and creative work</option>
                        <option value="support">Customer support</option>
                        <option value="hiring">Hiring and HR</option>
                    </select>
                    <div class="mt-10 font-size-14 grey">Optional. It decides which example project you start with — nothing else, and you can delete it.</div>
                </div>
            </div>
            <div>
                <div class="mt-20 font-size-20">
                    For any further queries, please refer to our <a href="https://help.alianhub.com/app-installation-and-start-guide/4.-installation-guide/4.10-final-step" target="_blank" class="blue font-weight-600">documentation.</a>
                </div>
                <button type="submit" class="btn-blue btn-login font-roboto-sans bg-blue white cursor-pointer btn-full mt-20 mb-0-i" @click="addUserAndCompany" :disabled="isSpinner" :class="{'disabled': isSpinner}">Submit</button>
            </div>
        </div>
        <!-- <div class="map-wrapper" v-if="isCompanyProcess"> -->
            <!-- <div class="card"> -->
                <div v-if="isCompanyProcess">
                    <div v-if="stepDesc && stepDesc.length && stepDesc.length !== 1">
                        <div style="margin: 30px 0px;">
                            <div class="sub-steps d-flex align-items-center mb-20px" v-for="(row, stepIndex) in stepDesc" :key="stepIndex" :class="{'opacity-5' : row.status === 'remaining' }">
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
            <!-- </div> -->
        <!-- </div> -->
        <!-- <Modal v-model="isCompanyProcess" :header="false" :footer="false" >
            <template #body>
                <div>
                    <div class="pr-2 pl-2 pt-5 pb-5 text-center main-text">
                        {{stepCompanyProcessMessage}} 
                        <div class="mt-3">
                            <img :src="inProgressImg" />
                        </div>
                    </div>
                </div>
            </template>
        </Modal> -->
    </div>
</template>
<script setup>
    import { ref,nextTick, onMounted, computed, defineEmits } from "vue";
    import { Country, State,City }  from 'country-state-city';
    import axios from 'axios';
    import * as env from '@/config/env';
    // import Modal from "@/components/atom/Modal/Modal.vue";
    import inProgressImg from "@/assets/images/svg/inprogress.gif";
    import smallsuccessImg from "@/assets/images/svg/smallsucess.svg";
    import smallerrorImg from "@/assets/images/svg/smallerror.svg";
    const emit = defineEmits(["complete"]);
    const isCompanyProcess = ref(false);
    const stepDesc = ref([{
            step: 1,
            name: "Creating Company",
            status: "inprogress"
        }, {
            step: 2,
            name: "Creating Bucket",
            status: "remaining"
        }, {
            step: 3,
            name: "Import Default Settings",
            status: "remaining"
        }, {
            step: 4,
            name: "Adding Snapshot Permission",
            status: "remaining"
        }, {
            step: 5,
            name: "Finalization of Company",
            status: "remaining"
        }
    ]);
    const stepCompanyProcessMessage = ref("");
    const isSpinner = ref(false);
    const errorMessage = ref("");
    const confirmationErr = ref("");
    // const coutryArray = ref([]);
    const stateArray = ref([]);
    const cityArray = ref([]);
    const phoneCode = ref([]);
    const en = {
        generalErrorMessage: {
            fieldIsRequired: 'field is required',
        },
        //Login Process Messages
        authErrorMessage: {
            emailError: 'The email field must be a valid email',
            passwordValid: 'The password field must be at least 8 characters',
            currentPasswordValid: 'The current password field must be at least 8 characters',
            newPasswordValid: 'The new password field must be at least 8 characters',
            validPassRegex:'passwords must be at least 8 characters long, and contain at least 1 alphabet,1 uppercase, 1 numeric, and 1 special character',
            confirmPasswordValid: 'The confirm password confirmation does not match',
            validCharacters: 'The first name field may only contain alphabetic characters as well as spaces',
            minMust: 'must be at least 3 characters',
            currentPassword:'current passwords must be at least 8 characters long, and contain at least 1 alphabet,1 uppercase, 1 numeric, and 1 special character',
            newPassword:'new passwords must be at least 8 characters long, and contain at least 1 alphabet,1 uppercase, 1 numeric, and 1 special character'
        },
        //Create Company Process Messages
        companyErrorMessage: {
            phoneNumberValid:'The phone number field must be at least 10 characters'
        },
        email: 'Email',
        password: 'Password',
        firstName:'first name',
        lastName:'last name',
        phoneNumber:'phone number',
        currentPassword:'current password',
        newPassword:'new password'
    }
    const formData = ref({
        firstName: {
            value: "",
            rules:
            "required | regex:^[a-zA-Z]+$",
            name: "first name",
            error: "",
        },
        lastName: {
            value: "",
            rules:
            "required | regex:^[a-zA-Z]+$",
            name: "last name",
            error: "",
        },
        email: {
            value: "",
            rules:
            "required | regex: ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+[.][a-zA-Z]{2,}$",
            name: "Email",
            error: "",
        },
        password: {
            value: "",
            rules:
            "required | regex: ^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).*$ | min:8",
            name: "Password",
            error: "",
        },
        confirmPassword: {
            value: "",
            name: "confirm password",
            error: "",
        },
        companyName:{
            value: "",
            rules:
            "required | min:3",
            name: "company name",
            error: ""
        },
        phoneNumber:{
            value:"",
            rules:
            "required | min:10 | regex:^[0-9]+$",
            name: "phone number",
            error:""
        },
        country:{
            value:"",
            rules:
            "required",
            name: "country",
            error:""
        },
        teamFocus:{
            value:"",
            name: "teamFocus",
            error:""
        },
        phoneCode:{
            value:"",
            rules:
            "required",
            name: "phoneCode",
            error:""
        },
        state:{
            value:"",
            rules:
            "required",
            name: "state",
            error:""
        },
        city:{
            value:"",
            rules:
            "required",
            name: "city",
            error:""
        },
    })

    const updateConfirmation = () => {
        if(formData.value.confirmPassword.value === ''){
            return;
        }else{
            if(formData.value.confirmPassword.value === ''){
                confirmationErr.value = 'The confirm password field is required'
            }else if(formData.value.password.value !== formData.value.confirmPassword.value){
                confirmationErr.value = 'The confirm password confirmation does not match'
            }else{
                confirmationErr.value = ''
            }
        }
    }

    const confirmationPassValidation = () => {
        if(formData.value.confirmPassword.value === ''){
            confirmationErr.value = 'The confirm password field is required'
        }else if(formData.value.password.value !== formData.value.confirmPassword.value){
            confirmationErr.value = 'The confirm password confirmation does not match'
        }else{
            confirmationErr.value = ''
        }
    }


    function checkErrors({field = {}, name = "", validations = '', type = "string", event = null}) {
        return new Promise((resolve, reject) => {
            try {
                let rules = validations!== '' ? validations.split("|").map((x) => x.trim()) : '';
                let valid = true;
                let typeMsg = type === "number" ? "digits" : "characters";

                if(rules.length) {
                    // REQUIRED
                    if (rules.filter((x) => x.includes("required")).length) {
                        if(event !== null){
                            if (event.target.value.trim() === "" || event.target.value.trim() === null || event.target.value === false) {
                                valid = false;
                                field.error = `The ${name.toLowerCase()} ${en.generalErrorMessage.fieldIsRequired}`;
                            }
                        } else {
                            if (field.value === "" || field.value === null || field.value === false) {
                                valid = false;
                                field.error = `The ${name.toLowerCase()} ${en.generalErrorMessage.fieldIsRequired}`;
                            }
                        }
                    }
                    // REGEX
                    if (rules.filter((x) => x.includes("regex")).length && valid) {
                        let ind = rules.findIndex((x) => x.includes("regex"));
                        if (ind !== -1) {
                            let regex = rules[ind].split(":").pop().trim() || "";
                            if (regex.length) {
                                regex = new RegExp(regex);
                                if(event !== null) {
                                    if (!regex.test(event.target.value.trim())) {
                                        valid = false;
                                        field.error =
                                            (name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase()) && field.value.toString().length < 8
                                            ? name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() ? en.authErrorMessage.passwordValid : name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() ? en.authErrorMessage.newPasswordValid : name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase() ? en.authErrorMessage.currentPasswordValid : ''
                                            : (name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase()) && field.value.toString().length >= 8
                                            ? name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() ? en.authErrorMessage.validPassRegex : name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() ? en.authErrorMessage.newPassword : name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase() ? en.authErrorMessage.currentPassword : ''
                                            : name == en.email
                                            ? en.authErrorMessage.emailError
                                            : name == en.firstName || name == en.lastName
                                            ? en.authErrorMessage.validCharacters
                                            : `The ${name.toLowerCase()} field must be a valid ${name.toLowerCase()}`;
                                    }
                                }else {
                                    if (!regex.test(field.value)) {
                                        valid = false;
                                        field.error =
                                            (name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase()) && field.value.toString().length < 8
                                            ? name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() ? en.authErrorMessage.passwordValid : name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() ? en.authErrorMessage.newPasswordValid : name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase() ? en.authErrorMessage.currentPasswordValid : ''
                                            : (name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() || name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase()) && field.value.toString().length >= 8
                                            ? name?.toLocaleLowerCase() == en?.password?.toLocaleLowerCase() ? en.authErrorMessage.validPassRegex : name?.toLocaleLowerCase() === en?.newPassword?.toLocaleLowerCase() ? en.authErrorMessage.newPassword : name?.toLocaleLowerCase() === en?.currentPassword?.toLocaleLowerCase() ? en.authErrorMessage.currentPassword : ''
                                            : name == en.email
                                            ? en.authErrorMessage.emailError
                                            : name == en.firstName || name == en.lastName
                                            ? en.authErrorMessage.validCharacters
                                            : `The ${name.toLowerCase()} field must be a valid ${name.toLowerCase()}`;
                                    }
                                }
                            } else {
                                console.warn("No regex found!");
                            }
                        }
                    }

                    // MIN
                    if (rules.filter((x) => x.includes("min")).length && valid) {
                        let ind = rules.findIndex((x) => x.includes("min"));
                        if (ind !== -1) {
                            let min = Number(rules[ind].split(":").pop());
                            if(event !== null){
                                if (event.target.value.trim().toString().length < min) {
                                    valid = false;
                                    field.error = 
                                    name === en.phoneNumber
                                    ? en.companyErrorMessage.phoneNumberValid
                                    :`The ${name.toLowerCase()} field must be at least ${min} ${typeMsg}`
                                }
                            }else {
                                if (field.value.toString().length < min) {
                                    valid = false;
                                    field.error = 
                                    name === en.phoneNumber
                                    ? en.companyErrorMessage.phoneNumberValid
                                    :`The ${name.toLowerCase()} field must be at least ${min} ${typeMsg}`
                                }
                            }
                        }
                    }
                    // MAX
                    if (rules.filter((x) => x.includes("max")).length && valid) {
                        let ind = rules.findIndex((x) => x.includes("max"));
                        if (ind !== -1) {
                            let max = Number(rules[ind].split(":").pop());
                            if(event !== null){
                                if (event.target.value.trim().toString().length > max) {
                                    valid = false;
                                    field.error = `${name} must be less than ${max} ${typeMsg}`;
                                }
                            } else {
                                if (field.value.toString().length > max) {
                                    valid = false;
                                    field.error = `${name} must be less than ${max} ${typeMsg}`;
                                }
                            }
                        }
                    }
                    // CONFIRMATION
                    if (rules.filter((x) => x.includes("confirmation")).length && valid) {
                        let ind = rules.findIndex((x) => x.includes("confirmation"));
                        if (ind !== -1) {
                            let confirm = rules[ind].split(":").pop().trim() || "";
                            if (confirm.length) {
                                if(event !== null){
                                    if (event.target.value.trim() !== confirm) {
                                        valid = false;
                                        field.error = `${en.authErrorMessage.confirmPasswordValid}`;
                                    }
                                } else {
                                    if (field.value !== confirm) {
                                        valid = false;
                                        field.error = `${en.authErrorMessage.confirmPasswordValid}`;
                                    }
                                }
                            } else {
                                console.warn("No confirmation field found!");
                            }
                        }
                    }   

                    // NO ERRORS
                    if (valid) {
                        field.error = "";
                    }
                }
                resolve(valid);
            } catch (error) {
                reject(error)
            }
        })
    }

    function checkAllFields(formData) {
        return new Promise((resolve, reject) => {
            try {
                let valid = true;
                Object.keys(formData).forEach((key) => {
                    checkErrors({'field':formData[key],'name':formData[key].name,'validations':formData[key].rules,'type':formData[key].type}).then((res) => {
                        if(res === false) {
                            valid = false;
                        }
                    })
                    .catch((error) => {
                        console.error("ERROR in check validation: ", error);
                    })
                });
                nextTick(() => {
                    resolve(valid);
                })
            } catch (error) {
                reject(error);
            }
        });
    }


    function addUserAndCompany() {
        if(formData.value.confirmPassword.value === ''){
            confirmationErr.value = 'The confirm password field is required'
        }else if(formData.value.password.value !== formData.value.confirmPassword.value){
            confirmationErr.value = 'The confirm password confirmation does not match'
        }
        checkAllFields(formData.value).then(async(valid)=>{
            if(valid && confirmationErr.value === ''){
                if (!isCompanyProcess.value) {
                    isCompanyProcess.value = true;
                }
                errorMessage.value = "";
                isSpinner.value = true;
                const evId = `ev_${Math.random().toString(16).slice(2)}`;
                const source = new EventSource(`${env.API_URI}/api/v1/checkinstallstep/events/${evId}`);
                let step = 1;
                source.onmessage = function(event) {
                    if (!isCompanyProcess.value) {
                        isCompanyProcess.value = true;
                    }
                    const data = JSON.parse(event.data)?.data;
                    step = data?.step;
                    if (data?.step === 1) {
                        stepCompanyProcessMessage.value = "Creating Owner"
                        stepDesc.value[0].status = 'done';
                        stepDesc.value[1].status = 'inprogress';
                    }
                    else if (data?.step === 2) {
                        stepCompanyProcessMessage.value = "Creating Company"
                        stepDesc.value[1].status = 'done';
                        stepDesc.value[2].status = 'inprogress';
                    } else if (data?.step === 3) {
                        stepCompanyProcessMessage.value = "Your company was created. We have set up the initial steps. Please wait a moment.";
                        stepDesc.value[2].status = 'done';
                        stepDesc.value[3].status = 'inprogress';
                    } else if (data?.step === 4) {
                        stepDesc.value[3].status = 'done';
                        stepDesc.value[4].status = 'inprogress';
                    } else if (data?.step === 5) {
                        stepDesc.value[4].status = 'done';
                    } else {
                        source.close(); // Close the connection when the progress reaches 100%
                        if (data?.error) {
                            stepCompanyProcessMessage.value = "Something went wrong. Please contact to support team";
                            stepDesc.value[step-1].status = 'error';
                            setTimeout(() => {
                                isCompanyProcess.value = false;
                            }, 1500)
                            isSpinner.value = true;
                            return;
                        }
                        stepCompanyProcessMessage.value = "Good To Go.";
                        stepDesc.value[4].status = 'done';
                        setTimeout(() => {
                            isCompanyProcess.value = false;
                            isSpinner.value = false;
                            emit("complete", {});
                        }, 1500);
                    }
                };
                source.onerror = function() {
                    setTimeout(() => {
                        isCompanyProcess.value = false;
                    }, 2000);
                    source.close(); // Close the connection in case of error
                    isSpinner.value = false;
                };

                let phoneCodes = phoneCode.value.find((x)=> x.value === formData.value.phoneCode.value);
                let countryCodeObj = {
                    "name": phoneCodes.name,
                    "dialCode": phoneCodes.phoneCode,
                    "isoCode": phoneCodes.isoCode
                }
                let obj = {
                    email: formData.value.email.value,
                    password: formData.value.password.value,
                    firstName: formData.value.firstName.value,
                    lastName: formData.value.lastName.value,
                    companyName: formData.value.companyName.value,
                    phoneNumber: formData.value.phoneNumber.value,
                    country: formData.value.country.value,
                    city: formData.value.city.value,
                    state: formData.value.state.value,
                    teamFocus: formData.value.teamFocus.value,
                    countryCodeObj: countryCodeObj,
                    eventId : evId,
                }
                axios.post(`${env.API_URI}/api/v1/installstep/createUserAndCompany`, obj).then((res)=>{
                    if(res.status === 200){
                        console.info("Company Created Successfully");
                    }else{
                        source.close();
                        isSpinner.value = false;
                        stepCompanyProcessMessage.value = "Something went wrong. Please contact to support team";
                        setTimeout(() => {
                            isCompanyProcess.value = false;
                        }, 1500)
                        errorMessage.value = "Something went wrong. Please check your details and try again or contact the support team.";
                    }
                }).catch((error)=>{
                    if (error.response.status == 420) {
                        source.close();
                        isSpinner.value = false;
                        stepCompanyProcessMessage.value = "Something went wrong. Please contact to support team";
                        setTimeout(() => {
                            isCompanyProcess.value = false;
                        }, 1500)
                        errorMessage.value = "Please clear your databse and try again or contact support team";
                    } else {
                        isSpinner.value = false;
                        source.close();
                        stepCompanyProcessMessage.value = "Something went wrong. Please contact to support team";
                        errorMessage.value = "Something went wrong. Please check your details and try again or contact the support team.";
                        setTimeout(() => {
                            isCompanyProcess.value = false;
                        }, 1500)
                    }
                })
            }
        })
    }

    function setState() {
        let currentCountry = coutryArray.value.find((x)=> x.key === formData.value.country.value)
        State.getStatesOfCountry(currentCountry.value).forEach((x)=>{
            if(City.getCitiesOfState(currentCountry.value,x.isoCode).length){
                stateArray.value.push({key: x.name, value: x.isoCode})
            }
        })
    }

      function setCity() {
        let currentCountry = coutryArray.value.find((x)=> x.key === formData.value.country.value)
        let cuttentState = stateArray.value.find((x)=> x.key === formData.value.state.value)
        cityArray.value = City.getCitiesOfState(currentCountry.value,cuttentState.value).map((x)=>{
            return {key: x.name, value: x.value}
        });
    }
    const coutryArray = computed(()=>{
        let countries = [];
        Country.getAllCountries().forEach((x)=> {
            if (State.getStatesOfCountry(x.isoCode).length) {
                countries.push({key: x.name, value: x.isoCode})
            }
        })
        return countries
    })
    onMounted(() =>{
        phoneCode.value = Country.getAllCountries().map((x)=> {
            return {name: x.name, isoCode: x.isoCode, phoneCode: x.phonecode, value: `+${x.phonecode}`, label: `+${x.phonecode} ${x.name}`}
        })
        formData.value.phoneCode.value = '+91'; 
    })
</script>
<style scoped>
.userAndCompanyWrapper .row{
    display: flex;
    margin: 0 -10px;
}
.userAndCompanyWrapper .row .col-md-6{
    width: 50%;
    padding: 0 10px;
}
input, button,select {
    margin-bottom: 10px;
    width: 100%;
    padding: 8px;
    box-sizing: border-box;
    border: 1px solid #ccc;
    border-radius: 4px;
}
input:focus {
    outline: none;
    border-color: #2f3990;
}
/* button {
    background-color: #4caf50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 25px;
} */
option {
    padding: 10px;
    font-size: 16px;
}
select:focus {
    outline: none;
    border-color: #2f3990;
}
.errorMessage{
    color: red;
    margin-bottom: 10px;
    margin-top: -10px;
}
.formLabel{
    margin-bottom: 5px;
    font-weight: 400;
}
.disabled{
    cursor: not-allowed;
    background: #515683;
}
</style>