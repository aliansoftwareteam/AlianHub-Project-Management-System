import { ref, onMounted, onUnmounted } from 'vue';
import { calendar } from '@/components/organisms/HourlyMilestone/helper.js';

export function useProjectCalendar() {
    const { calendarRange } = calendar();

    const calendartoggle = ref(false);
    const rangeObject = ref({});
    const calendarDate = ref('');
    const calenderSelectDate = ref(0);

    const prevMonth = () => {
        const base = calendarDate.value ? new Date(calenderSelectDate.value) : new Date();
        const nextDate = base.setMonth(base.getMonth() - 1, 1);
        calenderSelectDate.value = nextDate;
        calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    const nextMonth = () => {
        const base = calendarDate.value ? new Date(calenderSelectDate.value) : new Date();
        const nextDate = base.setMonth(base.getMonth() + 1, 1);
        calenderSelectDate.value = nextDate;
        calendarDate.value = new Date(nextDate).toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    const defaultMonth = () => {
        if (calendarDate.value) {
            calendarDate.value = '';
            calenderSelectDate.value = 0;
        }
    };

    const handleStartEndDate = (value) => {
        calendartoggle.value = false;
        const startEndObj = value;
        const getYear = new Date(startEndObj.start).getFullYear();
        const getMonth = new Date(startEndObj.start);
        const month = getMonth.toLocaleString('default', { month: 'short' });
        const tmpValue = JSON.parse(JSON.stringify(value));
        rangeObject.value.monthValueRange = `${getYear}`;
        rangeObject.value.selectedmonth = `${month}`;
        rangeObject.value.rangeValueMonthly = rangeObject.value.monthlyOrweeklyRangesValue[`${getYear}`];
        calenderSelectDate.value = new Date(tmpValue.start).getTime();
        calendarDate.value = new Date(tmpValue.start).toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    const rangeObjectFRun = (value) => {
        const startEndObj = value;
        const getYear = new Date(startEndObj).getFullYear();
        const getMonth = new Date(startEndObj);
        const month = getMonth.toLocaleString('default', { month: 'short' });
        rangeObject.value.monthValueRange = `${getYear}`;
        rangeObject.value.selectedmonth = `${month}`;
        rangeObject.value.rangeValueMonthly = rangeObject.value.monthlyOrweeklyRangesValue[`${getYear}`];
    };

    const handleClickOutside = (event) => {
        if (calendartoggle.value && !event.target.closest('.monthly-calendar')) {
            calendartoggle.value = false;
        }
    };

    function calendarDateChange(status, key) {
        if (key === 'calendar' && status) {
            defaultMonth();
        }
    }

    onMounted(() => {
        calendarRange(new Date('01-jan-1970'), [], 'Monthly', true, new Date('31-dec-2100'))
            .then((value) => {
                rangeObject.value = value;
            });
        document.body.addEventListener('click', handleClickOutside);
    });

    onUnmounted(() => {
        document.body.removeEventListener('click', handleClickOutside);
    });

    return {
        calendartoggle,
        rangeObject,
        calendarDate,
        calenderSelectDate,
        prevMonth,
        nextMonth,
        defaultMonth,
        handleStartEndDate,
        rangeObjectFRun,
        calendarDateChange,
    };
}
