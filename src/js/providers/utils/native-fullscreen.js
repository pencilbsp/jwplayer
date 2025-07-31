import { NATIVE_FULLSCREEN } from "../../events/events";

// Biến trạng thái full màn hình native (WebKit)
let beginFullscreenHandler;
let endFullscreenHandler;
let isNativeFullscreen = false;

/**
 * Kiểm tra hiện tại video có đang ở trạng thái full màn hình native không
 */
export const isNativeFullscreenActive = () => isNativeFullscreen;

/**
 * Bật hoặc tắt native fullscreen cho video (WebKit)
 * @param {Object} player - instance player chứa video element
 * @param {boolean} enable - true: bật fullscreen, false: thoát fullscreen
 * @returns {boolean} - trạng thái fullscreen sau khi gọi
 */
export const toggleNativeFullscreen = (player, enable) => {
    enable = Boolean(enable);

    if (enable) {
        try {
            const enterFullscreen =
                player.video.webkitEnterFullscreen ||
                player.video.webkitEnterFullScreen;
            if (enterFullscreen) {
                enterFullscreen.apply(player.video);
            }
        } catch (err) {
            return false;
        }
        return player.getFullscreen();
    }

    const exitFullscreen =
        player.video.webkitExitFullscreen || player.video.webkitExitFullScreen;
    if (exitFullscreen) {
        exitFullscreen.apply(player.video);
    }

    return enable;
};

/**
 * Gửi event khi trạng thái fullscreen native thay đổi
 */
const triggerNativeFullscreenEvent = (player, event, isActive) => {
    isNativeFullscreen = isActive;
    player.trigger(NATIVE_FULLSCREEN, {
        target: event.target,
        jwstate: isActive,
    });
};

/**
 * Gắn listener cho các sự kiện WebKit fullscreen (iOS video fullscreen)
 */
export const attachNativeFullscreenListeners = (player, videoElement) => {
    beginFullscreenHandler = (event) =>
        triggerNativeFullscreenEvent(player, event, true);
    endFullscreenHandler = (event) =>
        triggerNativeFullscreenEvent(player, event, false);

    videoElement.addEventListener(
        "webkitbeginfullscreen",
        beginFullscreenHandler
    );
    videoElement.addEventListener("webkitendfullscreen", endFullscreenHandler);
};

/**
 * Gỡ listener fullscreen khỏi video element
 */
export const detachNativeFullscreenListeners = (videoElement) => {
    videoElement.removeEventListener(
        "webkitbeginfullscreen",
        beginFullscreenHandler
    );
    videoElement.removeEventListener(
        "webkitendfullscreen",
        endFullscreenHandler
    );
};
