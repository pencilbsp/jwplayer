import { now } from "../utils/date";
import Tracks from "./tracks-mixin";
import { Helpers } from "./utils/helpers";
import Events from "utils/backbone.events";
import { isDvr } from "./utils/stream-type";
import ApiSettings from "../api/api-settings";
import * as VideoEvents from "../events/events";
import VTTCue from "../parsers/captions/vttcue";
import { qualityLevel } from "./data-normalizer";
import BandwidthMonitor from "./bandwidth-monitor";
import { getLiveSyncDuration } from "../api/config";
import VideoActionsMixin from "./video-actions-mixin";
import { Browser, OS } from "../environment/environment";
import VideoAttachedMixin from "./video-attached-mixin";
import VideoListenerMixin from "./video-listener-mixin";
import { parseMetadataTag } from "./utils/hlsmetaparser";
import parseNetworkError from "./utils/network-error-parser";
import { MaxBufferLength, MetaBufferLength } from "./constants";
import { generateLabel, hasRedundantLevels } from "./utils/quality-labels";
import HlsJs, { ErrorTypes, Events as HlsEvents, ErrorDetails } from "hls.js";
import {
    map,
    find,
    each,
    pick,
    size,
    isNaN,
    reduce,
    matches,
    indexOf,
    isFinite,
    isNumber,
    isValidNumber,
} from "../utils/underscore";
import {
    toggleNativeFullscreen,
    detachNativeFullscreenListeners,
    attachNativeFullscreenListeners,
} from "./utils/native-fullscreen";
import {
    PlayerError,
    MSG_BAD_CONNECTION,
    MSG_CANT_PLAY_VIDEO,
    MSG_LIVE_STREAM_DOWN,
    MSG_CANT_PLAY_IN_BROWSER,
} from "../api/errors";

const HLS_ERROR = {
    230000: "BASE_ERROR",
    230001: "ERROR_LIVE_STREAM_DOWN_OR_ENDED",
    230002: "ERROR_CONNECTION_LOST",
    232002: "MANIFEST_ERROR_CONNECTION_LOST",
    232403: "PROTECTED_CONTENT_ACCESS_ERROR",
    232600: "MANIFEST_PARSING_ERROR",
    232631: "LEVEL_EMPTY_ERROR",
    232632: "MANIFEST_INCOMPATIBLE_CODECS_ERROR",
    233600: "FRAG_PARSING_ERROR",
    233650: "FRAG_DECRYPT_ERROR",
    234001: "BUFFER_STALLED_ERROR",
    234002: "BUFFER_APPEND_ERROR",
    BASE_ERROR: 230000,
    BUFFER_APPEND_ERROR: 234002,
    BUFFER_STALLED_ERROR: 234001,
    ERROR_CONNECTION_LOST: 230002,
    ERROR_LIVE_STREAM_DOWN_OR_ENDED: 230001,
    FRAG_DECRYPT_ERROR: 233650,
    FRAG_PARSING_ERROR: 233600,
    LEVEL_EMPTY_ERROR: 232631,
    MANIFEST_ERROR_CONNECTION_LOST: 232002,
    MANIFEST_INCOMPATIBLE_CODECS_ERROR: 232632,
    MANIFEST_PARSING_ERROR: 232600,
    PROTECTED_CONTENT_ACCESS_ERROR: 232403,
};

const NETWORK_ERRORS = [
    ErrorDetails.MANIFEST_LOAD_ERROR,
    ErrorDetails.MANIFEST_LOAD_TIMEOUT,
    ErrorDetails.MANIFEST_PARSING_ERROR,
    ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
    ErrorDetails.LEVEL_LOAD_ERROR,
    ErrorDetails.LEVEL_LOAD_TIMEOUT,
    ErrorDetails.FRAG_LOAD_ERROR,
    ErrorDetails.FRAG_LOAD_TIMEOUT,
];

const STALL_ERRORS = [
    ErrorDetails.BUFFER_STALLED_ERROR,
    ErrorDetails.BUFFER_SEEK_OVER_HOLE,
    ErrorDetails.BUFFER_NUDGE_ON_STALL,
];

const SUPPRESS_LEVEL_ERRORS = [
    ErrorDetails.LEVEL_EMPTY_ERROR,
    ErrorDetails.LEVEL_LOAD_ERROR,
    ErrorDetails.LEVEL_LOAD_TIMEOUT,
];

class _BaseProvider extends Events {}
Object.assign(_BaseProvider.prototype, VideoActionsMixin, VideoAttachedMixin, Tracks);

const BaseProvider = _BaseProvider;

// Logger con cho HLS.js provider
const hlsLogger = Helpers.logger.child("providers/hlsjs");
// Hàm helper bind log method theo tên
const bindLogMethod = (methodName) => hlsLogger[methodName].bind(hlsLogger);
// Tạo các alias log tiện dụng
const logLog = bindLogMethod("log");
const logInfo = bindLogMethod("info");
const logWarn = bindLogMethod("warn");
const logDebug = bindLogMethod("debug");
const logeError = bindLogMethod("error");

const getAudioGroupId = (e) => (e.audioGroupIds ? e.audioGroupIds[e._urlId || e.urlId] : undefined);

const mapHlsLevelsToJwLevels = (hlsLevels, qualityLabels) => {
    // Kiểm tra xem manifest có nhiều level bị trùng (ví dụ cùng height, bitrate)
    const hasDuplicates = hasRedundantLevels(hlsLevels);

    // Chuyển đổi danh sách level HLS thành danh sách level JW
    const jwLevels = hlsLevels.map((level, index) => ({
        label: generateLabel(level, qualityLabels, hasDuplicates),
        level_id: level.id,
        hlsjsIndex: index,
        bitrate: level.bitrate,
        height: level.height,
        width: level.width,
        audioGroupId: getAudioGroupId(level),
    }));

    // Sắp xếp level theo chiều cao (height) giảm dần, nếu trùng height thì so bitrate
    jwLevels.sort((a, b) =>
        a.height && b.height && a.height !== b.height ? b.height - a.height : (b.bitrate || 0) - (a.bitrate || 0)
    );

    // Thêm tùy chọn “Auto” nếu có nhiều hơn 1 level
    if (jwLevels.length > 1) {
        jwLevels.unshift({
            label: "Auto",
            level_id: "auto",
            hlsjsIndex: -1,
        });
    }

    return jwLevels;
};

const findQualityLevelIndex = (hlsjsLevelIndex, jwLevels) => {
    return Math.max(
        0,
        indexOf(
            jwLevels,
            find(jwLevels, (level) => level.hlsjsIndex === hlsjsLevelIndex)
        )
    );
};

/**
 * Tạo config cuối cùng cho Hls.js từ JW config + Media Item.
 */
