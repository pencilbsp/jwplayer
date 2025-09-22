export const hlsMime = "application/vnd.apple.mpegurl";

export function isHlsSupported(preferManagedMediaSource = true): boolean {
    if (typeof self === "undefined") return false;

    const ms =
        ((preferManagedMediaSource || !self.MediaSource) && (self as any).ManagedMediaSource) ||
        self.MediaSource ||
        (self as any).WebKitMediaSource;

    if (!ms || typeof ms.isTypeSupported !== "function") return false;

    const sb = self.SourceBuffer || (self as any).WebKitSourceBuffer;
    if (
        sb &&
        (!sb.prototype || typeof sb.prototype.appendBuffer !== "function" || typeof sb.prototype.remove !== "function")
    ) {
        return false;
    }

    return (
        ["avc1.42E01E,mp4a.40.2", "av01.0.01M.08", "vp09.00.50.08"].some((c) =>
            ms.isTypeSupported(`video/mp4;codecs=${c}`)
        ) || ["mp4a.40.2", "fLaC"].some((c) => ms.isTypeSupported(`audio/mp4;codecs=${c}`))
    );
}

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
    return !!video.canPlayType(hlsMime);
}

export default video;
