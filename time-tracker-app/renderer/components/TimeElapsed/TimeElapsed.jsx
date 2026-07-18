import React, { useState, useEffect } from 'react';

const TimeElapsed = (props) => {
    const [startTime, setStartTime] = useState(props.time); // Set the initial start time
    const [elapsedTime, setElapsedTime] = useState(0); // Time elapsed in milliseconds

    useEffect(() => {

        const interval = setInterval(() => {
            const currentTime = new Date();
            const elapsed = currentTime - startTime;
            setElapsedTime(elapsed);
        }, 1000); // Update every second

        return () => {
            clearInterval(interval);
        };
    }, [startTime]);

    const formatTime = (milliseconds) => {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        return `${(hours).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')} hrs`;
    };

    return (
        <span style={{ fontWeight: 'normal', fontSize: '30px', lineHeight: '39px', color: '#fff' }}>
            {formatTime(elapsedTime)}
        </span>
    );
};

export default TimeElapsed;