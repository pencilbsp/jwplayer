import { log } from "../../utils/log";
import * as i from "../../utils/parser";
import * as u from "../../utils/validator";
import * as r from "../../utils/playerutils";
import {
    extension,
    hms,
    pad,
    prefix,
    seconds,
    suffix,
    trim,
} from "../../utils/strings";
import Timer from "../../api/timer";
import ApiSettings from "../../api/api-settings";
import { indexOf } from "../../utils/underscore";
import { flashVersion, isIframe } from "../../utils/browser";
import {
    addClass,
    addStyleSheet,
    bounds,
    classList,
    createElement,
    emptyElement,
    hasClass,
    openLink,
    removeClass,
    replaceClass,
    replaceInnerHtml,
    styleDimension,
    toggleClass,
} from "../../utils/dom";
import { clearCss, css, getRgba, style, transform } from "../../utils/css";
import { ajax } from "../../utils/ajax";
import { between } from "../../utils/math";
import { genId } from "../../utils/random-id-generator";
import * as y from "./8762";

class c {
    constructor(e, t) {
        this.name = e;
        this.message = t.message || t.toString();
        this.error = t;
    }
}

function C(e, t) {
    if (e == null) {
        throw new TypeError("Cannot convert undefined or null to object");
    }
    return Object.prototype.hasOwnProperty.call(Object(e), t);
}

export const Z = Object.assign({}, i, u, r, {
    logger: new y.Z("helpers"),
    addClass: addClass,
    hasClass: hasClass,
    removeClass: removeClass,
    replaceClass: replaceClass,
    toggleClass: toggleClass,
    classList: classList,
    styleDimension: styleDimension,
    createElement: createElement,
    emptyElement: emptyElement,
    addStyleSheet: addStyleSheet,
    bounds: bounds,
    openLink: openLink,
    replaceInnerHtml: replaceInnerHtml,
    css: css,
    clearCss: clearCss,
    style: style,
    transform: transform,
    getRgba: getRgba,
    ajax: ajax,
    crossdomain: (e) => {
        const t = window.URL;
        try {
            const n = new t(e, location.origin);
            return (
                `${location.protocol}//${location.host}` !=
                `${n.protocol}//${n.host}`
            );
        } catch (e) {
            F.debug(e);
        }
        return true;
    },
    tryCatch: function (e, t, n = []) {
        if (ApiSettings.debug) {
            return e.apply(t || this, n);
        }
        try {
            return e.apply(t || this, n);
        } catch (t) {
            return new c(e.name, t);
        }
    },
    Error: c,
    Timer: Timer,
    log: log,
    genId: genId,
    between: between,
    foreach: function (e, t) {
        for (const n in e) {
            if (C(e, n)) {
                t(n, e[n]);
            }
        }
    },
    flashVersion: flashVersion,
    isIframe: isIframe,
    indexOf: indexOf,
    trim: trim,
    pad: pad,
    extension: extension,
    hms: hms,
    seconds: seconds,
    prefix: prefix,
    suffix: suffix,
    noop: () => {},
});
