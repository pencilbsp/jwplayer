import { NATIVE_FULLSCREEN } from "../../events/events";

let u;
let i;
let o = false;
export const If = () => o;
export const CX = function (e, t) {
    if ((t = Boolean(t))) {
        try {
            const t =
                e.video.webkitEnterFullscreen || e.video.webkitEnterFullScreen;
            if (t) {
                t.apply(e.video);
            }
        } catch (e) {
            return false;
        }
        return e.getFullscreen();
    }
    const n = e.video.webkitExitFullscreen || e.video.webkitExitFullScreen;
    if (n) {
        n.apply(e.video);
    }
    return t;
};
const c = function (e, t, n) {
    o = n;
    e.trigger(NATIVE_FULLSCREEN, {
        target: t.target,
        jwstate: n,
    });
};
export const Nm = function (e, t) {
    u = (t) => c(e, t, true);
    i = (t) => c(e, t, false);
    t.addEventListener("webkitbeginfullscreen", u);
    t.addEventListener("webkitendfullscreen", i);
};
export const IP = (e) => {
    e.removeEventListener("webkitbeginfullscreen", u);
    e.removeEventListener("webkitendfullscreen", i);
};
