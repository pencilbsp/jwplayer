type CodecType = "audio" | "video";

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

function mimeTypeForCodec(codec: string, type: CodecType): string {
    return `${type}/mp4;codecs=${codec}`;
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

export function isHlsSupported(): boolean {
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

export const hlsMime = "application/vnd.apple.mpegURL";

export type VideoPresentationMode = "inline" | "fullscreen" | "picture-in-picture";

declare global {
    interface HTMLVideoElement {
        webkitPresentationMode?: string;
        webkitSetPresentationMode?: (mode: VideoPresentationMode) => void;
        webkitSupportsPresentationMode?: (mode: VideoPresentationMode) => boolean;
    }
}

const video = __HEADLESS__ ? null : document.createElement("video");

export const pipSupported = video
    ? typeof video.requestPictureInPicture === "function" || typeof video.webkitSupportsPresentationMode === "function"
    : false;

export function isNativeHlsSupported() {
    if (!video) return false;
    return Boolean(video.canPlayType(hlsMime));
}

export default video;
