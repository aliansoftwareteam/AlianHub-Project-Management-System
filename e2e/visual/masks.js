/* MASKED is painted over in the screenshot: the box stays, its pixels do not count.
 * HIDDEN is taken out of the layout: for things that are there on one run and not on the next.
 * Add an entry only for what the fixed clock, the frozen dates and the seeded data cannot hold still. */
const MASKED = [
    {
        name: 'presence-dot',
        selector: '.user-status',
        why: 'Green or red follows the presence event on the socket, which arrives before the screenshot on one run and after it on the next.',
    },
];

const HIDDEN = [
    {
        name: 'live-strip',
        selector: '.live',
        why: 'The bar that names running agents and timers appears only while one runs; the seed starts none, and a stray run must not move every screen up.',
    },
    {
        name: 'agents-running',
        selector: '.ah-rail__agents',
        why: 'The count of running agents in the rail is drawn from the same live feed as the strip and comes and goes with it.',
    },
    {
        name: 'toast',
        selector: '.v-toast',
        why: 'A toast is on screen for a few seconds after whatever raised it, so whether a screenshot catches it depends on timing alone.',
    },
];

const STILL = `*, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
}
*::-webkit-scrollbar { display: none !important; }
* { scrollbar-width: none !important; }
*:focus, *:focus-visible { outline: none !important; }`;

const captureCss = () => [STILL, ...HIDDEN.map((entry) => `${entry.selector} { display: none !important; }`)].join('\n');

module.exports = { MASKED, HIDDEN, captureCss };
