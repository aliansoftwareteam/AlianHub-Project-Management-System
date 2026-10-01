<template>
    <div :class="props.isProjectDetail ? 'formkit__content-wrapper-project-detail' : 'formkit__content-wrapper'">
        <div class="formkit-wrapper">
            <div class="formkit-label__wrapper">
                <label class="formkit-label">
                    <img class="custom__field-image" :src="getImageData(props.detail.fieldImageGrey)">
                    <ToolTip :label="props?.detail?.fieldTitle" :text="props?.detail?.fieldDescription" :showReadMore="true" width="150px" />
                </label>
                <span>
                    <img @click="handleEdit" :src="editIconImage" class="formkit-label__image pr-22px cursor-pointer" />
                </span>
            </div>
            <div class="formkit-inner">
                <span class="formkit__content-currency" v-if="textModel">{{ props?.detail?.fieldMoneySymbol }}</span>
                <input class="formkit-input" @paste="handlePaste" v-model="textModel" @input="handleInput" :placeholder="props.detail?.fieldPlaceholder" ref="textInput" type="text" @blur="handleBlur" @keyup="handleKeyUp" @keypress="handleKeyPress" autocomplete="off"/>
            </div>
        </div>
        <ul class="formkit-messages" v-if="error">
            <li class="formkit-message">{{error}}</li>
        </ul>
    </div>
</template>

