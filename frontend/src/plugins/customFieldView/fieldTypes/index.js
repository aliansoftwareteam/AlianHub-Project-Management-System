/* What the web app adds to each type module in Modules/CustomField/fieldTypes: an icon, the component that shows and edits a value
   ({ def, value, editable, compact, label } in, `change` out with what the person entered), and for a type with settings of its
   own the builder component for them (v-model on the draft) and the message shown when they do not fit. */
import PeopleFieldValue from './PeopleFieldValue.vue';
import PeopleFieldSettings from './PeopleFieldSettings.vue';
import UrlFieldValue from './UrlFieldValue.vue';

export { activeMemberIds, peopleOptions } from './people';

const UI = Object.freeze({
    people: { icon: 'users', value: PeopleFieldValue, settings: PeopleFieldSettings },
    url: { icon: 'link', value: UrlFieldValue, settings: null }
});

export const fieldTypeUi = (fieldType) => (Object.keys(UI).includes(fieldType) ? UI[fieldType] : null);
