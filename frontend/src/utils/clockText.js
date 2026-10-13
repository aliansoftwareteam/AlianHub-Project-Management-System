import { reactive } from "vue";
import moment from "moment";

const DEFAULT_DATE_FORMAT = "DD/MM/YYYY";

/* My Settings > Time format and the workspace's date format. App.vue keeps both in step with the
   account, so a screen needs neither the store nor an inject to write a time. */
export const clockPrefs = reactive({ twelveHour: true, dateFormat: DEFAULT_DATE_FORMAT });

export function followClockPrefs({ timeFormat, dateFormat } = {}) {
    clockPrefs.twelveHour = String(timeFormat || "12") !== "24";
    clockPrefs.dateFormat = dateFormat || DEFAULT_DATE_FORMAT;
}

const read = (value) => {
    if (!value) return null;
    if (moment.isMoment(value)) return value.isValid() ? value : null;
    const at = moment(value instanceof Date || typeof value === "number" ? value : new Date(value.seconds ? value.seconds * 1000 : value));
    return at.isValid() ? at : null;
};

const clock = (at) => at.format(clockPrefs.twelveHour ? "h:mm A" : "HH:mm");
const day = (at) => at.format(at.isSame(moment(), "year") ? "D MMM" : "D MMM YYYY");
const written = (write) => (value) => {
    const at = read(value);
    return at ? write(at) : "";
};

export const clockText = written(clock);
export const dayText = written(day);
export const dayClockText = written((at) => `${day(at)}, ${clock(at)}`);
export const weekdayClockText = written((at) => `${at.format("ddd")} ${day(at)}, ${clock(at)}`);
export const recentText = written((at) => (at.isSame(moment(), "day") ? clock(at) : day(at)));
export const recentClockText = written((at) => (at.isSame(moment(), "day") ? clock(at) : `${day(at)}, ${clock(at)}`));
export const fullText = written((at) => `${at.format(clockPrefs.dateFormat)}, ${clock(at)}`);

/* For a formatter that follows a time zone or a language of its own. */
export const hourCycleOption = () => ({ hourCycle: clockPrefs.twelveHour ? "h12" : "h23" });
