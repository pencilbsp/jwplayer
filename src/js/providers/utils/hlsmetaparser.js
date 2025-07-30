import { isFinite } from "../../utils/underscore";
import { MEDIA_META_CUE_PARSED } from "../../events/events";

// Lấy giá trị số (PTS, duration, …) từ object nếu hợp lệ
const getNumericValue = (obj, key) => {
    const value = obj[key];
    return (0, isFinite)(value) && value >= 0 ? value : null;
};

// Hàm xử lý metadata từ HLS tag
export const parseMetadataTag = function (tagName, tagContent, segmentInfo) {
    const metadata = ((tagName, tagContent, segmentInfo) => {
        let startTime;
        let metadataType;

        // Ưu tiên lấy startPTS, nếu không có thì lấy start
        startTime = (0, isFinite)(segmentInfo.startPTS)
            ? getNumericValue(segmentInfo, "startPTS")
            : getNumericValue(segmentInfo, "start");

        if (startTime === null) return null;

        switch (tagName) {
            case "PROGRAM-DATE-TIME":
                metadataType = "program-date-time";
                return {
                    metadataType,
                    programDateTime: tagContent,
                    start: startTime,
                    end: startTime + getNumericValue(segmentInfo, "duration"),
                };

            case "EXT-X-DATERANGE": {
                const attrMap = {};
                const attributes = tagContent.split(",").map((item) => {
                    const [key, rawValue] = item.split("=");
                    const cleanValue = (rawValue || "").replace(/^"|"$/g, "");
                    attrMap[key] = cleanValue;
                    return { name: key, value: cleanValue };
                });

                const startDate = attrMap["START-DATE"];
                if (!startDate) return null;

                const endDate = attrMap["END-DATE"];

                let calculatedStart = startTime;
                if ((0, isFinite)(segmentInfo.programDateTime)) {
                    calculatedStart +=
                        (new Date(startDate).getTime() -
                            new Date(segmentInfo.programDateTime).getTime()) /
                        1000;
                }
                if (isNaN(calculatedStart)) return null;

                let duration =
                    parseFloat(
                        attrMap["PLANNED-DURATION"] || attrMap.DURATION
                    ) || 0;
                if (!duration && endDate) {
                    duration =
                        (new Date(endDate).getTime() -
                            new Date(startDate).getTime()) /
                        1000;
                }

                metadataType = "date-range";
                return {
                    metadataType,
                    tag: tagName,
                    content: tagContent,
                    attributes,
                    start: calculatedStart,
                    end: calculatedStart + duration,
                    startDate,
                    endDate,
                    duration,
                };
            }

            case "EXT-X-CUE-IN":
            case "EXT-X-CUE-OUT":
                metadataType = "scte-35";
                return {
                    metadataType,
                    tag: tagName,
                    content: tagContent,
                    start: startTime,
                    end: startTime + (parseFloat(tagContent) || 0),
                };

            case "DISCONTINUITY": {
                const endTime =
                    startTime + getNumericValue(segmentInfo, "duration");
                const discontinuitySequence =
                    "cc" in segmentInfo ? segmentInfo.cc : undefined;

                metadataType = "discontinuity";
                return {
                    metadataType,
                    tag: tagName,
                    discontinuitySequence,
                    PTS: tagContent,
                    start: startTime,
                    end: endTime,
                };
            }

            default:
                return null;
        }
    })(tagName, tagContent, segmentInfo);

    // Nếu có metadata hợp lệ -> tạo cue
    if (metadata) {
        if (!(0, isFinite)(metadata.start)) return;

        const cue = this.createCue(
            metadata.start,
            metadata.end,
            JSON.stringify(metadata)
        );
        const cueId = `${segmentInfo.sn}_${tagName}_${tagContent}`;

        if (this.addVTTCue({ type: "metadata", cue }, cueId)) {
            const { metadataType } = metadata;
            delete metadata.metadataType;
            this.trigger(MEDIA_META_CUE_PARSED, {
                metadataType,
                metadata,
            });
        }
    }
};
