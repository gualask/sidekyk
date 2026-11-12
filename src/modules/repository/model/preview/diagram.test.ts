import { describe, expect, it } from 'vitest';
import { diagramColors, diagramUrl, fitted, ZOOM, zoomedAt } from './diagram';

describe('diagramColors', () => {
    it('takes each color from its token, trimmed as a computed style gives it', () => {
        const colors = diagramColors(true, (token) => ` value of ${token}`);
        expect(colors.dark).toBe(true);
        expect(colors.background).toBe('value of --ui-surface-subtle');
        expect(colors.node).toBe('value of --ui-surface');
        expect(colors.onLight).toBe('value of --ui-warning-on-solid');
        expect(colors.series).toEqual([
            'value of --ui-series-1',
            'value of --ui-series-2',
            'value of --ui-series-3',
            'value of --ui-series-4',
            'value of --ui-series-5',
            'value of --ui-series-6',
        ]);
    });
});

describe('diagramUrl', () => {
    it('makes an SVG an image URL, its text escaped', () => {
        expect(diagramUrl('<svg a="#1"/>')).toBe(
            'data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%231%22%2F%3E',
        );
    });
});

describe('fitted', () => {
    it('keeps a diagram that fits at its own size, centered', () => {
        expect(fitted({ width: 200, height: 100 }, { width: 600, height: 400 })).toEqual({
            scale: 1,
            x: 200,
            y: 150,
        });
    });

    it('scales a larger diagram down to the view, with a margin', () => {
        const placement = fitted({ width: 2000, height: 500 }, { width: 1048, height: 800 });
        expect(placement.scale).toBe(0.5);
        expect(placement.x).toBe(24);
        expect(placement.y).toBe(275);
    });
});

describe('zoomedAt', () => {
    it('keeps the point zoomed around where it is', () => {
        const zoomed = zoomedAt({ scale: 1, x: 10, y: 20 }, 2, { x: 110, y: 120 });
        expect(zoomed).toEqual({ scale: 2, x: -90, y: -80 });
        // the diagram's point under (110, 120) was (100, 100): it still is
        expect((110 - zoomed.x) / zoomed.scale).toBe(100);
    });

    it('stays within the zoom limits', () => {
        expect(zoomedAt({ scale: 7, x: 0, y: 0 }, 2, { x: 0, y: 0 }).scale).toBe(ZOOM.max);
        expect(zoomedAt({ scale: 0.12, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }).scale).toBe(ZOOM.min);
    });
});
