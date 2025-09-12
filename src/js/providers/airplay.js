import { getAbsolutePath } from "utils/parser";

/**
 * AirPlayController
 * @param {object} player - Đối tượng player (có instreamDestroy)
 * @param {object} model  - Model trạng thái (get/set/on/off/change/getVideo/...)
 */
export default function AirPlayController(player, model) {
    /** @type {HTMLVideoElement|null} */
    let videoEl = null;
    const self = this;

    /** Đồng bộ trạng thái cast tổng hợp vào model.castState */
    const syncCastState = () => {
        model.set("castState", {
            available: model.get("castAvailable"),
            active: model.get("castActive"),
        });
    };

    /** Chuẩn hoá đường dẫn file trong một mảng nguồn */
    const absolutizeSourceList = (list) => {
        if (!list) return;
        list.forEach((src) => {
            src.file = getAbsolutePath(src.file);
        });
    };

    /** Chuẩn hoá đường dẫn cho playlistItem (image, sources, allSources) */
    const normalizePlaylistItem = (item) => {
        if (!item) return;
        item.image = getAbsolutePath(item.image);
        absolutizeSourceList(item.allSources);
        absolutizeSourceList(item.sources);
    };

    /** Cập nhật trạng thái khả dụng AirPlay */
    self.updateAvailability = (evt) => {
        const isAvailable = evt.availability === "available";
        model.set("castAvailable", isAvailable);
        syncCastState();
    };

    /** Cập nhật trạng thái đang phát qua AirPlay (wireless) */
    self.updateActive = () => {
        let isWireless = false;
        if (videoEl) {
            isWireless = Boolean(videoEl.webkitCurrentPlaybackTargetIsWireless);
        }

        // Tạm ngừng theo dõi đổi playlistItem trước khi cập nhật lại
        model.off("change:playlistItem", normalizePlaylistItem);

        if (isWireless) {
            // Khi chuyển AirPlay, huỷ instream và đảm bảo đường dẫn tuyệt đối
            player.instreamDestroy();
            normalizePlaylistItem(model.get("playlistItem"));
            // Theo dõi lại thay đổi playlistItem
            model.on("change:playlistItem", normalizePlaylistItem);
        }

        model.set("airplayActive", isWireless);
        model.set("castActive", isWireless);
        syncCastState();
    };

    /** Mở UI chọn thiết bị AirPlay của Safari */
    self.airplayToggle = () => {
        if (videoEl && typeof videoEl.webkitShowPlaybackTargetPicker === "function") {
            videoEl.webkitShowPlaybackTargetPicker();
        }
    };

    // Khởi tạo / gắn listener mỗi khi item sẵn sàng
    model.change("itemReady", () => {
        videoEl = null;

        const videoWrapper = model.getVideo();
        if (videoWrapper) {
            videoEl = videoWrapper.video;
        }

        if (videoEl) {
            // Cho phép remote playback và gắn listener AirPlay của WebKit
            videoEl.removeAttribute("disableRemotePlayback");

            videoEl.removeEventListener("webkitplaybacktargetavailabilitychanged", self.updateAvailability);
            videoEl.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", self.updateActive);

            videoEl.addEventListener("webkitplaybacktargetavailabilitychanged", self.updateAvailability);
            videoEl.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", self.updateActive);
        }

        // Cập nhật lần đầu (evt rỗng để giữ API cũ)
        self.updateAvailability({});
        self.updateActive();
    });
}