function buildHlsjsConfig(options) {
    const { withCredentials, aesToken, renderTextTracksNatively, onXhrOpen, liveSyncDuration, hlsjsConfig, cmcd } =
        options;

    // Lấy hlsjsConfig từ JW config và loại bỏ các key không cần thiết
    const filteredConfig = pick(hlsjsConfig || {}, [
        "drmSystems",
        "liveSyncDuration",
        "liveSyncDurationCount",
        "liveMaxLatencyDuration",
        "liveMaxLatencyDurationCount",
        "liveBackBufferLength",
        "backBufferLength",
        "loader",
        "pLoader",
        "fLoader",
        "fragLoadingMaxRetry",
        "fragLoadingRetryDelay",
        "enableWorker",
        "debug",
    ]);

    // Default config cho JW Player
    const defaultConfig = {
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
        debug: ApiSettings.debug && {
            log: logLog,
            info: logInfo,
            warn: logWarn,
            debug: logDebug,
            error: logeError,
        },
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 4000,
        maxMaxBufferLength: MaxBufferLength,
        renderTextTracksNatively,
        startLevel: -1,
        testBandwidth: false,
    };

    // Gắn CMCD nếu có
    if (cmcd) {
        defaultConfig.cmcd = {
            sessionId: cmcd.sessionId,
            contentId: cmcd.contentId,
            useHeaders: cmcd.useHeaders,
        };
    }

    // Giải nén liveSync params từ filteredConfig
    const { liveSyncDurationCount, liveMaxLatencyDurationCount, liveMaxLatencyDuration } = filteredConfig;

    // ✅ Ưu tiên count-based hoặc duration-based sync
    if (liveSyncDurationCount !== undefined || liveMaxLatencyDurationCount !== undefined) {
        filteredConfig.liveSyncDuration = filteredConfig.liveMaxLatencyDuration = undefined;
        filteredConfig.liveSyncDurationCount = isFinite(liveSyncDurationCount) ? liveSyncDurationCount : Infinity;
        filteredConfig.liveMaxLatencyDurationCount = isFinite(liveMaxLatencyDurationCount)
            ? liveMaxLatencyDurationCount
            : Infinity;
    } else if (liveSyncDuration !== undefined || liveMaxLatencyDuration !== undefined) {
        filteredConfig.liveSyncDurationCount = filteredConfig.liveMaxLatencyDurationCount = undefined;
        defaultConfig.liveSyncDuration = getLiveSyncDuration(liveSyncDuration);
        filteredConfig.liveMaxLatencyDuration = isFinite(liveMaxLatencyDuration) ? liveMaxLatencyDuration : Infinity;
    }

    // ✅ Nếu có credentials, token hoặc xhr handler → tạo xhrSetup & fetchSetup
    if (withCredentials || aesToken || onXhrOpen) {
        return Object.assign(
            {},
            defaultConfig,
            createRequestSetup(withCredentials, aesToken, onXhrOpen),
            filteredConfig
        );
    }

    return Object.assign({}, defaultConfig, filteredConfig);
}

/**
 * Tạo các hàm xhrSetup và fetchSetup cho Hls.js
 */
function createRequestSetup(withCredentials, aesToken, onXhrOpen) {
    return {
        xhrSetup(xhr, url) {
            if (withCredentials) {
                xhr.withCredentials = true;
            }
            if (aesToken) {
                const separator = url.indexOf("?") > 0 ? "&token=" : "?token=";
                xhr.open("GET", url + separator + aesToken, true);
            }
            if (typeof onXhrOpen === "function") {
                onXhrOpen(xhr, url);
            }
        },
        fetchSetup(requestInfo, init) {
            if (aesToken) {
                const separator = requestInfo.url.indexOf("?") > 0 ? "&token=" : "?token=";
                requestInfo.url = requestInfo.url + separator + aesToken;
            }
            if (withCredentials) {
                init.credentials = "include";
            }
            return new Request(requestInfo.url, init);
        },
    };
}

/**
 * Tìm cấp độ (level) chất lượng phù hợp nhất dựa trên kích thước player.
 */
const getMaxLevelBySize = (levels, playerWidth, playerHeight, maxCheck = levels.length) => {
    let nextLevel;
    // Lấy device pixel ratio (mặc định 1 nếu không có)
    const pixelRatio = (() => {
        try {
            return window.devicePixelRatio;
        } catch (e) {
            return 1;
        }
    })();

    // Điều chỉnh kích thước theo mật độ pixel
    playerWidth *= pixelRatio;
    playerHeight *= pixelRatio;

    // Nếu chạy trên Tizen, bỏ qua giới hạn (luôn chọn max)
    if (OS.tizen) {
        playerWidth = Infinity;
        playerHeight = Infinity;
    }

    // Lặp qua các level để tìm level đầu tiên thỏa điều kiện
    for (let index = 0; index < maxCheck; index++) {
        const currentLevel = levels[index];

        if (
            (currentLevel.width >= playerWidth || currentLevel.height >= playerHeight) &&
            ((nextLevel = levels[index + 1]),
            !nextLevel || currentLevel.width !== nextLevel.width || currentLevel.height !== nextLevel.height)
        ) {
            return index;
        }
    }

    // Nếu không tìm thấy, trả về level cuối cùng
    return maxCheck - 1;
};

const getConfigValue = (mediaItem, jwConfig, key) => {
    const primarySource = mediaItem.sources[0];

    if (primarySource[key] !== undefined) {
        return primarySource[key];
    } else if (mediaItem[key] !== undefined) {
        return mediaItem[key];
    } else {
        return jwConfig[key];
    }
};

const getErrorOffset = (errorDetail) => {
    if (!errorDetail) return 0;

    if (/^frag/.test(errorDetail)) {
        return 2000; // lỗi fragment
    }
    if (/^(manifest|level|audioTrack)/.test(errorDetail)) {
        return 1000; // lỗi manifest hoặc level
    }
    if (/^key/.test(errorDetail)) {
        return 4000; // lỗi DRM key
    }

    return 0;
};

function parseError(error) {
    const { details, response, type } = error;

    let isFatal = error.fatal;
    let isRecoverable = NETWORK_ERRORS.indexOf(details) < 0;
    const isStalling = STALL_ERRORS.includes(details);
    let suppressLevel = SUPPRESS_LEVEL_ERRORS.includes(details);

    let errorKey = MSG_CANT_PLAY_VIDEO;
    let errorCode = HLS_ERROR.BASE_ERROR;

    switch (details) {
        case ErrorDetails.MANIFEST_PARSING_ERROR:
            errorCode = HLS_ERROR.MANIFEST_PARSING_ERROR;
            break;
        case ErrorDetails.LEVEL_EMPTY_ERROR:
            errorCode = HLS_ERROR.LEVEL_EMPTY_ERROR;
            break;
        case ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR:
            errorKey = MSG_CANT_PLAY_IN_BROWSER;
            errorCode = HLS_ERROR.MANIFEST_INCOMPATIBLE_CODECS_ERROR;
            break;
        case ErrorDetails.FRAG_PARSING_ERROR:
            errorCode = HLS_ERROR.FRAG_PARSING_ERROR;
            break;
        case ErrorDetails.FRAG_DECRYPT_ERROR:
            errorCode = HLS_ERROR.FRAG_DECRYPT_ERROR;
            break;
        case ErrorDetails.BUFFER_STALLED_ERROR:
            errorCode = HLS_ERROR.BUFFER_STALLED_ERROR;
            break;
        case ErrorDetails.BUFFER_APPEND_ERROR:
            errorCode = HLS_ERROR.BUFFER_APPEND_ERROR;
            break;
        case ErrorDetails.INTERNAL_EXCEPTION:
            errorCode = 239000;
            break;
        default:
            if (type === ErrorTypes.NETWORK_ERROR) {
                if (navigator.onLine === false) {
                    // Mất kết nối hoàn toàn
                    isRecoverable = false;
                    isFatal = details === "manifestLoadError";
                    suppressLevel = false;
                    errorCode = isFatal ? HLS_ERROR.MANIFEST_ERROR_CONNECTION_LOST : HLS_ERROR.ERROR_CONNECTION_LOST;
                    errorKey = MSG_BAD_CONNECTION;
                } else if (/TimeOut$/.test(details)) {
                    // Timeout
                    errorCode = HLS_ERROR.BASE_ERROR + 1001 + getErrorOffset(details);
                } else if (response) {
                    // Network error khác
                    ({ code: errorCode, key: errorKey } = parseNetworkError(
                        HLS_ERROR.BASE_ERROR,
                        response.code,
                        error.url
                    ));
                    errorCode += getErrorOffset(details);
                }
            }
    }

    return {
        key: errorKey,
        code: errorCode,
        recoverable: isRecoverable,
        stalling: isStalling,
        suppressLevel,
        fatal: isFatal,
        error,
    };
}

