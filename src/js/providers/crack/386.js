const r = "free";
const u = "starter";
const i = "business";
const o = "premium";
const s = "enterprise";
const a = "developer";
const c = "platinum";
const l = "ads";
const d = "unlimited";
const f = "trial";
const D = "invalid";
export function Z(e) {
    const t = {
        setup: [r, u, i, o, s, a, l, d, f, c],
        drm: [s, a, l, d, f],
        ads: [l, d, f, c, s, a, i],
        jwpsrv: [r, u, i, o, s, a, l, f, c, D],
        discovery: [l, s, a, f, d],
    };
    return function (n) {
        return t[n] && t[n].indexOf(e) > -1;
    };
}
