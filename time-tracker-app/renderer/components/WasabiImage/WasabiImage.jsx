import React, { useState, useEffect } from 'react';
import { getUserImage } from '../../controller/user/user';
import { useSelector } from 'react-redux';
import { apiRequest } from '../../utils/services';
import { DEFAULT_USER_IMAGE as DEFAULT_USER, DEFAULT_TASK_IMAGE as DEFAULT_TASK } from '../../utils/imageDefaults';

const WasabiImage = ({ url = "", isUser, className = "", thumbnail = "" }) => {
    const [image, setImage] = useState(null);
    const [loading, setLoading] = useState(true);
    const currentCopany = useSelector((state) => state.company.currentCompany);
    const fallback = isUser ? DEFAULT_USER : DEFAULT_TASK;
    const triedOriginalRef = React.useRef(false);

    // Insert the thumbnail size before the extension, e.g. photo.jpg -> photo-35x35.jpg
    const withThumb = (p) => {
        if (!thumbnail) return p;
        const i = p.lastIndexOf('.');
        return i === -1 ? p : `${p.slice(0, i)}-${thumbnail}.${p.slice(i + 1)}`;
    };

    const resolveUser = (path, done) => {
        getUserImage({ path })
            .then(res => done(res.status ? res.statusText : fallback))
            .catch(() => done(fallback));
    };

    useEffect(() => {
        let active = true;
        triedOriginalRef.current = false;
        const done = (src) => { if (active) { setImage(src); setLoading(false); } };

        if (url === "") {
            done(fallback);
            return;
        }
        setLoading(true);
        if (url.includes("http") || url.startsWith("/")) {
            // Absolute URL or a local public asset (e.g. the default images) — use as-is.
            done(url);
        } else if (isUser) {
            resolveUser(withThumb(url), done);
        } else {
            apiRequest("post", '/api/v1/wasabi/retriveObject', { companyId: currentCopany?._id, path: url })
                .then(res => done(res.data.statusText))
                .catch(() => done(fallback));
        }
        return () => { active = false; };
    }, [url, thumbnail]);

    // If the thumbnail object is missing, retry the full-size image once before giving up.
    const handleError = () => {
        if (isUser && thumbnail && !triedOriginalRef.current && url && !url.includes("http")) {
            triedOriginalRef.current = true;
            resolveUser(url, (src) => setImage(src));
            return;
        }
        setImage(fallback);
    };

    if (loading) {
        return <span className={`inline-block bg-gray-200 animate-pulse ${className}`} />;
    }

    return (
        <img
            src={image}
            className={`object-cover ${className}`}
            alt="User Profile"
            onError={handleError}
        />
    );
};

export default WasabiImage;
