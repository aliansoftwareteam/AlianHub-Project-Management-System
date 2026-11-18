import { reactive } from 'vue';
import { partsChoice } from './planPicks';

/* The parts of each waiting plan the person unticked, by proposal and change, and what goes with its approval. */
export const usePlanChoices = () => {
    const leftOut = reactive({});
    const keyOf = (id, i) => `${id}:${i}`;
    return {
        leftOutOf: (id, i) => leftOut[keyOf(id, i)] || [],
        setLeftOut: (id, i, parts) => { leftOut[keyOf(id, i)] = parts; },
        bodyFor: (id, changes) => partsChoice(changes, (i) => leftOut[keyOf(id, i)]) || {},
        forget: (id) => Object.keys(leftOut).filter((key) => key.startsWith(`${id}:`)).forEach((key) => { delete leftOut[key]; }),
    };
};
