import React, { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import WasabiImage from '../WasabiImage/WasabiImage';
import { loadIconSet, isLoaded, iconLoaded, DEFAULT_ICON, DEFAULT_ICON_COLOR } from '../../utils/iconLibrary';

// Single renderer for a task type's icon — library (Iconify mdi) or uploaded image —
// mirroring the web app's TaskTypeIcon so the tracker shows the same icons.
// Pass the matched taskTypeCounts entry as `taskType` ({ iconType, iconValue, iconColor, taskImage }).
const TaskTypeIcon = ({ taskType = {}, className = '' }) => {
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

    const color = taskType?.iconColor || DEFAULT_ICON_COLOR;
    // Only render names that resolved offline; anything else (lucide/tabler/unknown)
    // shows the default mdi icon instead of triggering an Iconify API fetch.
    const name = iconLoaded(taskType.iconValue) ? taskType.iconValue : DEFAULT_ICON;
    return <Icon icon={name} color={color} className={className} />;
};

export default TaskTypeIcon;
