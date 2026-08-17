// We want at least 10 keyframes in our encode and consistency in our interval
function getKeyframeIntervalArg(duration: number): string {
    let interval: number;
    if (duration < 60) {
        interval = 96;
    } else if (duration < 120) {
        interval = 120;
    } else {
        interval = 240;
    }

    return `-g ${String(interval)}`;
}

export { getKeyframeIntervalArg };