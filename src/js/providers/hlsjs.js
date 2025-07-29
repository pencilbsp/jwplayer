import Events from "../utils/backbone.events";
import ApiSettings from "../api/api-settings";
import { getLiveSyncDuration } from "../api/config";
import { Browser, OS } from "../environment/environment";
import {
    ABSOLUTE_POSITION_READY,
    AUDIO_TRACK_CHANGED,
    AUDIO_TRACKS,
    MEDIA_ERROR,
    MEDIA_LEVEL_CHANGED,
    MEDIA_LEVELS,
    MEDIA_META,
    MEDIA_SEEK,
    MEDIA_TYPE,
    MEDIA_VISUAL_QUALITY,
    STATE_COMPLETE,
    STATE_IDLE,
    STATE_LOADING,
    STATE_PLAYING,
    STATE_STALLED,
    WARNING,
} from "../events/events";
import { now } from "../utils/date";
import VTTCue from "../parsers/captions/vttcue";
import {
    each,
    find,
    indexOf,
    isFinite,
    isNaN,
    isNumber,
    isValidNumber,
    map,
    matches,
    pick,
    reduce,
    size,
} from "../utils/underscore";
import BandwidthMonitor from "./bandwidth-monitor";
import { MaxBufferLength, MetaBufferLength } from "./constants";
import * as H from "./crack/1384";
import * as U from "./crack/386";
import { Z } from "./crack/8494";
import * as O from "./crack/3343";
import { qualityLevel } from "./data-normalizer";
import Tracks from "./tracks-mixin";
import parseNetworkError from "./utils/network-error-parser";
import createPlayPromise from "./utils/play-promise";
import { generateLabel, hasRedundantLevels } from "./utils/quality-labels";
import { isDvr } from "./utils/stream-type";
import VideoActionsMixin from "./video-actions-mixin";
import VideoAttachedMixin from "./video-attached-mixin";
import VideoListenerMixin from "./video-listener-mixin";

import {
    MSG_BAD_CONNECTION,
    MSG_CANT_PLAY_IN_BROWSER,
    MSG_CANT_PLAY_VIDEO,
    MSG_LIVE_STREAM_DOWN,
    PlayerError,
} from "../api/errors";
import Hls from "hls.js";

class a {
    constructor(e, t, i, r) {
        this.video = e;
        this.hlsjs = i;
        this.videoListeners = t;
        this.hlsjsListeners = r;
    }
    on() {
        this.off();
        (0, each)(this.videoListeners, (e, t) => {
            this.video.addEventListener(t, e, false);
        });
        (0, each)(this.hlsjsListeners, (e, t) => {
            this.hlsjs.on(t, e);
        });
    }
    off() {
        (0, each)(this.videoListeners, (e, t) => {
            this.video.removeEventListener(t, e);
        });
        (0, each)(this.hlsjsListeners, (e, t) => {
            this.hlsjs.off(t, e);
        });
    }
}

const l = (e) =>
    e.audioGroupIds ? e.audioGroupIds[e._urlId || e.urlId] : undefined;
const u = (e, t) => {
    const i = (0, hasRedundantLevels)(e);
    const r = (0, map)(e, (e, r) => ({
        label: (0, generateLabel)(e, t, i),
        level_id: e.id,
        hlsjsIndex: r,
        bitrate: e.bitrate,
        height: e.height,
        width: e.width,
        audioGroupId: l(e),
    }));
    r.sort((e, t) =>
        e.height && t.height && e.height !== t.height
            ? t.height - e.height
            : (t.bitrate || 0) - (e.bitrate || 0)
    );
    if (r.length > 1) {
        r.unshift({
            label: "Auto",
            level_id: "auto",
            hlsjsIndex: -1,
        });
    }
    return r;
};
const d = (e, t) =>
    Math.max(
        0,
        (0, indexOf)(
            t,
            (0, find)(t, (t) => t.hlsjsIndex === e)
        )
    );
const h = (e, t, i, r = e.length) => {
    const n = (() => {
        try {
            return window.devicePixelRatio;
        } catch (e) {}
        return 1;
    })();
    t *= n;
    i *= n;
    if (OS.tizen) {
        t = Infinity;
        i = Infinity;
    }
    for (let n = 0; n < r; n++) {
        const r = e[n];
        if (
            (r.width >= t || r.height >= i) &&
            ((a = r),
            !(s = e[n + 1]) || a.width !== s.width || a.height !== s.height)
        ) {
            return n;
        }
    }
    var a;
    var s;
    return r - 1;
};
const c = Z.logger.child("providers/hlsjs");
const f = (e) => c[e].bind(c);
const g = f("debug");
const v = f("log");
const m = f("info");
const p = f("warn");
const y = f("error");

const r = {
    debug: g,
    error: y,
    info: m,
    log: v,
    warn: p,
};

