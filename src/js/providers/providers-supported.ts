import video from "utils/video";
import { isRtmp } from "utils/validator";
import type { PlaylistItemSource } from "playlist/source";
import { isAndroidHls } from "providers/html5-android-hls";

type CodecType = "audio" | "video";

function mimeTypeForCodec(codec: string, type: CodecType): string {
    return `${type}/mp4;codecs=${codec}`;
}

function getMediaSource(preferManagedMediaSource = true): typeof MediaSource | undefined {
    if (typeof self === "undefined") return undefined;
    const mms =
        (preferManagedMediaSource || !self.MediaSource) &&
        ((self as any).ManagedMediaSource as undefined | typeof MediaSource);
    return mms || self.MediaSource || ((self as any).WebKitMediaSource as typeof MediaSource);
}

function getSourceBuffer(): typeof self.SourceBuffer {
    return self.SourceBuffer || (self as any).WebKitSourceBuffer;
}

function isMSESupported(): boolean {
    const mediaSource = getMediaSource();
    if (!mediaSource) {
        return false;
    }

    // if SourceBuffer is exposed ensure its API is valid
    // Older browsers do not expose SourceBuffer globally so checking SourceBuffer.prototype is impossible
    const sourceBuffer = getSourceBuffer();
    return (
        !sourceBuffer ||
        (sourceBuffer.prototype &&
            typeof sourceBuffer.prototype.appendBuffer === "function" &&
            typeof sourceBuffer.prototype.remove === "function")
    );
}

export function isSupported(): boolean {
    if (!isMSESupported()) {
        return false;
    }

    const mediaSource = getMediaSource();
    return (
        typeof mediaSource?.isTypeSupported === "function" &&
        (["avc1.42E01E,mp4a.40.2", "av01.0.01M.08", "vp09.00.50.08"].some((codecsForVideoContainer) =>
            mediaSource.isTypeSupported(mimeTypeForCodec(codecsForVideoContainer, "video"))
        ) ||
            ["mp4a.40.2", "fLaC"].some((codecForAudioContainer) =>
                mediaSource.isTypeSupported(mimeTypeForCodec(codecForAudioContainer, "audio"))
            ))
    );
}

const MimeTypes = {
    aac: "audio/mp4",
    mp4: "video/mp4",
    f4v: "video/mp4",
    m4v: "video/mp4",
    mov: "video/mp4",
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    ogv: "video/ogg",
    ogg: "video/ogg",
    oga: "video/ogg",
    vorbis: "video/ogg",
    webm: "video/webm",
    // The following are not expected to work in Chrome
    f4a: "video/aac",
    m3u8: "application/vnd.apple.mpegurl",
    m3u: "application/vnd.apple.mpegurl",
    hls: "application/vnd.apple.mpegurl",
};

export const SupportsMatrix = __HEADLESS__
    ? []
    : [
          {
              name: "hlsjs",
              supports: supportsHlsJs,
          },
          {
              name: "html5",
              supports: supportsType,
          },
      ];

/**
 * Ưu tiên dùng hls.js nếu trình duyệt có MSE.
 * Nếu không có MSE, fallback sang Safari HTML5 (native HLS).
 */
export function supportsHlsJs(source: PlaylistItemSource): boolean {
    if (__HEADLESS__ || !video || !video.canPlayType) {
        return false;
    }

    // Chỉ xét file HLS
    const type = source.type;
    if (type !== "m3u8" && type !== "hls" && type !== "m3u") {
        return false;
    }

    // ✅ Nếu có MSE => cho phép dùng hls.js
    if (isSupported()) {
        return true;
    }

    // ❌ Nếu không có MSE => Safari có thể phát native HLS (HTML5)
    // => KHÔNG trả về true ở đây, để html5 fallback xử lý
    return false;
}

export function supportsType(source: PlaylistItemSource): boolean {
    if (__HEADLESS__ || !video || !video.canPlayType) {
        return false;
    }

    if (isAndroidHls(source) === false) {
        return false;
    }

    const file = source.file;
    const type = source.type;

    // Ensure RTMP files are not seen as videos
    if (isRtmp(file, type)) {
        return false;
    }

    let mimeType = source.mimeType || MimeTypes[type];

    // Not OK to use HTML5 with no extension
    if (!mimeType) {
        return false;
    }

    // source.mediaTypes is an Array of media types that MediaSource must support for the stream to play
    // Ex: ['video/webm; codecs="vp9"', 'audio/webm; codecs="vorbis"']
    const mediaTypes = source.mediaTypes;
    if (mediaTypes && mediaTypes.length) {
        mimeType = [mimeType].concat(mediaTypes.slice()).join("; ");
    }

    // Last, but not least, we ask the browser
    // (But only if it's a video with an extension known to work in HTML5)
    return !!video.canPlayType(mimeType);
}
