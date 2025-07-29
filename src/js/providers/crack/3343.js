import { isFinite } from "../../utils/underscore";
import { MEDIA_META_CUE_PARSED } from "../../events/events";

const a = (e, t) => {
    const i = e[t];
    if ((0, isFinite)(i) && i >= 0) {
        return i;
    } else {
        return null;
    }
};
export const q = function (e, t, i) {
    const s = ((e, t, i) => {
        let n;
        let s;
        n = (0, isFinite)(i.startPTS) ? a(i, "startPTS") : a(i, "start");
        if (n === null) {
            return null;
        }
        switch (e) {
            case "PROGRAM-DATE-TIME":
                s = "program-date-time";
                return {
                    metadataType: s,
                    programDateTime: t,
                    start: n,
                    end: n + a(i, "duration"),
                };
            case "EXT-X-DATERANGE": {
                const a = {};
                const o = t.split(",").map((e) => {
                    const t = e.split("=");
                    const i = t[0];
                    const r = (t[1] || "").replace(/^"|"$/g, "");
                    a[i] = r;
                    return {
                        name: i,
                        value: r,
                    };
                });
                const l = a["START-DATE"];
                if (!l) {
                    return null;
                }
                const u = a["END-DATE"];
                let d = n;
                if ((0, isFinite)(i.programDateTime)) {
                    d +=
                        (new Date(l).getTime() -
                            new Date(i.programDateTime).getTime()) /
                        1000;
                }
                if (isNaN(d)) {
                    return null;
                }
                let h = parseFloat(a["PLANNED-DURATION"] || a.DURATION) || 0;
                if (!h && u) {
                    h = (new Date(u).getTime() - new Date(l).getTime()) / 1000;
                }
                s = "date-range";
                return {
                    metadataType: "date-range",
                    tag: e,
                    content: t,
                    attributes: o,
                    start: d,
                    end: d + h,
                    startDate: l,
                    endDate: u,
                    duration: h,
                };
            }
            case "EXT-X-CUE-IN":
            case "EXT-X-CUE-OUT":
                s = "scte-35";
                return {
                    metadataType: s,
                    tag: e,
                    content: t,
                    start: n,
                    end: n + (parseFloat(t) || 0),
                };
            case "DISCONTINUITY": {
                const r = n + a(i, "duration");
                let o;
                if ("cc" in i) {
                    o = i.cc;
                }
                s = "discontinuity";
                return {
                    metadataType: s,
                    tag: e,
                    discontinuitySequence: o,
                    PTS: t,
                    start: n,
                    end: r,
                };
            }
            default:
                return null;
        }
    })(e, t, i);
    if (s) {
        if (!(0, isFinite)(s.start)) {
            return;
        }
        const a = this.createCue(s.start, s.end, JSON.stringify(s));
        const o = `${i.sn}_${e}_${t}`;
        if (
            this.addVTTCue(
                {
                    type: "metadata",
                    cue: a,
                },
                o
            )
        ) {
            const e = s.metadataType;
            delete s.metadataType;
            this.trigger(MEDIA_META_CUE_PARSED, {
                metadataType: e,
                metadata: s,
            });
        }
    }
};