function L(e) {
    const {
        withCredentials: t,
        aesToken: i,
        renderTextTracksNatively: a,
        onXhrOpen: s,
        liveSyncDuration: o,
        hlsjsConfig: l,
        cmcd: u,
    } = e;
    const d = (0, pick)(l || {}, [
        "maxMaxBufferLength",
        "liveSyncDuration",
        "liveSyncDurationCount",
        "liveMaxLatencyDuration",
        "liveMaxLatencyDurationCount",
        "liveBackBufferLength",
        "backBufferLength",
        "loader",
        "pLoader",
        "fLoader",
        "fragLoadPolicy",
        "enableWorker",
        "debug",
    ]);
    const h = {
        autoStartLoad: false,
        capLevelToPlayerSize: false,
        captionsTextTrack1Label: "",
        captionsTextTrack2Label: "",
        captionsTextTrack3Label: "",
        captionsTextTrack4Label: "",
        captionsTextTrack1LanguageCode: "",
        captionsTextTrack2LanguageCode: "",
        captionsTextTrack3LanguageCode: "",
        captionsTextTrack4LanguageCode: "",
        debug: !!ApiSettings.debug && r,
        maxMaxBufferLength: MaxBufferLength,
        renderTextTracksNatively: a,
        startLevel: -1,
        testBandwidth: false,
        preferManagedMediaSource: false,
        fragLoadPolicy: {
            default: {
                maxLoadTimeMs: 20000,
                timeoutRetry: {
                    maxNumRetry: 2,
                    retryDelayMs: 4000,
                    maxRetryDelayMs: 4000,
                },
                errorRetry: {
                    maxNumRetry: 2,
                    retryDelayMs: 4000,
                    maxRetryDelayMs: 4000,
                },
            },
        },
    };
    if (u) {
        h.cmcd = {
            sessionId: u.sessionId,
            contentId: u.contentId,
            useHeaders: u.useHeaders,
        };
    }
    const {
        liveSyncDurationCount: c,
        liveMaxLatencyDurationCount: f,
        liveMaxLatencyDuration: g,
    } = d;
    if (c !== undefined || f !== undefined) {
        d.liveSyncDuration = d.liveMaxLatencyDuration = undefined;
        d.liveSyncDurationCount = (0, isFinite)(c) ? c : Infinity;
        d.liveMaxLatencyDurationCount = (0, isFinite)(f) ? f : Infinity;
    } else if (o !== undefined || g !== undefined) {
        d.liveSyncDurationCount = d.liveMaxLatencyDurationCount = undefined;
        h.liveSyncDuration = getLiveSyncDuration(o);
        d.liveMaxLatencyDuration = (0, isFinite)(g) ? g : Infinity;
    }
    if (t || i || s) {
        return Object.assign(
            {},
            h,
            ((e, t, i) => ({
                xhrSetup(r, n) {
                    if (e) {
                        r.withCredentials = true;
                    }
                    if (t) {
                        const e = n.indexOf("?") > 0 ? "&token=" : "?token=";
                        r.open("GET", n + e + t, true);
                    }
                    if (typeof i == "function") {
                        i(r, n);
                    }
                },
                fetchSetup(i, r) {
                    if (t) {
                        const e =
                            i.url.indexOf("?") > 0 ? "&token=" : "?token=";
                        i.url = i.url + e + t;
                    }
                    if (e) {
                        r.credentials = "include";
                    }
                    return new Request(i.url, r);
                },
            }))(t, i, s),
            d
        );
    } else {
        return Object.assign({}, h, d);
    }
}

let k = (function (e) {
    e[(e.BASE_ERROR = 230000)] = "BASE_ERROR";
    e[(e.ERROR_LIVE_STREAM_DOWN_OR_ENDED = 230001)] =
        "ERROR_LIVE_STREAM_DOWN_OR_ENDED";
    e[(e.MANIFEST_ERROR_CONNECTION_LOST = 232002)] =
        "MANIFEST_ERROR_CONNECTION_LOST";
    e[(e.ERROR_CONNECTION_LOST = 230002)] = "ERROR_CONNECTION_LOST";
    e[(e.MANIFEST_PARSING_ERROR = 232600)] = "MANIFEST_PARSING_ERROR";
    e[(e.LEVEL_EMPTY_ERROR = 232631)] = "LEVEL_EMPTY_ERROR";
    e[(e.MANIFEST_INCOMPATIBLE_CODECS_ERROR = 232632)] =
        "MANIFEST_INCOMPATIBLE_CODECS_ERROR";
    e[(e.FRAG_PARSING_ERROR = 233600)] = "FRAG_PARSING_ERROR";
    e[(e.FRAG_DECRYPT_ERROR = 233650)] = "FRAG_DECRYPT_ERROR";
    e[(e.BUFFER_STALLED_ERROR = 234001)] = "BUFFER_STALLED_ERROR";
    e[(e.BUFFER_APPEND_ERROR = 234002)] = "BUFFER_APPEND_ERROR";
    e[(e.PROTECTED_CONTENT_ACCESS_ERROR = 232403)] =
        "PROTECTED_CONTENT_ACCESS_ERROR";
    return e;
})({});
const b = (e) => {
    if (e) {
        if (/^frag/.test(e)) {
            return 2000;
        }
        if (/^(manifest|level|audioTrack)/.test(e)) {
            return 1000;
        }
        if (/^key/.test(e)) {
            return 4000;
        }
    }
    return 0;
};

class P extends Events {}
Object.assign(P.prototype, VideoActionsMixin, VideoAttachedMixin, Tracks);
const w = P;

