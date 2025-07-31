import Timer from "../../api/timer";
import { log } from "../../utils/log";
import { ajax } from "../../utils/ajax";
import { between } from "../../utils/math";
import ApiSettings from "../../api/api-settings";
import { indexOf } from "../../utils/underscore";
import * as parserUtils from "../../utils/parser";
import NamespacedLogger from "./mamespaced-logger";
import * as playerUtils from "../../utils/playerutils";
import { genId } from "../../utils/random-id-generator";
import * as validatorUtils from "../../utils/validator";
import { flashVersion, isIframe } from "../../utils/browser";
import { clearCss, css, getRgba, style, transform } from "../../utils/css";
import {
    hms,
    pad,
    trim,
    suffix,
    prefix,
    seconds,
    extension,
} from "../../utils/strings";

import {
    bounds,
    hasClass,
    openLink,
    addClass,
    classList,
    toggleClass,
    removeClass,
    replaceClass,
    emptyElement,
    createElement,
    addStyleSheet,
    styleDimension,
    replaceInnerHtml,
} from "../../utils/dom";

/**
 * Class đại diện cho lỗi helper tùy chỉnh
 */
class HelperError {
    constructor(name, error) {
        this.name = name;
        this.message = error.message || error.toString();
        this.error = error;
    }
}

/**
 * Hàm kiểm tra property có tồn tại trong object không (an toàn với null/undefined)
 */
function hasOwn(obj, prop) {
    if (obj == null) {
        throw new TypeError("Cannot convert undefined or null to object");
    }
    return Object.prototype.hasOwnProperty.call(Object(obj), prop);
}

/**
 * Helper chính được export ra
 */
export const Helpers = Object.assign(
    {},
    parserUtils,
    validatorUtils,
    playerUtils,
    {
        logger: new NamespacedLogger("helpers"),

        // DOM helpers
        addClass,
        hasClass,
        removeClass,
        replaceClass,
        toggleClass,
        classList,
        styleDimension,
        createElement,
        emptyElement,
        addStyleSheet,
        bounds,
        openLink,
        replaceInnerHtml,

        // CSS helpers
        css,
        clearCss,
        style,
        transform,
        getRgba,

        // AJAX
        ajax,

        /**
         * Kiểm tra cross-domain (dựa trên URL API hiện tại)
         */
        crossdomain: (url) => {
            const Url = window.URL;
            try {
                const parsed = new Url(url, location.origin);
                return (
                    `${location.protocol}//${location.host}` !==
                    `${parsed.protocol}//${parsed.host}`
                );
            } catch (err) {
                F.debug(err); // Giữ nguyên hành vi log debug như cũ
            }
            return true;
        },

        /**
         * Thử gọi hàm, bắt lỗi nếu có
         */
        tryCatch: function (fn, context, args = []) {
            if (ApiSettings.debug) {
                return fn.apply(context || this, args);
            }
            try {
                return fn.apply(context || this, args);
            } catch (err) {
                return new HelperError(fn.name, err);
            }
        },

        // Export các tiện ích khác
        Error: HelperError,
        Timer,
        log,
        genId,
        between,

        /**
         * Lặp qua object (forEach với key-value)
         */
        foreach: function (obj, callback) {
            for (const key in obj) {
                if (hasOwn(obj, key)) {
                    callback(key, obj[key]);
                }
            }
        },

        // Misc utils
        flashVersion,
        isIframe,
        indexOf,
        trim,
        pad,
        extension,
        hms,
        seconds,
        prefix,
        suffix,

        /**
         * Hàm noop – không làm gì cả
         */
        noop: () => {},
    }
);
