import React, { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import WasabiImage from '../WasabiImage/WasabiImage';
import { loadIconSet, isLoaded, iconLoaded, DEFAULT_ICON, DEFAULT_ICON_COLOR } from '../../utils/iconLibrary';

// Single renderer for a task type's icon — library (Iconify mdi) or uploaded image —
// mirroring the web app's TaskTypeIcon so the tracker shows the same icons.
// Pass the matched taskTypeCounts entry as `taskType` ({ iconType, iconValue, iconColor, taskImage }).
//
// `color` overrides the task type's own colour, and exists for callers drawing on a dark
// surface. A task type with no colour of its own falls back to the app navy — the exact
// navy of the running-tracker header — so the icon was being painted in its background and
// disappeared. Only that one caller passes it; everywhere else is unchanged.
const TaskTypeIcon = ({ taskType = {}, className = '', color }) => {
    const isLibrary = taskType?.iconType === 'library' && !!taskType?.iconValue;
    const [ready, setReady] = useState(isLoaded());

    useEffect(() => {
        let active = true;
        if (isLibrary && !ready) {
            loadIconSet().then(() => { if (active) setReady(true); });
        }
        return () => { active = false; };
    }, [isLibrary, ready]);

    // Uploaded image (or no library icon) → existing WasabiImage path (http + storage).
    if (!isLibrary) {
        return <WasabiImage url={taskType?.taskImage || ''} isUser={false} className={className} />;
    }

    // Placeholder until the mdi set is registered → no layout jump, no CDN lookup.
    if (!ready) return <span className={`inline-block ${className}`} />;

    const resolvedColor = color || taskType?.iconColor || DEFAULT_ICON_COLOR;
    // Only render names that resolved offline; anything else (lucide/tabler/unknown)
    // shows the default mdi icon instead of triggering an Iconify API fetch.
    const name = iconLoaded(taskType.iconValue) ? taskType.iconValue : DEFAULT_ICON;
    return <Icon icon={name} color={resolvedColor} className={className} />;
};

export default TaskTypeIcon;