const j = (e, t, i) => {
    const r = e.sources[0];
    if (r[i] !== undefined) {
        return r[i];
    } else if (e[i] !== undefined) {
        return e[i];
    } else {
        return t[i];
    }
};
const W = (function (e) {
    const {
        MEDIA_ATTACHED: t,
        MEDIA_DETACHED: i,
        MANIFEST_PARSED: r,
        LEVEL_LOADED: s,
        LEVEL_UPDATED: c,
        LEVEL_PTS_UPDATED: f,
        FRAG_CHANGED: g,
        FRAG_LOADED: v,
        LEVEL_SWITCHED: m,
        FRAG_PARSING_METADATA: y,
        BUFFER_APPENDED: E,
        BUFFER_CODECS: S,
        FRAG_BUFFERED: I,
        INIT_PTS_FOUND: D,
        NON_NATIVE_TEXT_TRACKS_FOUND: _,
        CUES_PARSED: C,
        AUDIO_TRACKS_UPDATED: P,
        ERROR: Y,
    } = e.Events;
    const { MEDIA_ERROR: W, NETWORK_ERROR: q } = e.ErrorTypes;
    const X = (function (e) {
        const { NETWORK_ERROR: t } = e.ErrorTypes;
        const {
            MANIFEST_PARSING_ERROR: i,
            LEVEL_EMPTY_ERROR: r,
            MANIFEST_INCOMPATIBLE_CODECS_ERROR: n,
            FRAG_PARSING_ERROR: a,
            FRAG_DECRYPT_ERROR: s,
            BUFFER_STALLED_ERROR: o,
            BUFFER_APPEND_ERROR: l,
            INTERNAL_EXCEPTION: u,
            MANIFEST_LOAD_ERROR: d,
            MANIFEST_LOAD_TIMEOUT: h,
            LEVEL_LOAD_ERROR: c,
            LEVEL_LOAD_TIMEOUT: f,
            FRAG_LOAD_ERROR: g,
            FRAG_LOAD_TIMEOUT: v,
            BUFFER_SEEK_OVER_HOLE: m,
            BUFFER_NUDGE_ON_STALL: p,
        } = e.ErrorDetails;
        const y = [d, h, i, n, c, f, g, v];
        const T = [o, m, p];
        const E = [r, c, f];
        return function (e) {
            const { details: d, response: h, type: c } = e;
            let f = e.fatal;
            let g = y.indexOf(d) < 0;
            const v = T.indexOf(d) >= 0;
            let m = E.indexOf(d) >= 0;
            let p = MSG_CANT_PLAY_VIDEO;
            let S = k.BASE_ERROR;
            switch (d) {
                case i:
                    S = k.MANIFEST_PARSING_ERROR;
                    break;
                case r:
                    S = k.LEVEL_EMPTY_ERROR;
                    break;
                case n:
                    p = MSG_CANT_PLAY_IN_BROWSER;
                    S = k.MANIFEST_INCOMPATIBLE_CODECS_ERROR;
                    break;
                case a:
                    S = k.FRAG_PARSING_ERROR;
                    break;
                case s:
                    S = k.FRAG_DECRYPT_ERROR;
                    break;
                case o:
                    S = k.BUFFER_STALLED_ERROR;
                    break;
                case l:
                    S = k.BUFFER_APPEND_ERROR;
                    break;
                case u:
                    S = 239000;
                    break;
                default:
                    if (c === t) {
                        if (navigator.onLine === false) {
                            g = false;
                            f = d === "manifestLoadError";
                            m = false;
                            S = f
                                ? k.MANIFEST_ERROR_CONNECTION_LOST
                                : k.ERROR_CONNECTION_LOST;
                            p = MSG_BAD_CONNECTION;
                        } else if (/TimeOut$/.test(d)) {
                            S = k.BASE_ERROR + 1001 + b(d);
                        } else if (h) {
                            ({ code: S, key: p } = (0, parseNetworkError)(
                                k.BASE_ERROR,
                                h.code,
                                e.url
                            ));
                            S += b(d);
                        }
                    }
            }
            return {
                key: p,
                code: S,
                recoverable: g,
                stalling: v,
                suppressLevel: m,
                fatal: f,
                error: e,
            };
        };
    })(e);
    return class A extends w {
        constructor(e, t, i) {
            var r;
            super();
            this.bandwidthMonitor = (0, BandwidthMonitor)(
                this,
                t.bandwidthEstimate
            );
            this.bitrateSelection = t.bitrateSelection;
            this.bufferStallTimeout = 1000;
            this.connectionTimeoutDuration = 10000;
            this.dvrEnd = null;
            this.dvrPosition = null;
            this.dvrUpdatedTime = 0;
            this.eventHandler = null;
            this.hlsjs = null;
            this.hlsjsConfig = null;
            this.hlsjsOptions = null;
            this.jwConfig = t;
            this.lastPosition = 0;
            this.maxRetries = 3;
            this.playerId = e;
            this.processPlaylistMetadata = O.q;
            this.recoveryInterval = 5000;
            this.renderNatively =
                ((r = t.renderCaptionsNatively),
                !!OS.iOS || !!Browser.safari || (Browser.chrome && r));
            this.savedVideoProperties = false;
            this.seeking = false;
            this.staleManifestDurationMultiplier = 3000;
            this.state = STATE_IDLE;
            this.supports = A.supports;
            this.supportsPlaybackRate = true;
            this.video = i;
            this.playerWidth = 0;
            this.playerHeight = 0;
            this.playerStretching = null;
            this.capLevels = false;
            this.levelDuration = 0;
            this.live = false;
            this.liveEdgePosition = null;
            this.liveEdgeUpdated = 0;
            this.staleManifestTimeout = -1;
            this.connectionTimeout = -1;
            this.programDateSyncTime = 0;
            this.retryCount = 0;
            this.stallTime = -1;
            this.jwLevels = [];
            this.audioTracks = null;
            this.audioTracksArray = null;
            this.resetLifecycleVariables();
        }
        resetLifecycleVariables() {
            this.resetRecovery();
            this.stopStaleTimeout();
            this.stopConnectionTimeout();
            this.stallTime = -1;
            this.streamBitrate = -1;
            this.videoFound = false;
            this.videoHeight = 0;
            this.src = null;
            this.currentHlsjsLevel = null;
            this.currentAudioTrackIndex = null;
            this.currentJwItem = null;
            this.jwLevels = [];
            this.audioTracks = null;
            this.audioTracksArray = null;
            this.lastRecoveryTime = null;
            this.lastEndSn = null;
            this.levelDuration = 0;
            this.live = false;
            this.liveEdgePosition = null;
            this.liveEdgeUpdated = 0;
            this.liveEdgeSn = -1;
            this.isLiveStreamUnloaded = false;
            this.recoveringMediaError = false;
            this.recoveringNetworkError = false;
            this.streamType = "VOD";
            this.lastProgramDateTime = 0;
            this.programDateSyncTime = 0;
        }
        resetRecovery() {
            this.retryCount = 0;
        }
        stopStaleTimeout() {
            if (this.staleManifestTimeout !== -1) {
                clearTimeout(this.staleManifestTimeout);
            }
            this.staleManifestTimeout = -1;
        }
        stopConnectionTimeout() {
            if (this.connectionTimeout !== -1) {
                clearTimeout(this.connectionTimeout);
            }
            this.connectionTimeout = -1;
        }
        startConnectionTimeout() {
            if (this.connectionTimeout === -1) {
                this.connectionTimeout = window.setTimeout(() => {
                    if (navigator.onLine) {
                        this.hlsjs.startLoad();
                    } else {
                        this.handleError(
                            k.ERROR_CONNECTION_LOST,
                            null,
                            MSG_BAD_CONNECTION
                        );
                    }
                }, this.connectionTimeoutDuration);
            }
        }
        initHlsjs(t) {
            var i;
            const r = this.jwConfig.hlsjsConfig;
            const s = Boolean(this.jwConfig.cmcd);
            const o = Boolean(this.hlsjsOptions);
            let l = (i = this.hlsjsOptions) == null ? undefined : i.cmcd;
            if (!o && s) {
                l = Object.assign(
                    {},
                    {
                        contentId: t == null ? undefined : t.mediaid,
                    },
                    this.jwConfig.cmcd
                );
            }
            const u = {
                cmcd: l,
                withCredentials: Boolean(
                    j(t, this.jwConfig, "withCredentials")
                ),
                aesToken: j(t, this.jwConfig, "aestoken"),
                renderTextTracksNatively: this.renderNatively,
                onXhrOpen: t.sources[0].onXhrOpen,
                liveSyncDuration: j(t, this.jwConfig, "liveSyncDuration"),
                hlsjsConfig: r,
            };
            this.setupSideloadedTracks(t.tracks);
            this.capLevels = !t.stereomode;
            if (this.hlsjs && (0, matches)(this.hlsjsOptions)(u)) {
                return;
            }
            this.hlsjsOptions = u;
            this.restoreVideoProperties();
            this.stopStaleTimeout();
            this.stopConnectionTimeout();
            this.hlsjsConfig = L(u);
            const d = Object.assign({}, this.hlsjsConfig);
            const h = this.bandwidthMonitor.getEstimate();
            if ((0, isValidNumber)(h)) {
                d.abrEwmaDefaultEstimate = h;
            }
            d.appendErrorMaxRetry = 1;
            this.hlsjs = new e(d);
            this.eventHandler = new a(
                this.video,
                this.createVideoListeners(),
                this.hlsjs,
                this.createHlsjsListeners()
            );
        }
        init(e) {
            this.destroy();
            this.initHlsjs(e);
        }
        preload(e) {
            if (e.preload === "metadata") {
                this.maxBufferLength = MetaBufferLength;
            }
            this.load(e);
        }
        load(e) {
            const { hlsjs: t, video: i, src: r } = this;
            if (!t) {
                return;
            }
            const n = e.sources[0].file;
            const a = n.url && typeof n.url == "string" ? n.url : n;
            if (r === a && this.videoSrc === i.src) {
                this.maxBufferLength = MaxBufferLength;
                return;
            }
            let s = e.starttime || -1;
            if (s < -1) {
                s = this.lastPosition;
            }
            this.initHlsjs(e);
            this.currentJwItem = e;
            this.src = a;
            this.videoHeight = 0;
            this._eventsOn();
            t.config.startPosition = s;
            t.loadSource(a);
            t.attachMedia(i);
            this.videoSrc = i.src;
        }
        restartStream(e) {
            const t = Object.assign({}, this.currentJwItem);
            if (e) {
                t.starttime = e;
            } else {
                delete t.starttime;
            }
            this.src = null;
            this._clearNonNativeCues();
            this.clearMetaCues();
            this.clearTracks();
            this.init(t);
            this.load(t);
            delete t.starttime;
        }
        play() {
            if (this.isLiveStreamUnloaded) {
                this.isLiveStreamUnloaded = false;
                this.restartStream();
            }
            return this.video.play() || (0, createPlayPromise)(this.video);
        }
        pause() {
            this.stopConnectionTimeout();
            if (
                this.live &&
                this.streamType === "LIVE" &&
                !this.isLiveStreamUnloaded
            ) {
                this.unloadLiveStream();
            }
            this.video.pause();
        }
        unloadLiveStream() {
            if (this.hlsjs) {
                this.isLiveStreamUnloaded = true;
                this.hlsjs.stopLoad();
                this.stopStaleTimeout();
            }
        }
        stop() {
            this.clearTracks();
            if (this.hlsjs) {
                this._eventsOff();
                this.hlsjs.stopLoad();
            }
            this.pause();
            this.setState(STATE_IDLE);
        }
        seek(e) {
            const t = this.getDuration();
            if (!t || t === Infinity || (0, isNaN)(t)) {
                return;
            }
            this.stopStaleTimeout();
            this.stopConnectionTimeout();
            let i = this.dvrEnd && e < 0 ? this.dvrEnd + e : e;
            const r = this.getSeekRange();
            if (
                this.streamType === "DVR" &&
                this.dvrEnd !== null &&
                ((this.dvrPosition = i - this.dvrEnd), e < 0)
            ) {
                i += Math.min(12, ((0, now)() - this.dvrUpdatedTime) / 1000);
            }
            this.seeking = true;
            const a = this.video.currentTime;
            this.trigger(MEDIA_SEEK, {
                position: this.getCurrentTime(),
                offset: i,
                duration: t,
                currentTime: a,
                seekRange: r,
                metadata: {
                    currentTime: a,
                },
            });
            this.video.currentTime = i;
            const s = this.video.currentTime;
            const o = {
                position: this.getCurrentTime(),
                duration: t,
                currentTime: s,
                seekRange: r,
                metadata: {
                    currentTime: s,
                },
            };
            this.trigger("time", o);
        }
        getCurrentQuality() {
            let e = 0;
            if (this.hlsjs && !this.hlsjs.autoLevelEnabled) {
                e = d(this.hlsjs.manualLevel, this.jwLevels);
            }
            return e;
        }
        getQualityLevels() {
            return (0, map)(this.jwLevels, (e) => (0, qualityLevel)(e));
        }
        getCurrentAudioTrack() {
            if ((0, isNumber)(this.currentAudioTrackIndex)) {
                return this.currentAudioTrackIndex;
            } else {
                return -1;
            }
        }
        getAudioTracks() {
            return this.audioTracks || [];
        }
        getCurrentTime() {
            if (this.live && this.streamType === "DVR") {
                if (!this.dvrPosition) {
                    this.updateDvrPosition(this.getSeekRange());
                }
                return this.dvrPosition;
            } else {
                return this.video.currentTime;
            }
        }
        getDuration() {
            if (this.live && this.currentJwItem) {
                const e = this.levelDuration;
                const t = this.currentJwItem.minDvrWindow;
                if ((0, isDvr)(e, t)) {
                    this.streamType = "DVR";
                    return -e;
                } else {
                    this.streamType = "LIVE";
                    return Infinity;
                }
            }
            this.streamType = "VOD";
            return this.video.duration;
        }
        getCurrentHlsjsLevel() {
            let e = 0;
            const { hlsjs: t } = this;
            if (t) {
                e =
                    t.streamController.loadedmetadata && t.currentLevel > 0
                        ? t.currentLevel
                        : t.firstLevel;
            }
            return e;
        }
        getName() {
            return {
                name: "hlsjs",
            };
        }
        getPlaybackRate() {
            return this.video.playbackRate;
        }
        getSeekRange() {
            const { levelDuration: e, video: t } = this;
            const { seekable: i, duration: r } = t;
            const a = i.length ? Math.max(i.end(0), i.end(i.length - 1)) : r;
            if ((0, isNaN)(r)) {
                return {
                    start: 0,
                    end: 0,
                };
            } else {
                return {
                    start: Math.max(0, a - e),
                    end: a,
                };
            }
        }
        getBandwidthEstimate() {
            const { hlsjs: e } = this;
            if (e) {
                return e.bandwidthEstimate;
            } else {
                return null;
            }
        }
        getLiveLatency() {
            let e = null;
            if (this.live && this.liveEdgePosition !== null) {
                const t = (0, now)();
                e =
                    this.liveEdgePosition +
                    (t - this.liveEdgeUpdated) / 1000 -
                    this.video.currentTime;
                const i = this.lastProgramDateTime;
                if (i) {
                    const r =
                        t / 1000 -
                        (i / 1000 +
                            (this.video.currentTime -
                                this.programDateSyncTime)) -
                        e;
                    if (r > 0 && r < 10) {
                        e += r;
                    }
                }
            }
            return e;
        }
        getTargetLatency() {
            return (this.hlsjs && this.hlsjs.targetLatency) || null;
        }
        setCurrentQuality(e) {
            if (e < 0) {
                return;
            }
            const t = ((e, t) => {
                let i = -1;
                if (e > -1 && t[e]) {
                    i = t[e].hlsjsIndex;
                }
                return i;
            })(e, this.jwLevels);
            this.hlsjs.nextLevel = t;
            this.trigger(MEDIA_LEVEL_CHANGED, {
                levels: this.jwLevels,
                currentQuality: e,
            });
            this.bitrateSelection = this.jwLevels[e].bitrate;
        }
        setCurrentAudioTrack(e) {
            const t = this.getCurrentHlsjsLevel();
            const i = this.hlsjs.levels[t];
            const r = d(t, this.jwLevels);
            if (!this.jwLevels || !this.jwLevels[r] || !i) {
                return;
            }
            if (
                !this.audioTracksArray ||
                !(0, size)(this.audioTracksArray) ||
                !(0, isNumber)(e)
            ) {
                return;
            }
            let a = (this.audioTracks = this.audioTracksArray);
            if (
                !a ||
                !(0, size)(a) ||
                !a[e] ||
                this.currentAudioTrackIndex === e
            ) {
                return;
            }
            this.trigger(AUDIO_TRACKS, {
                tracks: a,
                currentTrack: e,
            });
            a = this.audioTracks;
            let s = a[e];
            if (
                this.currentAudioTrackIndex !== null &&
                s.hlsjsIndex !== this.hlsjs.audioTrack
            ) {
                this.trigger(AUDIO_TRACK_CHANGED, {
                    tracks: a,
                    currentTrack: e,
                });
                s = this.audioTracks[e];
            }
            this.currentAudioTrackIndex = e;
            if (s.hlsjsIndex !== this.hlsjs.audioTrack) {
                this.hlsjs.audioTrack = s.hlsjsIndex;
            }
        }
        updateAudioTrack(e) {
            if (!this.hlsjs || !this.hlsjs.audioTracks.length) {
                return;
            }
            let t = this.currentAudioTrackIndex;
            if ((0, isNumber)(t)) {
                if (
                    !this.audioTracks ||
                    this.audioTracks[t].hlsjsIndex !== this.hlsjs.audioTrack
                ) {
                    this.currentAudioTrackIndex = null;
                }
            } else {
                t = this.audioTracksArray
                    ? ((e = []) =>
                          Math.max(
                              (0, indexOf)(
                                  e,
                                  (0, find)(e, (e) => e.defaulttrack)
                              ),
                              0
                          ))(this.audioTracksArray)
                    : 0;
            }
            this.setCurrentAudioTrack(t);
        }
        updateDvrPosition(e) {
            this.dvrPosition = this.video.currentTime - e.end;
            this.dvrEnd = e.end;
            this.dvrUpdatedTime = (0, now)();
        }
        setCurrentSubtitleTrack(e) {
            this.hlsjs.subtitleTrack = e;
        }
        setPlaybackRate(e) {
            this.video.playbackRate = this.video.defaultPlaybackRate = e;
        }
        get maxBufferLength() {
            if (this.hlsjs) {
                return this.hlsjs.config.maxMaxBufferLength;
            } else {
                return NaN;
            }
        }
        set maxBufferLength(e) {
            if (this.hlsjs) {
                this.hlsjs.config.maxMaxBufferLength = e;
            }
        }
        isLive() {
            return this.live;
        }
        checkAdaptation(e) {
            const { levels: t, autoLevelEnabled: i } = this.hlsjs;
            const r = t[e];
            if (!r) {
                return;
            }
            let { width: n, height: a, bitrate: s } = r;
            n = n || this.video.videoWidth;
            a = a || this.video.videoHeight;
            if (a === this.videoHeight && s === this.streamBitrate) {
                return;
            }
            const l = d(e, this.jwLevels);
            let u = "api";
            if (
                (this.streamBitrate !== -1 && this.streamBitrate) ||
                this.videoHeight
            ) {
                if (i) {
                    u = "auto";
                }
            } else {
                u = "initial choice";
            }
            this.videoHeight = a;
            this.streamBitrate = s;
            const h = i ? "auto" : "manual";
            const c = i && t.length > 1 ? "auto" : this.jwLevels[l].label;
            const f = () => {
                this.trigger(MEDIA_VISUAL_QUALITY, {
                    reason: u,
                    mode: h,
                    level: {
                        bitrate: s,
                        index: l,
                        label: c,
                        width: n,
                        height: a,
                    },
                });
            };
            if (Browser.ie) {
                this.once("time", f, this);
            } else {
                f();
            }
        }
        createVideoListeners() {
            const e = {
                waiting: () => {
                    this.startConnectionTimeout();
                    if (this.seeking) {
                        this.setState(STATE_LOADING);
                    } else if (this.state === STATE_PLAYING) {
                        if (this.atEdgeOfLiveStream()) {
                            this.setPlaybackRate(1);
                        }
                        this.stallTime = this.video.currentTime;
                        this.setState(STATE_STALLED);
                    }
                },
            };
            Object.keys(VideoListenerMixin).forEach((t) => {
                const i = VideoListenerMixin[t];
                if (t === "playing") {
                    e[t] = function () {
                        const e = this.getCurrentHlsjsLevel();
                        this.checkAdaptation(e);
                        i.call(this);
                    }.bind(this);
                } else if (t === "ended") {
                    e[t] = function () {
                        this.videoHeight = 0;
                        this.streamBitrate = -1;
                        i.call(this);
                    }.bind(this);
                } else if (t !== "error") {
                    e[t] = i.bind(this);
                }
            });
            return e;
        }
        createHlsjsListeners() {
            const e = {};
            e[t] = () => {
                if (this.recoveringMediaError) {
                    this.hlsjs.startLoad();
                    this.recoveringMediaError = false;
                    this.resetRecovery();
                    this.stopStaleTimeout();
                    this.stopConnectionTimeout();
                }
            };
            e[i] = () => {
                this._clearNonNativeCues();
            };
            e[r] = (e, t) => {
                const { levels: i } = t;
                const r = this.hlsjs;
                const { bitrateSelection: a, jwConfig: s } = this;
                let o = -1;
                let l = -1;
                this.currentHlsjsLevel = null;
                this.jwLevels = u(i, s.qualityLabels);
                if (
                    this.capLevels &&
                    (this.playerWidth || this.playerHeight) &&
                    this.playerStretching
                ) {
                    const e = h(
                        i,
                        this.playerWidth,
                        this.playerHeight,
                        t.firstLevel + 1
                    );
                    if (r.levelController.firstLevel !== e) {
                        r.firstLevel = e;
                    }
                    this.resize(
                        this.playerWidth,
                        this.playerHeight,
                        this.playerStretching
                    );
                }
                if ((0, isValidNumber)(a)) {
                    o = ((e, t) => {
                        if (!t) {
                            return -1;
                        }
                        let i = Number.MAX_VALUE;
                        let r = -1;
                        for (let n = 0; n < e.length; n++) {
                            const a = e[n];
                            if (!a.bitrate) {
                                continue;
                            }
                            const s = Math.abs(t - a.bitrate);
                            if (s <= i) {
                                i = s;
                                r = n;
                            }
                            if (!s) {
                                break;
                            }
                        }
                        return r;
                    })(i, a);
                    l = o;
                }
                r.startLevel = o;
                r.nextLevel = l;
                r.startLoad(r.config.startPosition);
                this.trigger(MEDIA_LEVELS, {
                    levels: this.jwLevels,
                    currentQuality: d(o, this.jwLevels),
                });
            };
            e[s] = (e, t) => {
                const { endSN: i, live: r, targetduration: n } = t.details;
                this.checkStaleManifest(i, r, n);
            };
            e[c] = (e, t) => {
                const { live: i, totalduration: r } = t.details;
                this.live = i;
                this.levelDuration = r;
                const n = this.getSeekRange();
                const a =
                    this.dvrEnd !== null && Math.abs(this.dvrEnd - n.end) > 1;
                if (this.streamType === "DVR" && a) {
                    this.updateDvrPosition(n);
                }
                if (i && this.state === STATE_IDLE) {
                    this.unloadLiveStream();
                }
            };
            e[f] = (e, t) => {
                const { fragments: i, totalduration: r } = t.details;
                this.levelDuration = r;
                if (i.length) {
                    const e = i[i.length - 1];
                    if (e.sn !== this.liveEdgeSn) {
                        this.liveEdgeUpdated = (0, now)();
                        this.liveEdgeSn = e.sn;
                        this.liveEdgePosition = e.start + e.duration;
                    }
                }
            };
            e[m] = (e, t) => {
                const { level: i } = t;
                if (i !== this.currentHlsjsLevel) {
                    this.setCurrentLevel(i);
                } else {
                    this.checkAdaptation(i);
                }
            };
            e[v] = (e, t) => {
                this.lastProgramDateTime = t.frag.programDateTime;
                this.programDateSyncTime = t.frag.start;
                if (this.lastProgramDateTime && !this.startDateTime) {
                    this.startDateTime = this.lastProgramDateTime;
                    this.trigger(ABSOLUTE_POSITION_READY, {
                        ready: true,
                        startDateTime: this.startDateTime,
                    });
                }
            };
            e[g] = (e, t) => {
                this.lastProgramDateTime = t.frag.programDateTime;
                this.programDateSyncTime = t.frag.start;
            };
            e[y] = (e, t) => {
                if (t.samples) {
                    if ([].some.call(this.video.textTracks, (e) => !e.inuse)) {
                        this.setTextTracks(this.video.textTracks);
                    }
                    if (t != null && t.samples) {
                        t.samples.forEach((e) => {
                            this.trigger(MEDIA_META, {
                                metadataType: "dai-hls",
                                metadata: {
                                    messageData: e.data,
                                    start: e.pts,
                                    type: "ID3",
                                },
                            });
                        });
                    }
                }
            };
            e[E] = () => {
                if (this.connectionTimeout !== -1) {
                    this.stopConnectionTimeout();
                }
                if (!this.atEdgeOfLiveStream()) {
                    this.stopStaleTimeout();
                }
                if (this.recoveringNetworkError) {
                    this.resetRecovery();
                    this.recoveringNetworkError = false;
                }
            };
            e[S] = (e, t) => {
                if (t.audio && this.videoFound) {
                    return;
                }
                const i = t.audiovideo || t.video ? "video" : "audio";
                this.videoFound = this.videoFound || i === "video";
                this.trigger(MEDIA_TYPE, {
                    mediaType: i,
                });
            };
            e[I] = (e, t) => {
                const i = t.frag;
                (i.tagList || []).forEach(([e, t]) =>
                    this.processPlaylistMetadata(e, t, i)
                );
            };
            e[D] = (e, t) => {
                const { frag: i, initPTS: r } = t;
                this.processPlaylistMetadata("DISCONTINUITY", r, i);
            };
            if (!this.renderNatively) {
                e[_] = (e, t) => {
                    this.addTextTracks(t.tracks);
                };
                e[C] = (e, t) => {
                    var i;
                    if (t != null && (i = t.cues) != null && i.length) {
                        let e;
                        const i = !(t.cues[0] instanceof VTTCue);
                        t.cues.forEach((r) => {
                            if (i) {
                                const e = r;
                                (r = new VTTCue(
                                    e.startTime,
                                    e.endTime,
                                    e.text
                                )).position = e.position;
                            }
                            e ||= t.cues.filter(
                                (e) => e.startTime === r.startTime
                            ).length;
                            r.align = "center";
                            r.line = 90 - e * 5;
                            r.position = 50;
                            this.addVTTCue({
                                type: t.type,
                                cue: r,
                                track: t.track,
                            });
                            e--;
                        });
                    }
                };
            }
            e[P] = (e, t) => {
                const { audioTracks: i } = t;
                const r = this.hlsjs.levels;
                const a = this.getCurrentHlsjsLevel();
                if (i != null && i.length) {
                    this.audioTracksArray = ((e) =>
                        (0, reduce)(
                            e,
                            (e, t, i) => {
                                e.push({
                                    autoselect: t.autoselect,
                                    defaulttrack: t.default,
                                    groupid: t.groupId,
                                    language: t.lang,
                                    name: t.name,
                                    hlsjsIndex: i,
                                });
                                return e;
                            },
                            []
                        ))(i);
                    this.jwLevels.forEach((e) => {
                        const t = e.hlsjsIndex > 0 ? r[e.hlsjsIndex] : null;
                        if (t) {
                            e.audioGroupId = l(t);
                        }
                    });
                    this.updateAudioTrack(r[a]);
                }
            };
            e[Y] = (e, t) => {
                const i = this.hlsjs;
                const r = X(t);
                const { type: n } = t;
                const { key: a } = r;
                let s;
                p(t);
                if (this.streamType === "DVR" && n === q) {
                    const e = this.getSeekRange();
                    this.updateDvrPosition(e);
                }
                if (
                    r.code === 232403 &&
                    this.retryCount < this.maxRetries &&
                    /jwpsrv.com\/.*\?token=/.test(t.url)
                ) {
                    r.suppressLevel = false;
                    r.recoverable = true;
                    r.fatal = true;
                    s = true;
                    this.maxRetries = 1;
                }
                if (r.suppressLevel) {
                    const e = i.levels;
                    const n = t.context || t;
                    const { level: s } = n;
                    const o = e[s];
                    if (o && Array.isArray(o.url) && o.url.length === 1) {
                        i.removeLevel(s, 0);
                        if (!i.levels.length) {
                            this.handleError(r.code, t, a);
                            return;
                        }
                        r.fatal = false;
                        this.jwLevels = u(
                            i.levels,
                            this.jwConfig.qualityLabels
                        );
                        if (
                            this.playerWidth &&
                            this.playerHeight &&
                            this.playerStretching
                        ) {
                            this.resize(
                                this.playerWidth,
                                this.playerHeight,
                                this.playerStretching
                            );
                        }
                        i.loadLevel = 0;
                        i.currentLevel = -1;
                        this.trigger(MEDIA_LEVELS, {
                            levels: this.jwLevels,
                            currentQuality: 0,
                        });
                    }
                }
                if (r.fatal) {
                    const e = (0, now)();
                    const o = r.recoverable && (n === q || n === W);
                    const l = this.retryCount;
                    if (!o || !(l < this.maxRetries)) {
                        i.stopLoad();
                        this.handleError(r.code, t, a);
                        return;
                    }
                    if (
                        !this.lastRecoveryTime ||
                        e >= this.lastRecoveryTime + this.recoveryInterval
                    ) {
                        p("Attempting to recover, retry count:", l);
                        if (n === q) {
                            if (/^manifest/.test(t.details) || s) {
                                this.recoverManifestError();
                                this.retryCount = l;
                            } else {
                                i.startLoad();
                            }
                        } else if (n === W) {
                            if (t.details === "bufferAppendError") {
                                p(
                                    "Encountered a bufferAppendError in hls not attempting to recover media and destroying instance"
                                );
                                i.destroy();
                            } else {
                                this.recoveringMediaError = true;
                                i.recoverMediaError();
                            }
                        }
                        this.recoveringNetworkError = true;
                        this.retryCount += 1;
                        this.lastRecoveryTime = e;
                    }
                }
                this.trigger(
                    WARNING,
                    new PlayerError(null, r.code + 100000, t)
                );
            };
            return e;
        }
        resize(e, t, i) {
            this.playerWidth = e;
            this.playerHeight = t;
            this.playerStretching = i;
            if (this.capLevels) {
                const e = this.hlsjs;
                if (e != null && e.levels) {
                    const t = e.autoLevelCapping;
                    const i = h(e.levels, this.playerWidth, this.playerHeight);
                    if (i !== t) {
                        e.autoLevelCapping = i;
                        if (
                            i > t &&
                            t !== -1 &&
                            this.state !== STATE_IDLE &&
                            this.state !== STATE_COMPLETE
                        ) {
                            e.streamController.nextLevelSwitch();
                        }
                    }
                }
            }
        }
        recoverManifestError() {
            const { currentTime: e, paused: t } = this.video;
            if (e || !t) {
                this.restartStream(e);
                if (!t) {
                    this.play().catch(() => {});
                }
            } else {
                this.hlsjs.stopLoad();
                this.hlsjs.loadSource(this.src);
            }
        }
        _eventsOn() {
            const { bandwidthMonitor: e, eventHandler: t, video: i } = this;
            if (t) {
                t.on();
            }
            e.start();
            (0, H.Nm)(this, i);
        }
        _eventsOff() {
            const {
                bandwidthMonitor: e,
                eventHandler: t,
                hlsjs: i,
                video: r,
            } = this;
            if (i && t) {
                this.disableTextTrack();
                this.lastPosition = this.video.currentTime;
                i.detachMedia();
                t.off();
            }
            this.off(null, null, this);
            e.stop();
            this.resetLifecycleVariables();
            (0, H.IP)(r);
        }
        handleError(e, t, i) {
            this.resetLifecycleVariables();
            this.trigger(MEDIA_ERROR, new PlayerError(i, e, t));
        }
        destroy() {
            if (this.hlsjs) {
                this._eventsOff();
                this.hlsjs.destroy();
                this.hlsjs = null;
                this.hlsjsOptions = null;
            }
        }
        restoreVideoProperties() {
            if (this.savedVideoProperties) {
                this.volume(this.jwConfig.volume);
                this.mute(this.jwConfig.mute);
                this.savedVideoProperties = false;
            }
        }
        checkStaleManifest(e, t, i) {
            const r =
                this.jwConfig.liveTimeout !== null
                    ? this.jwConfig.liveTimeout * 1000
                    : this.staleManifestDurationMultiplier * i;
            if (t && this.lastEndSn === e && r !== 0) {
                if (this.staleManifestTimeout === -1) {
                    this.staleManifestTimeout = window.setTimeout(() => {
                        this.checkStreamEnded();
                    }, r);
                }
            } else {
                this.stopStaleTimeout();
            }
            this.lastEndSn = e;
            this.live = t;
        }
        checkStreamEnded() {
            if (this.hlsjs && (this.video.ended || this.atEdgeOfLiveStream())) {
                this.hlsjs.stopLoad();
                this.handleError(
                    k.ERROR_LIVE_STREAM_DOWN_OR_ENDED,
                    null,
                    MSG_LIVE_STREAM_DOWN
                );
            }
        }
        setCurrentLevel(e) {
            this.currentHlsjsLevel = e;
            this.checkAdaptation(e);
            this.updateAudioTrack(this.hlsjs.levels[e]);
        }
        _clearNonNativeCues() {
            if (!this.renderNatively && this._textTracks) {
                this._textTracks.forEach((e) => {
                    this.clearCueData(e._id);
                });
            }
        }
        static setEdition(e) {
            A.supports = (0, U.Z)(e);
        }
    };
})(Hls);
export default class q extends W {
    getName() {
        return {
            name: "hlsjs",
        };
    }
    static getName() {
        return {
            name: "hlsjs",
        };
    }
}
