import { describe, expect, it } from 'vitest';
import { placePanel } from '@/components/molecules/DropDown/panelPlacement';

const viewport = { width: 1440, height: 900 };
const panel = { width: 482, height: 400 };

describe('placePanel', () => {
    it('opens beside the button when there is room', () => {
        const trigger = { left: 300, right: 400, top: 100, bottom: 130 };
        expect(placePanel({ trigger, panel, viewport })).toEqual({ left: 300, top: 130 });
    });

    it('opens leftwards, aligned to the button right edge, when the right side is out of room', () => {
        const trigger = { left: 1121, right: 1221, top: 100, bottom: 130 };
        const { left } = placePanel({ trigger, panel, viewport });
        expect(left).toBe(1221 - 482);
        expect(left + panel.width).toBeLessThanOrEqual(viewport.width);
    });

    it('stays inside the window when the button is at the very right edge', () => {
        const trigger = { left: 1400, right: 1440, top: 100, bottom: 130 };
        const { left } = placePanel({ trigger, panel, viewport });
        expect(left + panel.width).toBeLessThanOrEqual(viewport.width - 8);
    });

    it('keeps a margin from the left edge when the panel is wider than the room', () => {
        const trigger = { left: 20, right: 60, top: 100, bottom: 130 };
        const { left } = placePanel({ trigger, panel: { width: 482, height: 100 }, viewport: { width: 300, height: 900 } });
        expect(left).toBe(8);
    });

    it('flips above the button when there is no room below', () => {
        const trigger = { left: 300, right: 400, top: 800, bottom: 830 };
        expect(placePanel({ trigger, panel, viewport }).top).toBe(400);
    });

    it('clamps to the bottom edge when there is no room above either', () => {
        const trigger = { left: 300, right: 400, top: 100, bottom: 130 };
        const { top } = placePanel({ trigger, panel: { width: 100, height: 500 }, viewport: { width: 1440, height: 560 } });
        expect(top).toBe(560 - 8 - 500);
    });
});
