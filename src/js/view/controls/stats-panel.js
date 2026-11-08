import { createElement, addClass, removeClass } from 'utils/dom';

// Bảng "Thống kê chi tiết" (giống "Stats for nerds" của YouTube).
// Hiển thị khi model "displayStats" = true, cập nhật mỗi TICK_MS.

const TICK_MS = 500;
const HISTORY = 60; // số mẫu cho mỗi biểu đồ (30 giây)

const GRAPHS = {
    connection: '#3d7cdb',
    network: '#56c271',
    buffer: '#f2b46a'
};

const ROWS = [
    { key: 'id', label: 'Video ID / Session', mono: true },
    { key: 'viewport', label: 'Viewport / Frames' },
    { key: 'res', label: 'Current / Optimal Res' },
    { key: 'volume', label: 'Volume' },
    { key: 'codecs', label: 'Codecs' },
    { key: 'level', label: 'Bitrate / Level' },
    { key: 'range', label: 'Video Range' },
    { key: 'connection', label: 'Connection Speed', graph: true },
    { key: 'network', label: 'Network Activity', graph: true },
    { key: 'buffer', label: 'Buffer Health', graph: true },
    { key: 'latency', label: 'Live Latency' },
    { key: 'debug', label: 'Mystery Text' },
    { key: 'date', label: 'Date' }
];

const DASH = '—';

function template() {
    const rows = ROWS.map(({ key, label, mono, graph }) =>
        `<div class="jw-stats-row jw-reset" data-row="${key}">` +
            `<div class="jw-stats-label jw-reset">${label}</div>` +
            (graph ? `<canvas class="jw-stats-graph jw-reset" data-graph="${key}"></canvas>` : '') +
            `<div class="jw-stats-value jw-reset${mono ? ' jw-stats-mono' : ''}${graph ? ' jw-stats-graph-value' : ''}" data-value="${key}"></div>` +
        `</div>`
    ).join('');
    return (
        `<div class="jw-stats-panel jw-reset" role="region" aria-label="Stats">` +
            `<button type="button" class="jw-stats-close jw-reset-text" aria-label="Close">[X]</button>` +
            `<div class="jw-stats-rows jw-reset">${rows}</div>` +
        `</div>`
    );
}

function sessionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        if (i && i % 4 === 0) {
            out += ' ';
        }
        out += chars[bytes[i] % chars.length];
    }
    return out;
}

function bufferAhead(video) {
    const buffered = video.buffered;
    const t = video.currentTime;
    for (let i = 0; i < buffered.length; i++) {
        if (t >= buffered.start(i) - 0.1 && t <= buffered.end(i)) {
            return { start: buffered.start(i), end: buffered.end(i), ahead: Math.max(0, buffered.end(i) - t) };
        }
    }
    return { start: 0, end: 0, ahead: 0 };
}

function frameStats(video) {
    if (typeof video.getVideoPlaybackQuality === 'function') {
        const q = video.getVideoPlaybackQuality();
        return { dropped: q.droppedVideoFrames || 0, total: q.totalVideoFrames || 0 };
    }
    return {
        dropped: video.webkitDroppedFrameCount || 0,
        total: video.webkitDecodedFrameCount || 0
    };
}

function resolution(width, height, fps) {
    if (!width || !height) {
        return DASH;
    }
    return `${width}x${height}` + (fps ? `@${Math.round(fps)}` : '');
}

function mediaSourceType(hls) {
    const MMS = window.ManagedMediaSource;
    const preferManaged = !hls.config || hls.config.preferManagedMediaSource !== false;
    if (MMS && (preferManaged || !window.MediaSource)) {
        return 'ManagedMediaSource';
    }
    return window.MediaSource ? 'MediaSource' : 'WebKitMediaSource';
}

export default class StatsPanel {
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.el = null;
        this.timer = -1;
        this.boundHls = null;
        this.bytesSinceTick = 0;
        this.history = { connection: [], network: [], buffer: [] };
        this.fps = { frames: 0, mediaTime: 0, value: 0 };
        this.frameVideo = null;
        this.frameHandle = 0;
        this.lastFrame = null;
        this.session = sessionId();
        this.sessionItem = null;