/**
 * Quản lý event listeners cho Video element và Hls.js instance.
 */
class EventHandlerBinder {
    constructor(videoElement, videoListeners, hlsjsInstance, hlsjsListeners) {
        this.video = videoElement;
        this.hlsjs = hlsjsInstance;
        this.videoListeners = videoListeners;
        this.hlsjsListeners = hlsjsListeners;
    }

    /**
     * Bật toàn bộ listeners (video + Hls.js).
     * Gọi off() trước để tránh bind trùng.
     */
    on() {
        this.off();

        each(this.videoListeners, (handler, eventName) => {
            this.video.addEventListener(eventName, handler, false);
        });

        each(this.hlsjsListeners, (handler, eventName) => {
            this.hlsjs.on(eventName, handler);
        });
    }

    /**
     * Gỡ toàn bộ listeners (video + Hls.js).
     */
    off() {
        each(this.videoListeners, (handler, eventName) => {
            this.video.removeEventListener(eventName, handler);
        });

        each(this.hlsjsListeners, (handler, eventName) => {
            this.hlsjs.off(eventName, handler);
        });
    }
}

export default class HlsJsProvider extends BaseProvider {
    constructor(playerId, playerConfig, mediaElement) {
        super();

        this.renderNatively =
            Browser.webkit || (Browser.safari && OS.iOS) || (Browser.chrome && playerConfig.renderCaptionsNatively);
        this.bandwidthMonitor = BandwidthMonitor(this, playerConfig.bandwidthEstimate);
        this.bitrateSelection = playerConfig.bitrateSelection;
        this.bufferStallTimeout = 1000;
        this.connectionTimeoutDuration = 10000;
        this.dvrEnd = null;
        this.dvrPosition = null;
        this.dvrUpdatedTime = 0;
        this.eventHandler = null;
        this.hlsjs = null;
        this.hlsjsConfig = null;
        this.hlsjsOptions = null;
        this.jwConfig = playerConfig;
        this.lastPosition = 0;
        this.maxRetries = 3;
        this.playerId = playerId;
        this.processPlaylistMetadata = parseMetadataTag;
        this.recoveryInterval = 5000;
        this.savedVideoProperties = false;
        this.seeking = false;
        this.staleManifestDurationMultiplier = 3000;
        this.state = VideoEvents.STATE_IDLE;
        this.supports = this.supports;
        this.supportsPlaybackRate = true;
        this.video = mediaElement;
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

    get maxBufferLength() {
        if (this.hlsjs) {
            return this.hlsjs.config.maxMaxBufferLength;
        } else {
            return NaN;
        }
    }

    set maxBufferLength(maxMaxBufferLength) {
        if (this.hlsjs) {
            this.hlsjs.config.maxMaxBufferLength = maxMaxBufferLength;
        }
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
                    this.handleError(HLS_ERROR.ERROR_CONNECTION_LOST, null, MSG_BAD_CONNECTION);
                }
            }, this.connectionTimeoutDuration);
        }
    }

    preload(mediaItem) {
        // Nếu preload chỉ cần metadata → giảm buffer để tiết kiệm tài nguyên
        if (mediaItem.preload === "metadata") {
            this.maxBufferLength = Browser.webkit || Browser.safari ? 0 : MetaBufferLength;
        }

        // Gọi load() để thực sự load media item
        this.load(mediaItem);
    }

    initHlsjs(mediaItem) {
        // Lấy config hlsjs từ jwConfig
        const jwHlsConfig = this.jwConfig.hlsjsConfig;
        const cmcdEnabled = Boolean(this.jwConfig.cmcd);
        const hadPreviousOptions = Boolean(this.hlsjsOptions);

        // Xử lý CMCD config
        let cmcdConfig = undefined;
        if (this.hlsjsOptions && this.hlsjsOptions.cmcd) {
            cmcdConfig = this.hlsjsOptions.cmcd;
        }

        if (!hadPreviousOptions && cmcdEnabled) {
            cmcdConfig = {
                contentId: mediaItem?.mediaid,
                ...this.jwConfig.cmcd,
            };
        }

        // Tạo options Hls.js
        const hlsOptions = {
            cmcd: cmcdConfig,
            withCredentials: Boolean(getConfigValue(mediaItem, this.jwConfig, "withCredentials")),
            aesToken: getConfigValue(mediaItem, this.jwConfig, "aestoken"),
            renderTextTracksNatively: this.renderNatively,
            onXhrOpen: mediaItem.sources[0].onXhrOpen,
            liveSyncDuration: getConfigValue(mediaItem, this.jwConfig, "liveSyncDuration"),
            hlsjsConfig: jwHlsConfig,
        };

        // Gắn các track phụ (subtitle/audio sideloaded)
        this.setupSideloadedTracks(mediaItem.tracks);

        // CapLevels = true nếu không có stereomode
        this.capLevels = !mediaItem.stereomode;

        // Nếu đã có hlsjs với options giống hệt → không tạo lại
        if (this.hlsjs && matches(this.hlsjsOptions)(hlsOptions)) {
            return;
        }

        this.hlsjsOptions = hlsOptions;

        // Khôi phục volume/mute trước khi khởi tạo Hls.js mới
        this.restoreVideoProperties();

        // Ngừng timeout cũ
        this.stopStaleTimeout();
        this.stopConnectionTimeout();

        // Build config cuối cùng cho Hls.js
        this.hlsjsConfig = buildHlsjsConfig(hlsOptions);
        const finalConfig = { ...this.hlsjsConfig };

        // Set bandwidth estimate nếu có
        const bandwidthEstimate = this.bandwidthMonitor.getEstimate();
        if (isValidNumber(bandwidthEstimate)) {
            finalConfig.abrEwmaDefaultEstimate = bandwidthEstimate;
        }

        // Giới hạn retry khi append error
        finalConfig.appendErrorMaxRetry = 1;

        // Tạo Hls.js instance
        this.hlsjs = new HlsJs(finalConfig);

        // Gắn event handler
        this.eventHandler = new EventHandlerBinder(
            this.video,
            this.createVideoListeners(),
            this.hlsjs,
            this.createHlsjsListeners()
        );
    }

    load(mediaItem) {
        const { hlsjs, video, src: currentSrc } = this;
        if (!hlsjs) {
            return;
        }

        // Lấy file từ item JWPlayer
        const file = mediaItem.sources[0].file;
        const resolvedSrc = file.url && typeof file.url === "string" ? file.url : file;

        // Nếu src mới giống src cũ và video.src không đổi → chỉ reset maxBufferLength
        if (currentSrc === resolvedSrc && this.videoSrc === video.src) {
            this.maxBufferLength = MaxBufferLength;
            return;
        }

        // Xác định điểm bắt đầu play
        let startTime = mediaItem.starttime || -1;
        if (startTime < -1) {
            startTime = this.lastPosition;
        }

        // Khởi tạo lại Hls.js với item mới
        this.initHlsjs(mediaItem);

        // Lưu thông tin item hiện tại
        this.currentJwItem = mediaItem;
        this.src = resolvedSrc;
        this.videoHeight = 0;

        // Bật event listener cho video
        this._eventsOn();

        // Thiết lập start position cho Hls.js
        hlsjs.config.startPosition = startTime;

        // Load Hls.js
        hlsjs.loadSource(resolvedSrc);
        hlsjs.attachMedia(video);

        // Lưu lại src thực tế từ video
        this.videoSrc = video.src;
    }

    init(mediaItem) {
        this.destroy();
        this.initHlsjs(mediaItem);
    }

    restartStream(startTime) {
        const configs = Object.assign({}, this.currentJwItem);
        if (startTime) {
            configs.starttime = startTime;
        } else {
            delete configs.starttime;
        }
        this.src = null;
        this._clearNonNativeCues();
        this.clearMetaCues();
        this.clearTracks();
        this.init(configs);
        this.load(configs);
        delete configs.starttime;
    }

    play() {
        if (this.isLiveStreamUnloaded) {
            this.isLiveStreamUnloaded = false;
            this.restartStream();
        }

        this.video.play().catch((err) => {
            if (err.name === "AbortError") {
                this.video.play().catch((finalErr) => {
                    console.error("Second play attempt failed:", finalErr);
                });
            } else {
                console.error("Video play failed:", err);
            }
        });
    }

    pause() {
        this.stopConnectionTimeout();
        if (this.live && this.streamType === "LIVE" && !this.isLiveStreamUnloaded) {
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
        this.setState(VideoEvents.STATE_IDLE);
    }

    getSeekRange() {
        const { levelDuration, video } = this;
        const { seekable, duration } = video;

        // Nếu seekable có nhiều đoạn → lấy điểm kết thúc xa nhất
        const seekEnd = seekable.length ? Math.max(seekable.end(0), seekable.end(seekable.length - 1)) : duration;

        // Nếu duration không hợp lệ (NaN) → trả về range 0-0
        if (isNaN(duration)) {
            return { start: 0, end: 0 };
        }

        // Tính khoảng seek: start = end - levelDuration, không nhỏ hơn 0
        return {
            start: Math.max(0, seekEnd - levelDuration),
            end: seekEnd,
        };
    }

    seek(targetPosition) {
        const duration = this.getDuration();
        if (!duration || duration === Infinity || isNaN(duration)) {
            return;
        }

        this.stopStaleTimeout();
        this.stopConnectionTimeout();

        // Nếu DVR mode và seek về vị trí âm, tính toán lại vị trí dựa vào dvrEnd
        let seekTarget = this.dvrEnd && targetPosition < 0 ? this.dvrEnd + targetPosition : targetPosition;

        const seekRange = this.getSeekRange();

        // Điều chỉnh seekTarget nếu đang ở DVR và seek về trước live edge
        if (
            this.streamType === "DVR" &&
            this.dvrEnd !== null &&
            ((this.dvrPosition = seekTarget - this.dvrEnd), targetPosition < 0)
        ) {
            seekTarget += Math.min(12, (now() - this.dvrUpdatedTime) / 1000);
        }

        this.seeking = true;

        const beforeSeekTime = this.video.currentTime;

        // Gửi event MEDIA_SEEK trước khi thay đổi currentTime
        this.trigger(VideoEvents.MEDIA_SEEK, {
            position: this.getCurrentTime(),
            offset: seekTarget,
            duration,
            currentTime: beforeSeekTime,
            seekRange,
            metadata: {
                currentTime: beforeSeekTime,
            },
        });

        // Thực hiện seek
        this.video.currentTime = seekTarget;

        const afterSeekTime = this.video.currentTime;

        // Gửi event "time" sau khi seek
        const timeUpdatePayload = {
            position: this.getCurrentTime(),
            duration,
            currentTime: afterSeekTime,
            seekRange,
            metadata: {
                currentTime: afterSeekTime,
            },
        };

        this.trigger("time", timeUpdatePayload);
    }

    setCurrentAudioTrack(selectedTrackIndex) {
        const currentLevelIndex = this.getCurrentHlsjsLevel();
        const currentHlsLevel = this.hlsjs.levels[currentLevelIndex];
        const jwLevelIndex = findQualityLevelIndex(currentLevelIndex, this.jwLevels);

        // Kiểm tra JW levels và HLS level có hợp lệ không
        if (!this.jwLevels || !this.jwLevels[jwLevelIndex] || !currentHlsLevel) {
            return;
        }

        // Kiểm tra danh sách audio track có hợp lệ và tham số có phải số không
        if (!this.audioTracksArray || size(this.audioTracksArray) === 0 || !isNumber(selectedTrackIndex)) {
            return;
        }

        // Lấy danh sách audio track
        let audioTracks = (this.audioTracks = this.audioTracksArray);

        // Nếu không có track hoặc track đã được chọn trùng với track hiện tại thì bỏ qua
        if (
            !audioTracks ||
            size(audioTracks) === 0 ||
            !audioTracks[selectedTrackIndex] ||
            this.currentAudioTrackIndex === selectedTrackIndex
        ) {
            return;
        }

        // Gửi event danh sách audio tracks (AUDIO_TRACKS)
        this.trigger(VideoEvents.AUDIO_TRACKS, {
            tracks: audioTracks,
            currentTrack: selectedTrackIndex,
        });

        audioTracks = this.audioTracks;
        let selectedTrack = audioTracks[selectedTrackIndex];

        // Nếu track khác với track hiện tại trên Hls.js -> gửi event AUDIO_TRACK_CHANGED
        if (this.currentAudioTrackIndex !== null && selectedTrack.hlsjsIndex !== this.hlsjs.audioTrack) {
            this.trigger(VideoEvents.AUDIO_TRACK_CHANGED, {
                tracks: audioTracks,
                currentTrack: selectedTrackIndex,
            });
            selectedTrack = this.audioTracks[selectedTrackIndex];
        }

        // Cập nhật index track hiện tại
        this.currentAudioTrackIndex = selectedTrackIndex;

        // Nếu track trên Hls.js chưa trùng -> set lại
        if (selectedTrack.hlsjsIndex !== this.hlsjs.audioTrack) {
            this.hlsjs.audioTrack = selectedTrack.hlsjsIndex;
        }
    }

    getCurrentQuality() {
        if (this.hlsjs && !this.hlsjs.autoLevelEnabled) {
            return findQualityLevelIndex(this.hlsjs.manualLevel, this.jwLevels);
        }
        return 0;
    }

    getQualityLevels() {
        return map(this.jwLevels, (level) => qualityLevel(level));
    }

    getCurrentAudioTrack() {
        if (isNumber(this.currentAudioTrackIndex)) {
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
            const levelDuration = this.levelDuration;
            const minDvrWindow = this.currentJwItem.minDvrWindow;
            if (isDvr(levelDuration, minDvrWindow)) {
                this.streamType = "DVR";
                return -levelDuration;
            } else {
                this.streamType = "LIVE";
                return Infinity;
            }
        }
        this.streamType = "VOD";
        return this.video.duration;
    }

    getPlaybackRate() {
        return this.video.playbackRate;
    }

    getBandwidthEstimate() {
        const { hlsjs } = this;
        return hlsjs ? hlsjs.bandwidthEstimate : null;
    }

    getCurrentHlsjsLevel() {
        const { hlsjs } = this;
        if (!hlsjs) return 0;
        return hlsjs.streamController.loadedmetadata && hlsjs.currentLevel > 0 ? hlsjs.currentLevel : hlsjs.firstLevel;
    }

    updateDvrPosition(position) {
        this.dvrPosition = this.video.currentTime - position.end;
        this.dvrEnd = position.end;
        this.dvrUpdatedTime = now();
    }

    getTargetLatency() {
        return (this.hlsjs && this.hlsjs.targetLatency) || null;
    }

    setCurrentQuality(qualityIndex) {
        if (qualityIndex < 0) {
            return;
        }

        // Lấy index level tương ứng trong Hls.js từ jwLevels
        const hlsjsLevelIndex = ((index, jwLevels) => {
            let levelIndex = -1;
            if (index > -1 && jwLevels[index]) {
                levelIndex = jwLevels[index].hlsjsIndex;
            }
            return levelIndex;
        })(qualityIndex, this.jwLevels);

        // Set level cho Hls.js
        this.hlsjs.nextLevel = hlsjsLevelIndex;

        // Gửi event thông báo đã đổi chất lượng
        this.trigger(VideoEvents.MEDIA_LEVEL_CHANGED, {
            levels: this.jwLevels,
            currentQuality: qualityIndex,
        });

        // Lưu lại bitrate được chọn
        this.bitrateSelection = this.jwLevels[qualityIndex].bitrate;
    }

    getLiveLatency() {
        let latency = null;

        // Chỉ tính latency nếu stream là live và có thông tin về live edge
        if (this.live && this.liveEdgePosition !== null) {
            const nowMs = now(); // Lấy thời điểm hiện tại (ms)

            // Latency cơ bản = vị trí edge + thời gian trễ - vị trí hiện tại video
            latency = this.liveEdgePosition + (nowMs - this.liveEdgeUpdated) / 1000 - this.video.currentTime;

            const lastProgramDateTime = this.lastProgramDateTime;

            // Điều chỉnh latency dựa trên program-date-time (nếu có)
            if (lastProgramDateTime) {
                const adjustment =
                    nowMs / 1000 -
                    (lastProgramDateTime / 1000 + (this.video.currentTime - this.programDateSyncTime)) -
                    latency;

                // Chỉ cộng bù nếu adjustment hợp lý (0 < r < 10 giây)
                if (adjustment > 0 && adjustment < 10) {
                    latency += adjustment;
                }
            }
        }

        return latency;
    }

    setCurrentSubtitleTrack(track) {
        this.hlsjs.subtitleTrack = track;
    }

    setPlaybackRate(playbackRate) {
        this.video.playbackRate = this.video.defaultPlaybackRate = playbackRate;
    }

    isLive() {
        return this.live;
    }

    checkAdaptation(levelIndex) {
        const { levels: hlsLevels, autoLevelEnabled } = this.hlsjs;
        const selectedLevel = hlsLevels[levelIndex];

        if (!selectedLevel) {
            return;
        }

        // Lấy thông tin từ level, fallback về video element nếu thiếu width/height
        let { width, height, bitrate } = selectedLevel;
        width = width || this.video.videoWidth;
        height = height || this.video.videoHeight;

        // Nếu không thay đổi gì về height và bitrate thì không cần trigger
        if (height === this.videoHeight && bitrate === this.streamBitrate) {
            return;
        }

        // Tìm index trong JW Levels
        const jwLevelIndex = findQualityLevelIndex(levelIndex, this.jwLevels);

        // Xác định lý do thay đổi chất lượng
        let reason = "api";
        if ((this.streamBitrate !== -1 && this.streamBitrate) || this.videoHeight) {
            if (autoLevelEnabled) {
                reason = "auto";
            }
        } else {
            reason = "initial choice";
        }

        // Cập nhật thông tin stream hiện tại
        this.videoHeight = height;
        this.streamBitrate = bitrate;

        // Xác định mode (auto hoặc manual)
        const mode = autoLevelEnabled ? "auto" : "manual";

        // Xác định label của quality hiển thị cho UI
        const label = autoLevelEnabled && hlsLevels.length > 1 ? "auto" : this.jwLevels[jwLevelIndex].label;

        // Hàm bắn event MEDIA_VISUAL_QUALITY
        const triggerVisualQuality = () => {
            this.trigger(VideoEvents.MEDIA_VISUAL_QUALITY, {
                reason,
                mode,
                level: {
                    bitrate,
                    index: jwLevelIndex,
                    label,
                    width,
                    height,
                },
            });
        };

        // Nếu là IE thì trigger sau event "time", ngược lại trigger ngay
        if (Browser.ie) {
            this.once("time", triggerVisualQuality, this);
        } else {
            triggerVisualQuality();
        }
    }

    createVideoListeners() {
        // Khởi tạo listeners object cho video element
        const videoListeners = {
            waiting: () => {
                this.startConnectionTimeout();
                if (this.seeking) {
                    this.setState(VideoEvents.STATE_LOADING);
                } else if (this.state === VideoEvents.STATE_PLAYING) {
                    if (this.atEdgeOfLiveStream()) {
                        this.setPlaybackRate(1);
                    }
                    this.stallTime = this.video.currentTime;
                    this.setState(VideoEvents.STATE_STALLED);
                }
            },
        };

        // Gắn các listener từ VideoListenerMixin vào videoListeners
        Object.keys(VideoListenerMixin).forEach((eventName) => {
            const mixinHandler = VideoListenerMixin[eventName];

            if (eventName === "playing") {
                // Bổ sung logic checkAdaptation khi video đang playing
                videoListeners[eventName] = function () {
                    const currentLevelIndex = this.getCurrentHlsjsLevel();
                    this.checkAdaptation(currentLevelIndex);
                    mixinHandler.call(this);
                }.bind(this);
            } else if (eventName === "ended") {
                // Reset videoHeight & streamBitrate khi video kết thúc
                videoListeners[eventName] = function () {
                    this.videoHeight = 0;
                    this.streamBitrate = -1;
                    mixinHandler.call(this);
                }.bind(this);
            } else if (eventName !== "error") {
                // Gắn nguyên bản handler từ mixin cho các event khác (trừ error)
                videoListeners[eventName] = mixinHandler.bind(this);
            }
        });

        return videoListeners;
    }

    setCurrentLevel(levelIndex) {
        this.currentHlsjsLevel = levelIndex;
        this.checkAdaptation(levelIndex);
        this.updateAudioTrack(this.hlsjs.levels[levelIndex]);
    }

    updateAudioTrack(level) {
        // Nếu Hls.js chưa có hoặc không có audioTracks -> thoát
        if (!this.hlsjs || !this.hlsjs.audioTracks.length) {
            return;
        }

        let selectedTrackIndex = this.currentAudioTrackIndex;

        if (isNumber(selectedTrackIndex)) {
            // Nếu đã có track được chọn nhưng không khớp với audioTrack hiện tại của hlsjs → reset về null
            if (!this.audioTracks || this.audioTracks[selectedTrackIndex].hlsjsIndex !== this.hlsjs.audioTrack) {
                this.currentAudioTrackIndex = null;
            }
        } else {
            // Nếu chưa có track được chọn → tìm track default hoặc lấy track đầu tiên
            selectedTrackIndex = this.audioTracksArray
                ? ((tracks = []) =>
                      Math.max(
                          indexOf(
                              tracks,
                              find(tracks, (e) => e.defaulttrack)
                          ),
                          0
                      ))(this.audioTracksArray)
                : 0;
        }

        // Gọi setCurrentAudioTrack với index track tìm được
        this.setCurrentAudioTrack(selectedTrackIndex);
    }

    checkStaleManifest(lastSegmentNumber, isLiveStream, targetDuration) {
        // Tính thời gian timeout: ưu tiên lấy liveTimeout từ config, nếu không có dùng multiplier
        const timeoutDuration =
            this.jwConfig.liveTimeout !== null
                ? this.jwConfig.liveTimeout * 1000
                : this.staleManifestDurationMultiplier * targetDuration;

        // Nếu stream là live và segment cuối cùng không thay đổi → bắt đầu tính timeout
        if (isLiveStream && this.lastEndSn === lastSegmentNumber && timeoutDuration !== 0) {
            if (this.staleManifestTimeout === -1) {
                this.staleManifestTimeout = window.setTimeout(() => {
                    this.checkStreamEnded();
                }, timeoutDuration);
            }
        } else {
            // Nếu manifest không còn stale hoặc không phải live → dừng timeout cũ
            this.stopStaleTimeout();
        }

        // Cập nhật trạng thái cuối cùng
        this.lastEndSn = lastSegmentNumber;
        this.live = isLiveStream;
    }

    createHlsjsListeners() {
        const hlsjsListeners = {};
        hlsjsListeners[HlsEvents.MEDIA_ATTACHED] = () => {
            if (this.recoveringMediaError) {
                this.hlsjs.startLoad();
                this.recoveringMediaError = false;
                this.resetRecovery();
                this.stopStaleTimeout();
                this.stopConnectionTimeout();
            }
        };
        hlsjsListeners[HlsEvents.MEDIA_DETACHED] = () => {
            this._clearNonNativeCues();
        };
        hlsjsListeners[HlsEvents.MANIFEST_PARSED] = (event, data) => {
            const { levels: hlsLevels } = data;
            const hlsInstance = this.hlsjs;
            const { bitrateSelection, jwConfig } = this;

            let startLevelIndex = -1;
            let nextLevelIndex = -1;

            // Reset trạng thái level hiện tại
            this.currentHlsjsLevel = null;

            // Map danh sách level của HLS sang JW Levels
            this.jwLevels = mapHlsLevelsToJwLevels(hlsLevels, jwConfig.qualityLabels);

            // Nếu bật capLevels và có thông tin kích thước player → giới hạn level theo size
            if (this.capLevels && (this.playerWidth || this.playerHeight) && this.playerStretching) {
                const cappedLevelIndex = getMaxLevelBySize(
                    hlsLevels,
                    this.playerWidth,
                    this.playerHeight,
                    data.firstLevel + 1
                );

                if (hlsInstance.levelController.firstLevel !== cappedLevelIndex) {
                    hlsInstance.firstLevel = cappedLevelIndex;
                }

                this.resize(this.playerWidth, this.playerHeight, this.playerStretching);
            }

            // Nếu có bitrateSelection → tìm level bitrate gần nhất
            if (isValidNumber(bitrateSelection)) {
                startLevelIndex = ((levels, targetBitrate) => {
                    if (!levels) return -1;

                    let closestDiff = Number.MAX_VALUE;
                    let chosenIndex = -1;

                    for (let i = 0; i < levels.length; i++) {
                        const level = levels[i];
                        if (!level.bitrate) continue;

                        const diff = Math.abs(targetBitrate - level.bitrate);
                        if (diff <= closestDiff) {
                            closestDiff = diff;
                            chosenIndex = i;
                        }
                        // Nếu tìm thấy bitrate khớp hoàn toàn → dừng luôn
                        if (diff === 0) break;
                    }
                    return chosenIndex;
                })(hlsLevels, bitrateSelection);

                nextLevelIndex = startLevelIndex;
            }

            // Set level khởi đầu cho hls.js
            hlsInstance.startLevel = startLevelIndex;
            hlsInstance.nextLevel = nextLevelIndex;

            // Bắt đầu load manifest
            hlsInstance.startLoad(hlsInstance.config.startPosition);

            // Trigger event MEDIA_LEVELS cho JWPlayer
            this.trigger(VideoEvents.MEDIA_LEVELS, {
                levels: this.jwLevels,
                currentQuality: findQualityLevelIndex(startLevelIndex, this.jwLevels),
            });
        };
        hlsjsListeners[HlsEvents.LEVEL_LOADED] = (event, data) => {
            const { endSN, live, targetduration } = data.details;
            this.checkStaleManifest(endSN, live, targetduration);
        };
        hlsjsListeners[HlsEvents.LEVEL_UPDATED] = (event, data) => {
            const { live: isLive, totalduration: totalDuration } = data.details;

            // Cập nhật trạng thái live và tổng thời lượng level hiện tại
            this.live = isLive;
            this.levelDuration = totalDuration;

            // Lấy seek range hiện tại (thường gồm { start, end })
            const seekRange = this.getSeekRange();

            // Kiểm tra xem dvrEnd có thay đổi đáng kể không (chênh lệch > 1s)
            const dvrEndChanged = this.dvrEnd !== null && Math.abs(this.dvrEnd - seekRange.end) > 1;

            // Nếu stream là DVR và có thay đổi vị trí DVR → cập nhật lại DVR position
            if (this.streamType === "DVR" && dvrEndChanged) {
                this.updateDvrPosition(seekRange);
            }

            // Nếu là live stream và state hiện tại đang IDLE → unload để khởi động lại live
            if (isLive && this.state === STATE_IDLE) {
                this.unloadLiveStream();
            }
        };
        hlsjsListeners[HlsEvents.LEVEL_PTS_UPDATED] = (event, data) => {
            const { fragments, totalduration: totalDuration } = data.details;

            // Cập nhật tổng thời lượng của level hiện tại
            this.levelDuration = totalDuration;

            // Nếu có fragment trong level
            if (fragments.length) {
                const lastFragment = fragments[fragments.length - 1];

                // Nếu sequence number của fragment cuối cùng khác với liveEdgeSn → cập nhật live edge
                if (lastFragment.sn !== this.liveEdgeSn) {
                    this.liveEdgeUpdated = now();
                    this.liveEdgeSn = lastFragment.sn;
                    this.liveEdgePosition = lastFragment.start + lastFragment.duration;
                }
            }
        };
        hlsjsListeners[HlsEvents.LEVEL_SWITCHED] = (event, data) => {
            const { level: switchedLevelIndex } = data;

            // Nếu level mới khác với level hiện tại → set level mới
            if (switchedLevelIndex !== this.currentHlsjsLevel) {
                this.setCurrentLevel(switchedLevelIndex);
            } else {
                // Nếu trùng level → chỉ check lại adaptation
                this.checkAdaptation(switchedLevelIndex);
            }
        };
        hlsjsListeners[HlsEvents.FRAG_LOADED] = (event, data) => {
            const { frag } = data;

            // Cập nhật thông tin Program Date Time và sync time từ fragment
            this.lastProgramDateTime = frag.programDateTime;
            this.programDateSyncTime = frag.start;

            // Nếu chưa có startDateTime nhưng đã có lastProgramDateTime -> gán và trigger event
            if (this.lastProgramDateTime && !this.startDateTime) {
                this.startDateTime = this.lastProgramDateTime;
                this.trigger(VideoEvents.ABSOLUTE_POSITION_READY, {
                    ready: true,
                    startDateTime: this.startDateTime,
                });
            }
        };
        hlsjsListeners[HlsEvents.FRAG_CHANGED] = (event, data) => {
            this.lastProgramDateTime = data.frag.programDateTime;
            this.programDateSyncTime = data.frag.start;
        };
        hlsjsListeners[HlsEvents.FRAG_PARSING_METADATA] = (event, data) => {
            if (data.samples) {
                // Nếu có textTrack chưa sử dụng → set lại textTracks cho video
                const hasUnusedTrack = [].some.call(this.video.textTracks, (track) => !track.inuse);
                if (hasUnusedTrack) {
                    this.setTextTracks(this.video.textTracks);
                }

                // Duyệt qua từng sample metadata (ID3) và trigger MEDIA_META
                data.samples.forEach((sample) => {
                    this.trigger(VideoEvents.MEDIA_META, {
                        metadataType: "dai-hls",
                        metadata: {
                            messageData: sample.data,
                            start: sample.pts,
                            type: "ID3",
                        },
                    });
                });
            }
        };
        hlsjsListeners[HlsEvents.BUFFER_APPENDED] = () => {
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
        hlsjsListeners[HlsEvents.BUFFER_CODECS] = (event, data) => {
            // Nếu có audio codec và video đã được phát hiện → không cần làm gì
            if (data.audio && this.videoFound) {
                return;
            }

            // Xác định loại media dựa trên codec có trong buffer
            const detectedMediaType = data.audiovideo || data.video ? "video" : "audio";

            // Đánh dấu đã tìm thấy video (nếu mediaType là video)
            this.videoFound = this.videoFound || detectedMediaType === "video";

            // Gửi event MEDIA_TYPE để thông báo loại media
            this.trigger(VideoEvents.MEDIA_TYPE, {
                mediaType: detectedMediaType,
            });
        };
        hlsjsListeners[HlsEvents.FRAG_BUFFERED] = (event, data) => {
            const { frag } = data;

            // Duyệt qua từng tag trong frag.tagList (nếu có) và xử lý metadata playlist
            (frag.tagList || []).forEach(([tagName, tagValue]) => {
                this.processPlaylistMetadata(tagName, tagValue, frag);
            });
        };
        hlsjsListeners[HlsEvents.INIT_PTS_FOUND] = (event, data) => {
            const { frag, initPTS } = data;

            // Gửi metadata với tag DISCONTINUITY khi tìm thấy initPTS
            this.processPlaylistMetadata("DISCONTINUITY", initPTS, frag);
        };
        if (!this.renderNatively) {
            hlsjsListeners[HlsEvents.NON_NATIVE_TEXT_TRACKS_FOUND] = (event, data) => {
                this.addTextTracks(data.tracks);
            };
            hlsjsListeners[HlsEvents.CUES_PARSED] = (event, data) => {
                if (data && data.cues && data.cues.length) {
                    let overlappingCount;
                    const cuesNeedConversion = !(data.cues[0] instanceof VTTCue);

                    data.cues.forEach((cueItem) => {
                        // Nếu cue không phải VTTCue thì convert
                        if (cuesNeedConversion) {
                            const rawCue = cueItem;
                            cueItem = new VTTCue(rawCue.startTime, rawCue.endTime, rawCue.text);
                            cueItem.position = rawCue.position;
                        }

                        // Đếm số cue trùng startTime để xác định line
                        if (!overlappingCount) {
                            overlappingCount = data.cues.filter((c) => c.startTime === cueItem.startTime).length;
                        }

                        // Thiết lập style cho cue
                        cueItem.align = "center";
                        cueItem.line = 90 - overlappingCount * 5;
                        cueItem.position = 50;

                        // Thêm cue vào video
                        this.addVTTCue({
                            type: data.type,
                            cue: cueItem,
                            track: data.track,
                        });

                        // Giảm dần overlappingCount cho cue tiếp theo
                        overlappingCount--;
                    });
                }
            };
        }
        hlsjsListeners[HlsEvents.AUDIO_TRACKS_UPDATED] = (event, data) => {
            const { audioTracks } = data;
            const hlsLevels = this.hlsjs.levels;
            const currentLevelIndex = this.getCurrentHlsjsLevel();

            if (audioTracks && audioTracks.length) {
                // Map audioTracks của Hls.js sang audioTracksArray trong player
                this.audioTracksArray = ((track) =>
                    reduce(
                        track,
                        (acc, track, index) => {
                            acc.push({
                                autoselect: track.autoselect,
                                defaulttrack: track.default,
                                groupid: track.groupId,
                                language: track.lang,
                                name: track.name,
                                hlsjsIndex: index,
                            });
                            return acc;
                        },
                        []
                    ))(audioTracks);

                // Cập nhật audioGroupId cho mỗi jwLevel (nếu có)
                this.jwLevels.forEach((jwLevel) => {
                    const level = jwLevel.hlsjsIndex > 0 ? hlsLevels[jwLevel.hlsjsIndex] : null;
                    if (level) {
                        jwLevel.audioGroupId = getAudioGroupId(level); // hàm l() đổi tên thành getAudioGroupId()
                    }
                });

                // Gọi updateAudioTrack với level hiện tại
                this.updateAudioTrack(hlsLevels[currentLevelIndex]);
            }
        };
        hlsjsListeners[HlsEvents.ERROR] = (event, errorData) => {
            const hlsInstance = this.hlsjs;
            const parsedError = parseError(errorData);
            const { type: errorType } = errorData;
            const { key: errorKey } = parsedError;

            let isTokenRetry = false;
            logWarn(errorData);

            // 🟠 DVR STREAM – update DVR position khi có lỗi liên quan manifest
            if (this.streamType === "DVR" && errorType === ErrorTypes.NETWORK_ERROR) {
                const seekRange = this.getSeekRange();
                this.updateDvrPosition(seekRange);
            }

            // 🟠 Trường hợp lỗi JWPlayer token (232403) – thử retry
            if (
                parsedError.code === 232403 &&
                this.retryCount < this.maxRetries &&
                /jwpsrv.com\/.*\?token=/.test(errorData.url)
            ) {
                parsedError.suppressLevel = false;
                parsedError.recoverable = true;
                parsedError.fatal = true;
                isTokenRetry = true;
                this.maxRetries = 1;
            }

            // 🟠 Nếu lỗi cho phép suppress level (hạ cấp chất lượng hoặc bỏ level)
            if (parsedError.suppressLevel) {
                const levels = hlsInstance.levels;
                const errorContext = errorData.context || errorData;
                const { level: levelIndex } = errorContext;
                const level = levels[levelIndex];

                if (level && Array.isArray(level.url) && level.url.length === 1) {
                    hlsInstance.removeLevel(levelIndex, 0);

                    // Nếu sau khi remove không còn level nào → handle lỗi luôn
                    if (!hlsInstance.levels.length) {
                        this.handleError(parsedError.code, errorData, errorKey);
                        return;
                    }

                    parsedError.fatal = false;

                    // Update lại jwLevels sau khi remove
                    this.jwLevels = mapHlsLevelsToJwLevels(hlsInstance.levels, this.jwConfig.qualityLabels);

                    // Resize nếu có thông số player
                    if (this.playerWidth && this.playerHeight && this.playerStretching) {
                        this.resize(this.playerWidth, this.playerHeight, this.playerStretching);
                    }

                    // Reset về level đầu tiên
                    hlsInstance.loadLevel = 0;
                    hlsInstance.currentLevel = -1;

                    this.trigger(VideoEvents.MEDIA_LEVELS, {
                        levels: this.jwLevels,
                        currentQuality: 0,
                    });
                }
            }

            // 🟠 Nếu lỗi fatal → kiểm tra có thể recover hay phải dừng hẳn
            if (parsedError.fatal) {
                const nowTime = now();
                const canRecover = parsedError.recoverable && (errorType === q || errorType === W);
                const currentRetryCount = this.retryCount;

                // Nếu không thể recover hoặc vượt quá số lần retry → stop luôn
                if (!canRecover || !(currentRetryCount < this.maxRetries)) {
                    hlsInstance.stopLoad();
                    this.handleError(parsedError.code, errorData, errorKey);
                    return;
                }

                // 🟠 Thử recover nếu chưa tới hạn interval
                if (!this.lastRecoveryTime || nowTime >= this.lastRecoveryTime + this.recoveryInterval) {
                    logWarn("Attempting to recover, retry count:", currentRetryCount);

                    if (errorType === q) {
                        // Network error (manifest lỗi)
                        if (/^manifest/.test(errorData.details) || isTokenRetry) {
                            this.recoverManifestError();
                            this.retryCount = currentRetryCount;
                        } else {
                            hlsInstance.startLoad();
                        }
                    } else if (errorType === W) {
                        // Media error (bufferAppendError, decode lỗi)
                        if (errorData.details === "bufferAppendError") {
                            logWarn("Encountered a bufferAppendError in hls; destroying instance");
                            hlsInstance.destroy();
                        } else {
                            this.recoveringMediaError = true;
                            hlsInstance.recoverMediaError();
                        }
                    }

                    this.recoveringNetworkError = true;
                    this.retryCount += 1;
                    this.lastRecoveryTime = nowTime;
                }
            }

            // 🟠 Cuối cùng → Trigger WARNING cho player
            this.trigger(VideoEvents.WARNING, new PlayerError(null, parsedError.code + 100000, errorData));
        };

        return hlsjsListeners;
    }

    resize(newWidth, newHeight, stretchingMode) {
        // Cập nhật thông tin player
        this.playerWidth = newWidth;
        this.playerHeight = newHeight;
        this.playerStretching = stretchingMode;

        // Nếu bật capLevels → giới hạn level dựa trên kích thước player
        if (this.capLevels) {
            const hlsInstance = this.hlsjs;
            if (hlsInstance && hlsInstance.levels) {
                const previousCap = hlsInstance.autoLevelCapping;

                // Gọi hàm để tìm level phù hợp nhất với kích thước mới
                const newCap = getMaxLevelBySize(hlsInstance.levels, this.playerWidth, this.playerHeight);

                // Nếu level capping thay đổi → cập nhật
                if (newCap !== previousCap) {
                    hlsInstance.autoLevelCapping = newCap;

                    // Nếu nâng cap level (newCap > previousCap) và player không ở trạng thái idle/complete
                    if (
                        newCap > previousCap &&
                        previousCap !== -1 &&
                        this.state !== VideoEvents.STATE_IDLE &&
                        this.state !== VideoEvents.STATE_COMPLETE
                    ) {
                        hlsInstance.streamController.nextLevelSwitch();
                    }
                }
            }
        }
    }

    recoverManifestError() {
        const { currentTime, paused } = this.video;

        // Nếu video đã có thời gian xem (currentTime) hoặc đang không pause → restart stream
        if (currentTime || !paused) {
            this.restartStream(currentTime);

            // Nếu video đang phát (không pause) → play lại (bắt lỗi phòng ngừa)
            if (!paused) {
                this.play().catch(() => {});
            }
        } else {
            // Nếu video chưa phát → dừng load và load lại manifest từ đầu
            this.hlsjs.stopLoad();
            this.hlsjs.loadSource(this.src);
        }
    }

    _eventsOn() {
        const { bandwidthMonitor, eventHandler, video } = this;

        // Bật event handler nếu có
        if (eventHandler) {
            eventHandler.on();
        }

        // Bắt đầu theo dõi băng thông
        bandwidthMonitor.start();

        // Đăng ký các sự kiện video với instance này
        attachNativeFullscreenListeners(this, video);
    }

    setFullscreen(state) {
        return toggleNativeFullscreen(this, state);
    }

    _eventsOff() {
        const { bandwidthMonitor, eventHandler, hlsjs, video } = this;

        // Nếu đang dùng hlsjs và có eventHandler → tắt event handler
        if (hlsjs && eventHandler) {
            this.disableTextTrack();
            this.lastPosition = this.video.currentTime;

            hlsjs.detachMedia();
            eventHandler.off();
        }

        // Gỡ các listener custom của instance này
        this.off(null, null, this);

        // Ngừng monitor băng thông
        bandwidthMonitor.stop();

        // Reset các biến lifecycle
        this.resetLifecycleVariables();

        // Huỷ đăng ký các sự kiện video
        detachNativeFullscreenListeners(video);
    }

    handleError(errorCode, errorData, errorMessage) {
        this.resetLifecycleVariables();
        this.trigger(VideoEvents.MEDIA_ERROR, new PlayerError(errorMessage, errorCode, errorData));
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

    checkStreamEnded() {
        if (this.hlsjs && (this.video.ended || this.atEdgeOfLiveStream())) {
            this.hlsjs.stopLoad();
            this.handleError(HLS_ERROR.ERROR_LIVE_STREAM_DOWN_OR_ENDED, null, MSG_LIVE_STREAM_DOWN);
        }
    }

    setCurrentLevel(index) {
        this.currentHlsjsLevel = index;
        this.checkAdaptation(index);
        this.updateAudioTrack(this.hlsjs.levels[index]);
    }

    _clearNonNativeCues() {
        if (!this.renderNatively && this._textTracks) {
            this._textTracks.forEach((track) => {
                this.clearCueData(track._id);
            });
        }
    }

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
