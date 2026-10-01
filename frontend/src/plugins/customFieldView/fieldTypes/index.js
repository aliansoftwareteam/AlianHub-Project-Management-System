/* What the web app adds to each type module in Modules/CustomField/fieldTypes: an icon, the component that shows and edits a value
   ({ def, value, editable, compact, label } in, `change` out with what the person entered), and for a type with settings of its
   own the builder component for them (v-model on the draft) and the message shown when they do not fit. `needsTask` also hands
   the value component the task, and `noUndo` marks a change that cannot be taken back because it moved a stored file. */
import { MODULE_FIELD_TYPES, typeModuleOf } from '@fieldTypes';
import { fieldTaskTypes } from '@fieldTaskTypes';
import PeopleFieldValue from './PeopleFieldValue.vue';
import PeopleFieldSettings from './PeopleFieldSettings.vue';
import UrlFieldValue from './UrlFieldValue.vue';
import RatingFieldValue from './RatingFieldValue.vue';
import RatingFieldSettings from './RatingFieldSettings.vue';
import ProgressFieldValue from './ProgressFieldValue.vue';
import FilesFieldValue from './FilesFieldValue.vue';
import FilesFieldSettings from './FilesFieldSettings.vue';

export { activeMemberIds, peopleOptions } from './people';

const UI = Object.freeze({
    people: { icon: 'users', value: PeopleFieldValue, settings: PeopleFieldSettings },
    url: { icon: 'link', value: UrlFieldValue, settings: null },
    rating: { icon: 'star', value: RatingFieldValue, settings: RatingFieldSettings, settingsError: 'FieldTypes.rating_max_error' },
    progress: { icon: 'reports', value: ProgressFieldValue, settings: null },
    files: { icon: 'paperclip', value: FilesFieldValue, settings: FilesFieldSettings, settingsError: 'FieldTypes.files_settings_error', needsTask: true, noUndo: true }
});

export const fieldTypeUi = (fieldType) => (Object.keys(UI).includes(fieldType) ? UI[fieldType] : null);

export const taskPropFor = (fieldType, task) => (fieldTypeUi(fieldType)?.needsTask ? { task } : {});

/* The global type catalogue was seeded before these types existed, so they are added to whatever it lists. */
export function fieldTypeCatalogue(catalogue, t) {
    const listed = catalogue || [];
    const missing = MODULE_FIELD_TYPES.filter((type) => !listed.some((entry) => entry?.cfType === type));
    return [...listed, ...missing.map((type) => ({
        cfType: type, cfTitle: t(`Fields.type_${type}`), cfDescrption: t(`Fields.hint_${type}`), cfIcon: '', cfIconGrey: '', icon: UI[type].icon
    }))];
}

/* A stored setting that no longer fits falls back to the type's default, so the field can still be opened and saved. */
export function moduleFieldDraft(field) {
    const type = typeModuleOf(field.fieldType);
    const settings = type.settings(field).settings || type.settings({}).settings;
    return {
        ...(field._id ? { _id: field._id } : {}),
        fieldTitle: field.fieldTitle || '',
        fieldDescription: field.fieldDescription || '',
        fieldType: field.fieldType,
        fieldTaskTypes: fieldTaskTypes(field),
        ...settings
    };
}

/* The i18n key of what is wrong with the draft's own settings, or '' when they fit. */
export const moduleFieldSettingsError = (draft) => (typeModuleOf(draft.fieldType).settings(draft).error ? UI[draft.fieldType].settingsError : '');

export const moduleFieldSettings = (draft) => typeModuleOf(draft.fieldType).settings(draft).settings;
