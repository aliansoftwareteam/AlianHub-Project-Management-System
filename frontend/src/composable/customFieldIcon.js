import { inject } from "vue";
import CustomFieldText from '@/assets/images/svg/CustomFieldsIcons/CustomFieldText.svg';
import CustomFieldTextGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldTextGrey.svg';
import CustomFieldDate from '@/assets/images/svg/CustomFieldsIcons/CustomFieldDate.svg';
import CustomFieldDateGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldDateGrey.svg';
import CustomFieldNumber from '@/assets/images/svg/CustomFieldsIcons/CustomFieldNumber.svg';
import CustomFieldNumberGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldNumberGrey.svg';
import customFieldTextearea from '@/assets/images/svg/CustomFieldsIcons/customFieldTextearea.svg';
import CustomFieldTextareaGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldTextareaGrey.svg';
import CustomFieldMoney from '@/assets/images/svg/CustomFieldsIcons/CustomFieldMoney.svg';
import CustomFieldMoneyGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldMoneyGrey.svg';
import customFieldEmail from '@/assets/images/svg/CustomFieldsIcons/customFieldEmail.svg';
import CustomFieldEmailGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldEmailGrey.svg';
import customFieldDropdown from '@/assets/images/svg/CustomFieldsIcons/customFieldDropdown.svg';
import CustomFieldDropdownGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldDropdownGrey.svg';
import CustomFieldPhone from '@/assets/images/svg/CustomFieldsIcons/CustomFieldPhone.svg';
import CustomFieldPhoneGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldPhoneGrey.svg';
import customFieldCheckbox from '@/assets/images/svg/CustomFieldsIcons/customFieldCheckbox.svg';
import CustomFieldCheckboxGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldCheckboxGrey.svg';
import PieChart from '@/assets/images/svg/card_svg/piechart.svg';
import PieChartWorkload from '@/assets/images/svg/card_svg/pieChartWorkload.svg';
import BatteryChartWorkload from '@/assets/images/svg/card_svg/batteryChartWorkload.svg';
import BatteryChart from '@/assets/images/svg/card_svg/batteryChart.svg';
import BarChartWorkload from '@/assets/images/svg/card_svg/barChartWorkload.svg';
import BarChart from '@/assets/images/svg/card_svg/barChart.svg';
import Calculation from '@/assets/images/svg/calculation.svg';
import CalendarCard from '@/assets/images/svg/CalendarCard.svg';
import TaskList from '@/assets/images/svg/TaskList.svg';
import CustomFieldFormula from '@/assets/images/svg/CustomFieldsIcons/CustomFieldFormula.svg';
import CustomFieldFormulaGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldFormulaGrey.svg';
import CustomFieldRollup from '@/assets/images/svg/CustomFieldsIcons/CustomFieldRollup.svg';
import CustomFieldRollupGrey from '@/assets/images/svg/CustomFieldsIcons/CustomFieldRollupGrey.svg';

const customeFieldIcons = {
    CustomFieldText,
    CustomFieldTextGrey,
    CustomFieldDate,
    CustomFieldDateGrey,
    CustomFieldNumber,
    CustomFieldNumberGrey,
    customFieldTextearea,
    CustomFieldTextareaGrey,
    CustomFieldMoney,
    CustomFieldMoneyGrey,
    customFieldEmail,
    CustomFieldEmailGrey,
    customFieldDropdown,
    CustomFieldDropdownGrey,
    CustomFieldPhone,
    CustomFieldPhoneGrey,
    customFieldCheckbox,
    CustomFieldCheckboxGrey,
    PieChart,
    BarChart,
    BarChartWorkload,
    BatteryChart,
    BatteryChartWorkload,
    PieChartWorkload,
    Calculation,
    CalendarCard,
    TaskList,
    CustomFieldFormula,
    CustomFieldFormulaGrey,
    CustomFieldRollup,
    CustomFieldRollupGrey
};

export default function useCustomFieldImage() {
    const defaultImageUser = inject("$defaultUserAvatar");
    const getImageData = (imageName) => {
        if(imageName && imageName.includes('http')) {
            return imageName;
        }
        return customeFieldIcons[imageName] ?? defaultImageUser;
    };

    return { getImageData };
}