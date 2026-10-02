export function assignLanes(ranges) {
    const order = ranges
        .map((range, index) => ({ range, index }))
        .sort((a, b) => a.range.from.localeCompare(b.range.from) || a.index - b.index);
    const laneEnds = [];
    const lanes = new Array(ranges.length);
    order.forEach(({ range, index }) => {
        let lane = laneEnds.findIndex((end) => end < range.from);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = range.to;
        lanes[index] = lane;
    });
    return ranges.map((range, index) => ({ ...range, lane: lanes[index] }));
}