        this.onFragLoaded = (event, data) => {
            const loaded = data && (data.part || data.frag);
            const bytes = (loaded && loaded.stats && loaded.stats.loaded) ||
                (data && data.payload && data.payload.byteLength) || 0;
            this.bytesSinceTick += bytes;
        };
        this.onCloseClick = (evt) => {
            evt.stopPropagation();
            this.model.set('displayStats', false);
        };
    }

    setup() {
        if (this.el) {
            return;
        }
        this.el = createElement(template());
        this.values = {};
        this.rows = {};
        this.graphs = {};
        ROWS.forEach(({ key, graph }) => {
            this.values[key] = this.el.querySelector(`[data-value="${key}"]`);
            this.rows[key] = this.el.querySelector(`[data-row="${key}"]`);
            if (graph) {
                this.graphs[key] = this.el.querySelector(`[data-graph="${key}"]`);
            }
        });
        this.el.querySelector('.jw-stats-close').addEventListener('click', this.onCloseClick);
        // Đặt trước menu chuột phải để menu luôn nằm trên panel
        const rightClick = this.container.querySelector('.jw-rightclick');
        this.container.insertBefore(this.el, rightClick || null);
    }

    open() {
        this.setup();
        addClass(this.el, 'jw-open');
        this.update();
        clearInterval(this.timer);
        this.timer = setInterval(() => this.update(), TICK_MS);
    }

    close() {
        clearInterval(this.timer);
        this.timer = -1;
        this.bindHls(null);
        this.watchFrames(null);
        this.history = { connection: [], network: [], buffer: [] };
        this.fps = { frames: 0, mediaTime: 0, value: 0 };
        if (this.el) {
            removeClass(this.el, 'jw-open');
        }
    }

    destroy() {
        this.close();
        if (this.el) {
            this.el.querySelector('.jw-stats-close').removeEventListener('click', this.onCloseClick);
            if (this.el.parentNode) {
                this.el.parentNode.removeChild(this.el);
            }
            this.el = null;
        }
    }

    bindHls(hls) {
        if (hls === this.boundHls) {
            return;
        }
        const fragLoaded = (h) => {
            const events = h.constructor && h.constructor.Events;
            return (events && events.FRAG_LOADED) || 'hlsFragLoaded';
        };
        if (this.boundHls) {
            this.boundHls.off(fragLoaded(this.boundHls), this.onFragLoaded);
        }
        this.boundHls = hls;
        this.bytesSinceTick = 0;
        if (hls) {
            hls.on(fragLoaded(hls), this.onFragLoaded);
        }
    }

    push(key, value) {
        const list = this.history[key];
        list.push(value);
        if (list.length > HISTORY) {
            list.shift();
        }
    }

    set(key, text) {
        const node = this.values[key];
        if (node && node.textContent !== text) {
            node.textContent = text;
        }
    }

    showRow(key, visible) {
        this.rows[key].style.display = visible ? '' : 'none';
    }

    // Theo dõi frame được trình chiếu bằng requestVideoFrameCallback (Safari 15.4+, Chrome 83+)
    watchFrames(video) {
        if (video === this.frameVideo) {
            return;
        }
        if (this.frameVideo && this.frameHandle && this.frameVideo.cancelVideoFrameCallback) {
            this.frameVideo.cancelVideoFrameCallback(this.frameHandle);
        }
        this.frameVideo = null;
        this.frameHandle = 0;
        this.lastFrame = null;
        if (!video || typeof video.requestVideoFrameCallback !== 'function') {
            return;
        }
        this.frameVideo = video;
        const onFrame = (now, metadata) => {
            this.lastFrame = metadata;
            if (this.frameVideo === video) {
                this.frameHandle = video.requestVideoFrameCallback(onFrame);
            }
        };
        this.frameHandle = video.requestVideoFrameCallback(onFrame);
    }

    // FPS của nội dung = số frame trình chiếu / thời lượng media đã phát (không phụ thuộc playbackRate)
    measureFps(video, totalFrames) {
        const frame = this.lastFrame;
        const frames = frame ? frame.presentedFrames : totalFrames;
        const mediaTime = frame ? frame.mediaTime : video.currentTime;
        const { frames: lastFrames, mediaTime: lastMediaTime } = this.fps;
        const elapsed = mediaTime - lastMediaTime;
        if (lastMediaTime && elapsed >= 0.25 && elapsed < 5 && frames > lastFrames) {
            const fps = (frames - lastFrames) / elapsed;
            if (fps > 1 && fps < 300) {
                this.fps.value = this.fps.value ? this.fps.value * 0.5 + fps * 0.5 : fps;
            }
        }
        if (!lastMediaTime || elapsed >= 0.25 || elapsed < 0) {
            this.fps.frames = frames;
            this.fps.mediaTime = mediaTime;
        }
        return this.fps.value;
    }

    update() {
        const model = this.model;
        const provider = model.getVideo && model.getVideo();
        const video = (provider && provider.video) || this.container.querySelector('video');
        const hls = (provider && provider.hlsjs) || null;
        this.bindHls(hls);

        const item = model.get('playlistItem') || {};
        if (item !== this.sessionItem) {
            this.sessionItem = item;
            this.session = sessionId();
        }
        this.set('id', `${item.mediaid || item.title || DASH} / ${this.session}`);
        this.set('date', new Date().toString());

        if (!video) {
            return;
        }
        this.watchFrames(video);

        // Viewport / Frames
        const dpr = window.devicePixelRatio || 1;
        const frames = frameStats(video);
        this.set('viewport', `${this.container.clientWidth}x${this.container.clientHeight}*${dpr.toFixed(2)} / ` +
            `${frames.dropped} dropped of ${frames.total}`);

        // Levels (hls.js)
        const levels = (hls && hls.levels) || [];
        let levelIndex = -1;
        if (hls) {
            levelIndex = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
        }
        const level = levels[levelIndex];
        const maxAuto = hls && hls.maxAutoLevel >= 0 ? hls.maxAutoLevel : levels.length - 1;
        const optimal = levels[maxAuto];

        const measuredFps = this.measureFps(video, frames.total);
        const currentFps = (level && level.frameRate) || measuredFps;
        const current = resolution(video.videoWidth, video.videoHeight, currentFps);
        this.set('res', `${current} / ` + (optimal && optimal.width
            ? resolution(optimal.width, optimal.height, optimal.frameRate || currentFps)
            : current));

        this.set('volume', `${Math.round(video.volume * 100)}%${video.muted ? ' (muted)' : ''}`);

        if (level) {
            // Playlist không có CODECS/BANDWIDTH → lấy codec từ SourceBuffer và bitrate đo được
            const tracks = provider.bufferCodecs || {};
            const trackCodec = (name) => tracks[name] && (tracks[name].codec || tracks[name].levelCodec);
            const audioTrack = hls.audioTracks && hls.audioTracks[hls.audioTrack];
            const videoCodec = level.videoCodec || trackCodec('video') || trackCodec('audiovideo');
            const audioCodec = (audioTrack && audioTrack.audioCodec) || level.audioCodec || trackCodec('audio');
            this.set('codecs', `${videoCodec || DASH} (${levelIndex}) / ${audioCodec || DASH}`);
            const bitrate = level.bitrate || level.realBitrate;
            this.set('level', `${bitrate ? `${Math.round(bitrate / 1000)} Kbps` : DASH} / ` +
                `${levelIndex + 1} of ${levels.length} (${hls.autoLevelEnabled ? 'auto' : 'manual'})`);
            this.set('range', level.videoRange || 'SDR');
        } else {
            this.set('codecs', DASH);
            this.set('level', DASH);
            this.set('range', DASH);
        }

        // Connection Speed
        const bandwidth = (hls && hls.bandwidthEstimate) || model.get('bandwidthEstimate') || 0;
        this.push('connection', bandwidth);
        this.set('connection', bandwidth ? `${Math.round(bandwidth / 1000)} Kbps` : DASH);

        // Network Activity
        const bytes = this.bytesSinceTick;
        this.bytesSinceTick = 0;
        this.push('network', bytes);
        this.set('network', hls ? `${Math.round(bytes / 1024)} KB` : DASH);

        // Buffer Health
        const buf = bufferAhead(video);
        this.push('buffer', buf.ahead);
        this.set('buffer', `${buf.ahead.toFixed(2)} s`);

        // Live Latency
        const streamType = model.get('streamType');
        const live = video.duration === Infinity || streamType === 'LIVE' || streamType === 'DVR';
        const latency = hls && live ? hls.latency : 0;
        this.showRow('latency', !!(live && latency));
        if (live && latency) {
            const target = hls.targetLatency;
            this.set('latency', `${latency.toFixed(2)} s` + (target ? ` (target ${target.toFixed(2)} s)` : ''));
        }

        // Mystery Text
        let engine = provider && provider.getName ? provider.getName().name : 'html5';
        if (hls) {
            const hlsVersion = (hls.constructor && hls.constructor.version) || '';
            engine = `hls.js ${hlsVersion}`.trim() + `, ${mediaSourceType(hls)}`;
        }
        this.set('debug', `${engine}, s:${model.get('state')} t:${video.currentTime.toFixed(2)} ` +
            `b:${buf.start.toFixed(3)}-${buf.end.toFixed(3)} r:${video.playbackRate} ` +
            `rs:${video.readyState} ns:${video.networkState}`);

        Object.keys(this.graphs).forEach(key => this.draw(key));
    }

    draw(key) {
        const canvas = this.graphs[key];
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) {
            return;
        }
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const list = this.history[key];
        const max = Math.max.apply(null, list.concat([key === 'buffer' ? 1 : 1e-9]));
        const barWidth = canvas.width / HISTORY;
        const offset = HISTORY - list.length;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = GRAPHS[key];
        list.forEach((value, i) => {
            const h = Math.max(value > 0 ? dpr : 0, (value / max) * canvas.height);
            ctx.fillRect((offset + i) * barWidth, canvas.height - h, Math.ceil(barWidth), h);
        });
    }
}