<script setup>
    import { nextTick, ref, watch } from "vue";
    import { useI18n } from "vue-i18n";
    import ToolTip from "@/components/molecules/ToolTip/ToolTip.vue";
    import useCustomFieldImage from '@/composable/customFieldIcon.js';
    const { getImageData } = useCustomFieldImage();
    const { t } = useI18n();
    const props = defineProps({
        detail:{
            type:Object,
            default:() => {}
        },
        isProjectDetail:{
            type: String,
            default: ''
        }
    });
    const textModel = ref(props.detail?.fieldValue)
    const keyPressValue = ref(props.detail?.fieldValue)
    const textInput = ref(null);
    const error = ref('');
    const previousLength = ref(null);
    const editIconImage = require("@/assets/images/editing.png");
    watch(() => props.detail?.fieldValue,(val) => {
        textModel.value = val;
        keyPressValue.value = val;
    })
    watch(()=> textModel.value ,(val,old)=>{
        keyPressValue.value = val;
        previousLength.value = old?.length;
    });
    const emit = defineEmits(['blurUpdate','inputUpdate','handleEdit']);
    const handleKeyPress = (event) => {
        let char = String.fromCharCode(event.keyCode);
        const regexPattern = /^[-]?(?:\d+\.\d*|\.\d+|\d+|\d*\.\d*)?$/;
        if(keyPressValue.value){
            if (textInput.value) {
                const cursorPosition = textInput.value.selectionStart;
                if(cursorPosition === 0){
                    if(keyPressValue.value === '-'){
                        return event.preventDefault();
                    }else{
                        if(keyPressValue.value[0] === '-'){
                            let testVal = keyPressValue.value.split('-');
                            keyPressValue.value = keyPressValue.value[0] === '-' ? `-${testVal.join('')}` : testVal.join('');
                            return event.preventDefault();
                        }
                    }
                }
            }
        }
        keyPressValue.value = keyPressValue.value ? keyPressValue.value.replace(/,/g, '') : keyPressValue.value
        keyPressValue.value = keyPressValue.value && char ? keyPressValue.value.concat(char) : char;
        if (!regexPattern.test(keyPressValue.value)) {
            if (textInput.value) {
                const cursorPosition = textInput.value.selectionStart;
                if(cursorPosition === 0 && char === '-'){
                    if(textModel.value.includes('-')){
                        let val = keyPressValue.value.split('.')
                        let testVal = keyPressValue.value.split('-')
                        if(val.length >= 2){
                            keyPressValue.value = val[0] + '.' + val.slice(1).join('');
                        }
                        if(testVal.length >= 2){
                            keyPressValue.value = keyPressValue.value[0] === '-' ? `-${testVal.join('')}` : testVal.join('');
                        }
                        event.preventDefault();
                    }else{
                        const match = keyPressValue.value.match(/-?\d*\.?\d*/);
                        keyPressValue.value = match[0];
                        return;
                    }
                }else{
                    let val = keyPressValue.value.split('.')
                    let testVal = keyPressValue.value.split('-')
                    if(val.length >= 2){
                        keyPressValue.value = val[0] + '.' + val.slice(1).join('');
                    }
                    if(testVal.length >= 2){
                        keyPressValue.value = keyPressValue.value[0] === '-' ? `-${testVal.join('')}` : testVal.join('');
                    }
                    event.preventDefault();
                }
            }else{
                let val = keyPressValue.value.split('.')
                let testVal = keyPressValue.value.split('-')
                if(val.length >= 2){
                    keyPressValue.value = val[0] + '.' + val.slice(1).join('');
                }
                if(testVal.length >= 2){
                    keyPressValue.value = keyPressValue.value[0] === '-' ? `-${testVal.join('')}` : testVal.join('');
                }
                event.preventDefault();
            }
            const match = keyPressValue.value.match(/-?\d*\.?\d*/);
            keyPressValue.value = match[0];
        }
    }
    const handleBlur = () => {
        if(error.value === '' && textModel.value !== '.' && textModel.value !== '-'){
            if(textModel.value){
                if(textModel.value[0] === '.'){
                    const checkDecimal = textModel.value.split('.');
                    textModel.value = `0.${checkDecimal[1]}`
                }else if (textModel.value[0] === '-' && textModel.value[1] === '.'){
                    const checkDecimal = textModel.value.split('.');
                    textModel.value = `-0.${checkDecimal[1]}`
                }
            }
            emit('blurUpdate',textModel.value,props.detail);
        }
    }
    const handleKeyUp = () => {
        const check = String(textModel.value ?? '').replace(/,/g, '');
        if(props?.detail?.fieldMinimum || props?.detail?.fieldMaximum){
            if(Number(props?.detail?.fieldMinimum) > Number(check)){
                error.value = t('CustomField.min_value', { field: props?.detail?.fieldTitle, min: props?.detail?.fieldMinimum });
            }else if(Number(props?.detail?.fieldMaximum) < Number(check)) {
                error.value = t('CustomField.max_value', { field: props?.detail?.fieldTitle, max: props?.detail?.fieldMaximum });
            }else{
                error.value = '';
            }
        }else{
            error.value = '';
        }
    }
    const handlePaste = (event) => {
        // Get the pasted text from the event
        const pastedText = (event.clipboardData || window.clipboardData).getData('text');
        // Your condition using regex
        const regexCondition = /^[-]?(?:\d+\.\d*|\.\d+|\d+|\d*\.\d*)?$/;
        // Check if the pasted text matches the condition
        if (!regexCondition.test(pastedText)) {
            // Allow paste
            event.preventDefault();
        } else {
            textModel.value = textModel.value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
    };
    const handleInput = () => {
        let cursorStart = textInput.value.selectionStart;
        let cursorEnd = textInput.value.selectionEnd;
        
        textModel.value = textModel.value ? textModel.value.replace(/,/g, '') : textModel.value
        // Remove non-digit characters and leading zeros
        let sanitizedValue = textModel.value;

        // Split the value into integer and decimal parts
        let [integerPart, decimalPart] = sanitizedValue.split('.');
        // Add commas to the integer part
        integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        // Combine the integer and decimal parts
        let formattedValue = decimalPart || decimalPart === ''  ? `${integerPart}.${decimalPart}` : integerPart;
        // Update the input value
        textModel.value = formattedValue;
        nextTick(() => {
            textInput.value.selectionStart = cursorStart;
            textInput.value.selectionEnd = cursorEnd;
            if(cursorEnd === 1 && cursorStart === 1 && textModel.value[0] === '-'){
                return;
            }
            if(textModel.value.includes('.')){
                const isCursorAfterA = cursorStart > textModel.value.indexOf('.');
                if(isCursorAfterA){
                    return
                }
            }
            if((textModel.value.length - cursorStart === 0 && previousLength.value - cursorStart === 1) || (textModel.value.length - cursorEnd === 0 && previousLength.value - cursorEnd === 1)){
                cursorStart = textModel.value.length;
                cursorEnd = textModel.value.length;
                textInput.value.selectionStart = cursorStart;
                textInput.value.selectionEnd = cursorEnd;
            }else{
                if((textModel.value.length - cursorStart === 2 && previousLength.value - cursorStart === 1) || (textModel.value.length - cursorEnd === 2 && previousLength.value - cursorEnd === 1)) {
                    cursorStart = textModel.value.length - 1;
                    cursorEnd = textModel.value.length - 1;
                    textInput.value.selectionStart = cursorStart;
                    textInput.value.selectionEnd = cursorEnd;
                    return;
                }
                const isCursorAtEnd = cursorStart === textModel.value.length && cursorEnd === textModel.value.length;
                if(!isCursorAtEnd){
                    if(textModel.value.length - previousLength.value === 1){
                        textInput.value.selectionStart = cursorStart + 1;
                        textInput.value.selectionEnd = cursorEnd + 1;
                    }else{
                        textInput.value.selectionStart = cursorStart;
                        textInput.value.selectionEnd = cursorEnd;
                    }
                }
            }
        });
    }
    const handleEdit = () => {
        emit('handleEdit',props?.detail)
    }
</script>
<style scoped>
    .formkit__content-currency{
        font-family: var(--font-ui);
        font-size: 13px;
        font-style: normal;
        font-weight: 400;
        line-height: 19.24px !important;
        padding: 0px;
        color: #505050;
        padding-right: 2px;
    }
</style>
