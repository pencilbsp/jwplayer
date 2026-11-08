import { ajax } from 'utils/ajax';
import type { TimeSliderWithMixins } from './timeslider';

// Biểu đồ "Được xem nhiều nhất" phía trên thanh tua (giống YouTube).
// Playlist item nhận `heatmap`: URL trả JSON hoặc object { values: number[], peak?: number }.
// values: mỗi phần tử là một đoạn bằng nhau của video, 0..1 (đoạn xem nhiều nhất = 1).

export type HeatmapData = {
    values: number[];
    peak?: number;
};

type Point = { x: number; y: number };

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 100;
// Đoạn không ai xem vẫn cao 10% (4px trên 40px) để đường cong không chạm đáy
const MIN_HEIGHT_RATIO = 0.1;
// Hệ số làm mượt Bézier (giống player YouTube)
const SMOOTHING = 0.2;
const MAX_VALUES = 1000;

let gradientCounter = 0;

function normalizeHeatmap(input: unknown): HeatmapData | null {
    const raw: Partial<HeatmapData> | null = Array.isArray(input) ? { values: input } : input as Partial<HeatmapData> | null;
    if (!raw || !Array.isArray(raw.values) || raw.values.length < 2 || raw.values.length > MAX_VALUES) {
        return null;
    }
    const values = raw.values.map(value => {
        const n = Number(value);
        return isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
    });
    if (!values.some(value => value > 0)) {
        return null;
    }
    const peak = Number(raw.peak);
    return {
        values,
        peak: Number.isInteger(peak) && peak >= 0 && peak < values.length ? peak : undefined
    };
}

function heatmapPoints(values: number[]): Point[] {
    const step = VIEWBOX_WIDTH / values.length;
    const points: Point[] = [{ x: 0, y: VIEWBOX_HEIGHT }];
    values.forEach((value, index) => {
        const height = Math.min(Math.max(value, MIN_HEIGHT_RATIO), 1) * VIEWBOX_HEIGHT;
        const y = VIEWBOX_HEIGHT - height;
        points.push({ x: (index + 0.5) * step, y });
        if (index === values.length - 1) {
            points.push({ x: VIEWBOX_WIDTH, y });
        }
    });
    points.push({ x: VIEWBOX_WIDTH, y: VIEWBOX_HEIGHT });
    return points;
}

function controlPoint(current: Point, previous: Point | undefined, next: Point | undefined, reverse: boolean): Point {
    const from = previous || current;
    const to = next || current;
    const ratio = reverse ? -SMOOTHING : SMOOTHING;
    return {
        x: current.x + (to.x - from.x) * ratio,
        y: current.y + (to.y - from.y) * ratio
    };
}

export function heatmapPath(values: number[]): string {
    const points = heatmapPoints(values);
    const format = (point: Point): string => `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    return points.map((point, index) => {
        if (index === 0) {
            return `M ${format(point)}`;
        }
        const start = controlPoint(points[index - 1], points[index - 2], point, false);
        const end = controlPoint(point, points[index - 1], points[index + 1], true);
        return ` C ${format(start)} ${format(end)} ${format(point)}`;
    }).join('');
}

function createHeatmapElement(): { el: HTMLElement; path: SVGPathElement } {
    const gradientId = `jw-heatmap-gradient-${++gradientCounter}`;
    const el = document.createElement('div');
    el.className = 'jw-heatmap jw-reset';
    el.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'jw-heatmap-svg');
    svg.setAttribute('viewBox', `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const defs = document.createElementNS(SVG_NS, 'defs');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('x2', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('y2', '1');
    [['0', '0.55'], ['1', '0']].forEach(([offset, opacity]) => {
        const stop = document.createElementNS(SVG_NS, 'stop');
        stop.setAttribute('offset', offset);
        stop.setAttribute('stop-color', '#fff');
        stop.setAttribute('stop-opacity', opacity);
        gradient.appendChild(stop);
    });
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'jw-heatmap-path');
    path.setAttribute('fill', `url(#${gradientId})`);
    svg.appendChild(path);
    el.appendChild(svg);
    return { el, path };
}

export interface HeatmapMixinInt {
    heatmap?: HeatmapData | null;
    heatmapEl?: HTMLElement | null;
    heatmapPathEl?: SVGPathElement | null;
    heatmapRequest?: number;
    loadHeatmap: (this: TimeSliderWithMixins, source: unknown) => void;
    setHeatmap: (this: TimeSliderWithMixins, data: unknown) => void;
    drawHeatmap: (this: TimeSliderWithMixins) => void;
    resetHeatmap: (this: TimeSliderWithMixins) => void;
    heatmapLabel: (this: TimeSliderWithMixins, time: number, duration: number) => string;
}

const HeatmapMixin: HeatmapMixinInt = {
    loadHeatmap: function (this: TimeSliderWithMixins, source: unknown): void {
        const request = this.heatmapRequest = (this.heatmapRequest || 0) + 1;
        if (!source) {
            return;
        }
        if (typeof source !== 'string') {
            this.setHeatmap(source);
            return;
        }
        ajax(source, (xhr: XMLHttpRequest) => {
            if (request !== this.heatmapRequest || !xhr.responseText) {
                return;
            }
            try {
                this.setHeatmap(JSON.parse(xhr.responseText));
            } catch (e) {/* JSON lỗi → không hiển thị heatmap */}
        }, () => {/* không có heatmap */}, {
            plainText: true,
            withCredentials: false
        });
    },

    setHeatmap: function (this: TimeSliderWithMixins, data: unknown): void {
        this.heatmap = normalizeHeatmap(data);
        this.drawHeatmap();
    },

    drawHeatmap: function (this: TimeSliderWithMixins): void {
        const data = this.heatmap;
        const duration = this._model.get('duration');
        const isVod = !this.streamType || this.streamType === 'VOD';
        if (!data || !isVod || !(duration > 0)) {
            if (this.heatmapEl) {
                this.heatmapEl.style.display = 'none';
            }
            return;
        }
        if (!this.heatmapEl) {
            const { el, path } = createHeatmapElement();
            this.heatmapEl = el;
            this.heatmapPathEl = path;
            this.elementRail.insertBefore(el, this.elementRail.firstChild);
        }
        (this.heatmapPathEl as SVGPathElement).setAttribute('d', heatmapPath(data.values));
        this.heatmapEl.style.removeProperty('display');
    },

    resetHeatmap: function (this: TimeSliderWithMixins): void {
        this.heatmapRequest = (this.heatmapRequest || 0) + 1;
        this.heatmap = null;
        if (this.heatmapEl) {
            this.heatmapEl.style.display = 'none';
        }
    },

    heatmapLabel: function (this: TimeSliderWithMixins, time: number, duration: number): string {
        const data = this.heatmap;
        if (!data || data.peak === undefined || !(duration > 0)) {
            return '';
        }
        const index = Math.floor(time / duration * data.values.length);
        if (Math.abs(index - data.peak) > 1) {
            return '';
        }
        return this._model.get('localization').mostReplayed || 'Most replayed';
    }
};

export default HeatmapMixin;
