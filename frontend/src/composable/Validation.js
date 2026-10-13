import { nextTick } from "vue";
import en from "@/locales/en"
import { useI18n } from 'vue-i18n';
const RULE_SEPARATOR = /\|(?=\s*(?:required|min|max|regex|confirmation)\s*(?::|\||$))/;
const nameKey = (name) => name.toLowerCase().replaceAll(" ", "_");
const PASSWORD_MESSAGES = new Map([
    ["password", ["authErrorMessage.passwordValid", "authErrorMessage.validPassRegex"]],
    ["new password", ["authErrorMessage.newPasswordValid", "authErrorMessage.newPassword"]],
    ["current password", ["authErrorMessage.currentPasswordValid", "authErrorMessage.currentPassword"]],
]);

export function useValidation() {
    const { t } = useI18n();

    function checkErrors({ field = {}, name = "", validations = '', type = "string", event = null, checkLanguage = true }) {
        return new Promise((resolve, reject) => {
            try {
                let rules = validations !== '' ? validations.split(RULE_SEPARATOR).map((x) => x.trim()) : '';
                const hasRule = (ruleName) => rules.some((x) => x.split(":")[0].trim() === ruleName);
                const ruleArg = (ruleName) => {
                    const rule = rules.find((x) => x.split(":")[0].trim() === ruleName);
                    return rule.includes(":") ? rule.slice(rule.indexOf(":") + 1) : "";
                };
                let valid = true;
                const regexMessage = (typed) => {
                    const lowered = name.toLowerCase();
                    const passwordMessages = PASSWORD_MESSAGES.get(lowered);
                    if (passwordMessages) {
                        return typed.toString().length < 8 ? t(passwordMessages[0]) : t('errorPage.The') + ' ' + t(passwordMessages[1]);
                    }
                    if (lowered === "email") return t('authErrorMessage.emailError');
                    if (lowered === "first name") return t('authErrorMessage.validCharactersfirst');
                    if (lowered === "last name") return t('authErrorMessage.validCharacterslast');
                    return t('errorPage.The') + ' ' + t(`errorPage.${nameKey(name)}`) + ' ' + t('errorPage.field_must_be_a_valid') + ' ' + t(`errorPage.${nameKey(name)}`);
                };
                let typeMsg = type === "number" ? "digits" : "characters";

                if (rules.length) {
                    // REQUIRED
                    if (rules.length && hasRule("required")) {
                        if (event !== null) {
                            if (event.target.value.trim() === "" || event.target.value.trim() === null || event.target.value === false) {
                                valid = false;
                                field.error = !checkLanguage ? `The ${name.toLowerCase()} ${en.generalErrorMessage.fieldIsRequired}` : t('errorPage.The') + " " + t(`errorPage.${name.toLowerCase().replaceAll(" ", "_")?.replaceAll("'", "")}`).toLowerCase() + " " + t('generalErrorMessage.fieldIsRequired');
                            }
                        } else {
                            if (field.value === "" || field.value === null || field.value === false) {
                                valid = false;
                                field.error = !checkLanguage ? `The ${name.toLowerCase()} ${en.generalErrorMessage.fieldIsRequired}` : t('errorPage.The') + " " + t(`errorPage.${name.toLowerCase().replaceAll(" ", "_")?.replaceAll("'", "")}`).toLowerCase() + " " + t('generalErrorMessage.fieldIsRequired');
                            }
                        }
                    }
                    // REGEX
                    if (hasRule("regex") && valid) {
                        const pattern = ruleArg("regex").trim();
                        if (pattern.length) {
                            const regex = new RegExp(pattern);
                            const typed = event !== null ? event.target.value.trim() : field.value;
                            if (!regex.test(typed)) {
                                valid = false;
                                field.error = !checkLanguage ? `The ${name.toLowerCase()} field must be a valid ${name.toLowerCase()}` : regexMessage(typed);
                            }
                        } else {
                            console.warn("No regex found!");
                        }
                    }

                    // MIN
                    if (hasRule("min") && valid) {
                        const min = Number(ruleArg("min"));
                        const typed = event !== null ? event.target.value.trim() : field.value;
                        if (typed.toString().length < min) {
                            valid = false;
                            field.error =
                                !checkLanguage ?
                                    `The ${name.toLowerCase()} field must be at least ${min} ${typeMsg}` :
                                    name.toLowerCase() === "phone number"
                                        ? t('companyErrorMessage.phoneNumberValid')
                                        : t('errorPage.The') + ' ' + t(`errorPage.${nameKey(name)}`) + ' ' + t('errorPage.field_must_be_at_least') + ' ' + `${min}` + ' ' + t(`errorPage.${typeMsg}`)
                        }
                    }
                    // MAX
                    if (hasRule("max") && valid) {
                        const max = Number(ruleArg("max"));
                        const typed = event !== null ? event.target.value.trim() : field.value;
                        if (typed.toString().length > max) {
                            valid = false;
                            field.error = !checkLanguage ? `${name} must be less than ${max} ${typeMsg}` : t(`errorPage.${nameKey(name)}`) + ' ' + t('errorPage.must_be_less_than') + ' ' + `${max}` + ' ' + t(`errorPage.${typeMsg}`);
                        }
                    }
                    // CONFIRMATION
                    if (hasRule("confirmation") && valid) {
                        const confirm = ruleArg("confirmation").trim();
                        if (confirm.length) {
                            const typed = event !== null ? event.target.value.trim() : field.value;
                            if (typed !== confirm) {
                                valid = false;
                                field.error = t('authErrorMessage.confirmPasswordValid');
                            }
                        } else {
                            console.warn("No confirmation field found!");
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

    function checkAllFields(formData, checkLanguage = true) {
        return new Promise((resolve, reject) => {
            try {
                let valid = true;
                if (!Array.isArray(formData)) {
                    Object.keys(formData).forEach((key) => {
                        checkErrors({ 'field': formData[key], 'name': formData[key]?.name, 'validations': formData[key]?.rules, 'type': formData[key]?.type, 'checkLanguage': checkLanguage }).then((res) => {
                            if (res === false) {
                                valid = false;
                            }
                        })
                            .catch((error) => {
                                console.error("ERROR in check validation: ", error);
                            })
                    });
                } else {
                    formData.forEach((key) => {
                        checkErrors({ 'field': key, 'name': key.title || key.label, 'validations': key.rules, 'type': key.type, 'checkLanguage': checkLanguage }).then((res) => {
                            if (res === false) {
                                valid = false;
                            }
                        })
                            .catch((error) => {
                                console.error("ERROR in check validation: ", error);
                            })
                    })
                }
                nextTick(() => {
                    resolve(valid);
                })
            } catch (error) {
                reject(error);
            }
        });
    }

    return {
        checkAllFields,
        checkErrors
    }
}