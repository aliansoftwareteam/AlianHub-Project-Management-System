import { beforeEach, describe, expect, it } from 'vitest';
import { dragHelper, fileImageReplacer } from '@/components/organisms/ImagePreviewer/hepler';
import fileIcons from '@/components/organisms/ImagePreviewer/fileIcons';

const urlOf = (ext) => fileIcons.find((entry) => entry.ext.includes(ext)).url;

describe('fileImageReplacer', () => {
    const { getFileImage, setFileImage } = fileImageReplacer();

    beforeEach(() => {
        setFileImage();
    });

    it('answers the same 80px width for every file', () => {
        expect(getFileImage('pdf', 'pdf').width).toBe('80px');
        expect(getFileImage(undefined, undefined).width).toBe('80px');
    });

    it('finds the icon by extension', () => {
        expect(getFileImage('', 'zip').url).toBe(urlOf('zip'));
    });

    it('finds the icon by type when the extension is unknown', () => {
        expect(getFileImage('pdf', 'weird').url).toBe(urlOf('pdf'));
    });

    it('shows the error icon for an unknown file', () => {
        const unknown = getFileImage('nothing', 'nothing').url;
        const none = getFileImage(undefined, undefined).url;
        expect(unknown).toBe(none);
        expect(unknown).not.toBe(urlOf('pdf'));
    });

    it('shows the error icon for the DEFAULT type even when the extension is known', () => {
        expect(getFileImage('DEFAULT', 'pdf').url).toBe(getFileImage(undefined, undefined).url);
    });

    it('matches extensions exactly, in lower case', () => {
        expect(getFileImage('', 'PDF').url).toBe(getFileImage(undefined, undefined).url);
    });

    it('uses the icons it was given instead of the built-in table', () => {
        setFileImage([{ type: ['image'], ext: [], url: 'custom.png' }]);
        expect(getFileImage('image', '').url).toBe('custom.png');
        expect(getFileImage('', 'zip').url).toBe(getFileImage(undefined, undefined).url);
    });

    it('goes back to the built-in table when given an empty list', () => {
        setFileImage([{ type: ['image'], ext: [], url: 'custom.png' }]);
        setFileImage([]);
        expect(getFileImage('', 'zip').url).toBe(urlOf('zip'));
    });

    it('shares what was set between callers', () => {
        const other = fileImageReplacer();
        setFileImage([{ type: ['audio'], ext: [], url: 'shared.png' }]);
        expect(other.getFileImage('audio', '').url).toBe('shared.png');
    });
});

describe('dragHelper', () => {
    const boxWith = (transform = '') => {
        const box = document.createElement('div');
        box.style.transform = transform;
        return box;
    };
    const mouse = (target, x, y) => ({ target, clientX: x, clientY: y });

    it('moves the picture by the distance the pointer travelled', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleMouseDown(mouse(box, 100, 100));
        drag.handleMouseMove(mouse(box, 130, 90));
        expect(box.style.transform).toBe('translate(30px, -10px)');
    });

    it('starts from where the picture already was', () => {
        const drag = dragHelper();
        const box = boxWith('translate(-20px, 15.5px)');
        drag.handleMouseDown(mouse(box, 0, 0));
        drag.handleMouseMove(mouse(box, 10, 10));
        expect(box.style.transform).toBe('translate(-10px, 25.5px)');
    });

    it('shows a grabbing hand while held and a grab hand after letting go', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleMouseDown(mouse(box, 0, 0));
        expect(box.style.cursor).toBe('grabbing');
        drag.handleMouseUp(mouse(box));
        expect(box.style.cursor).toBe('grab');
    });

    it('does not move without a press', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleMouseMove(mouse(box, 50, 50));
        expect(box.style.transform).toBe('');
    });

    it('stops moving after the pointer is released', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleMouseDown(mouse(box, 0, 0));
        drag.handleMouseUp(mouse(box));
        drag.handleMouseMove(mouse(box, 40, 40));
        expect(box.style.transform).toBe('');
    });

    it('moves less when zoomed in, so the picture follows the pointer', () => {
        const drag = dragHelper();
        drag.setScale(2);
        const box = boxWith();
        drag.handleMouseDown(mouse(box, 0, 0));
        drag.handleMouseMove(mouse(box, 40, 20));
        expect(box.style.transform).toBe('translate(20px, 10px)');
    });

    it('moves more when zoomed out', () => {
        const drag = dragHelper();
        drag.setScale(0.5);
        const box = boxWith();
        drag.handleMouseDown(mouse(box, 0, 0));
        drag.handleMouseMove(mouse(box, 10, 10));
        expect(box.style.transform).toBe('translate(20px, 20px)');
    });

    it('moves the element named by a selector rather than the event target', () => {
        const drag = dragHelper();
        const named = boxWith();
        named.id = 'drag-me';
        document.body.appendChild(named);
        try {
            drag.handleMouseDown(mouse(boxWith(), 0, 0), '#drag-me');
            drag.handleMouseMove(mouse(boxWith(), 5, 6), '#drag-me');
            expect(named.style.transform).toBe('translate(5px, 6px)');
        } finally {
            named.remove();
        }
    });

    it('keeps two helpers apart', () => {
        const one = dragHelper();
        const two = dragHelper();
        const box = boxWith();
        one.handleMouseDown(mouse(box, 0, 0));
        two.handleMouseMove(mouse(box, 9, 9));
        expect(box.style.transform).toBe('');
    });

    it('follows a finger the same way', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleTouchStart({ target: box, touches: [{ clientX: 10, clientY: 10 }] });
        drag.handleTouchMove({ target: box, touches: [{ clientX: 25, clientY: 5 }] });
        expect(box.style.transform).toBe('translate(15px, -5px)');
        drag.handleTouchEnd();
        drag.handleTouchMove({ target: box, touches: [{ clientX: 99, clientY: 99 }] });
        expect(box.style.transform).toBe('translate(15px, -5px)');
    });

    it('forgets the offset when told to reset', () => {
        const drag = dragHelper();
        const box = boxWith();
        drag.handleTouchStart({ target: box, touches: [{ clientX: 10, clientY: 10 }] });
        drag.handleTouchMove({ target: box, touches: [{ clientX: 20, clientY: 20 }] });
        drag.handleTouchEnd();
        drag.resetOffsets();
        drag.handleTouchStart({ target: box, touches: [{ clientX: 0, clientY: 0 }] });
        expect(box.style.transform).toBe('translate(0px, 0px)');
    });
});
