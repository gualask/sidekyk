/** A sparkline's box: its width, its height, and the room kept above and below the line. */
export interface SparklineBox {
    width: number;
    height: number;
    /** Room at the top and the bottom, so that the stroke is never cut. */
    inset: number;
}

/**
 * A smooth line through `values` at even steps, the largest at the top, 0 on the baseline, as an
 * SVG path: monotone between two values (Steffen's tangents), so that it never dips under the
 * baseline nor peaks past the busiest value, and a run of zeros stays flat on it.
 */
export function sparklinePath(values: readonly number[], box: SparklineBox): string {
    const top = Math.max(...values, 0);
    const step = values.length > 1 ? box.width / (values.length - 1) : 0;
    const span = box.height - 2 * box.inset;
    const ys = values.map((value) => box.height - box.inset - (top > 0 ? (value / top) * span : 0));
    // slopes between points, then the tangent at each point (flat at both ends)
    const slopes = ys.slice(1).map((y, index) => y - ys[index]);
    const tangents = ys.map((_, index) => {
        if (index === 0 || index === ys.length - 1) return 0;
        const before = slopes[index - 1];
        const after = slopes[index];
        const sides = Math.sign(before) + Math.sign(after);
        return sides * Math.min(Math.abs(before), Math.abs(after), Math.abs(before + after) / 4);
    });
    let path = `M0 ${round(ys[0] ?? box.height - box.inset)}`;
    for (let index = 1; index < ys.length; index++) {
        const x0 = (index - 1) * step;
        const x1 = index * step;
        const c1 = `${round(x0 + step / 3)} ${round(ys[index - 1] + tangents[index - 1] / 3)}`;
        const c2 = `${round(x1 - step / 3)} ${round(ys[index] - tangents[index] / 3)}`;
        path += ` C${c1} ${c2} ${round(x1)} ${round(ys[index])}`;
    }
    return path;
}

/** The area under a sparkline's path, down to the bottom of its box. */
export function sparklineArea(path: string, box: SparklineBox): string {
    return `${path} L${box.width} ${box.height} L0 ${box.height} Z`;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
