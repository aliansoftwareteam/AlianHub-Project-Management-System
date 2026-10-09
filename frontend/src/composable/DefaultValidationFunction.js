//DIPSHA KALARIYA --> Global Validation Function For Validation in All Forms(17-06-2021)
export const ValidationFunction = {
    //Its Contains only number value Like 458 (DIPSHA)
    OnlyNumber: function (event) {
        const char = String.fromCharCode(event.keyCode)
        if (!/[0-9]/.test(char)) {
          event.preventDefault()
        }
    },
    //Its Contains Float number value Like 45.8 (DIPSHA)
    OnlyFloatNumber(event) {
        let val = event.target.value.replace(/[^0-9/.]/g,'');      
        if (val.charAt(0) == '.'){
            event.target.value = "";
            event.preventDefault();
        }
        if ((event.which != 46 || val.indexOf('.') != -1) && (event.which < 48 || event.which > 57)) {
            event.preventDefault();
        }
    },
    //Its Contains Mobile Number Input value Like 157988974946 (DIPSHA)
    OnlyPhoneNumber(event){
        const char = String.fromCharCode(event.keyCode)
        if (!/[0-9]/.test(char)) {
            event.preventDefault()
        }
    },
    OnlyPANnumber(value, cb){
      const obj = {
        rgx: /^([a-zA-Z]){5}([0-9]){4}([a-zA-Z]){1}?$/,
        minLength: 10
      }      
      cb(obj);
    },
    OnlyGSTNumber(event){
      const char = String.fromCharCode(event.keyCode)
      if (!/[0-9a-zA-Z]/.test(char)) {
        event.preventDefault()
      }
    },
    //CHECK VALID GST NUMBER FORMAT
    isValidGSTNumber(value, cb){
      const obj = {
        rgx: /\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}/,
        minLength: 15
      }      
      cb(obj);
    },
    //CHECK VALID TAN NUMBER FORMAT
    isValidTANNumber(value, cb){
      const obj = {
        rgx: /^([a-zA-Z]){4}([0-9]){5}([a-zA-Z]){1}?$/,
        minLength: 10
      }      
      cb(obj);
    },
    //CHECK VALID CIN NUMBER FORMAT
    isValidCINNumber(value, cb){
      const obj = {
        rgx: /^([a-zA-Z]){1}([0-9]){5}([a-zA-Z]){2}([0-9]){4}([a-zA-Z]){3}([0-9]){6}/,
        minLength: 21
      }      
      cb(obj);
    },
    //
    isValueExistInArray(arrayObject, value, cb){
      var arr = arrayObject.map((v) => v.replaceAll(" ", "_").toLowerCase());
      var result = arr.includes(
        value.replaceAll(" ", "_").toLowerCase()
      );
      cb(result);
    },
    //Its Contains only Character value Like dipsha (DIPSHA)
    OnlyCharacter: function (event) {
      const char = String.fromCharCode(event.keyCode)
      if (!/[a-zA-Z ]/.test(char)) {
        event.preventDefault()
      }
    },
    //REMOVE SPECIAL CHARACTER FROM INPUT
    onlyAlphaNumericAllowed: function (event) {
      var keyCode = event.keyCode || event.which;
      var regex = /^[A-Za-z0-9]+$/;
      var isValid = regex.test(String.fromCharCode(keyCode));
      if (!isValid) {
          event.preventDefault();
      }
    },
    onlyFloatWithSpecialChar(b){
      const char = String.fromCharCode(b.keyCode)
        if (!/[0-9.+-]/.test(char)) {
          b.preventDefault()
        }
    },
    // Its Contains only number
    onlyNumberMilestone(event) {
      let keyCode = event.keyCode ? event.keyCode : event.which;
      if ((keyCode < 48 || keyCode > 57) && keyCode !== 46) {
            event.preventDefault();
          }
    },
    getCommaSeperatedNumber (n) {
      let numVal = Number(n)
      return numVal.toLocaleString('en-US', {maximumFractionDigits: 2, minimumFractionDigits: 2, useGrouping: true});
    },
    onlyNumberWithoutDecimal(event){
      let keyCode = event.keyCode ? event.keyCode : event.which;
        if ((keyCode < 48 || keyCode > 57) || keyCode === 46) {
            event.preventDefault();
        }
    }
}