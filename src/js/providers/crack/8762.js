import { stringify } from "json5";

const u = {
    debug: 0,
    info: 100,
    warn: 200,
    error: 400,
};
const i = (e) => {
    switch (typeof e) {
        case "object":
            return ((e) => {
                if (e === null) {
                    return "null";
                }
                let t = "";
                try {
                    t += stringify(e, null, "  ");
                } catch (e) {
                    t += "{error stringifying value}";
                }
                return t;
            })(e);
        case "undefined":
            return "undefined";
        default:
            return (
                (e.toString == null ? undefined : e.toString()) ??
                "{error stringifying value}"
            );
    }
};
class o {
    constructor(e, t = u) {
        this._namespace = e;
        this._levels = t;
    }
    child(e) {
        return new o(`${this._namespace}/${e}`, this._levels);
    }
    _log(e, t, ...n) {
        try {
            if (e >= o.LOG_LEVEL) {
                console[t](`[${this._namespace}]:`, ...n);
            }
            if (o.LOG_HISTORY.length >= o.MAX_LOG_HISTORY) {
                o.LOG_HISTORY.shift();
            }
            o.LOG_HISTORY.push([
                new Date(),
                t.toUpperCase(),
                this._namespace,
                n.map(i).join("\n"),
            ]);
        } catch (e) {
            console.error(e);
        }
    }
    trace(...e) {
        this._log(this._levels.debug, "trace", ...e);
    }
    debug(...e) {
        this._log(this._levels.debug, "debug", ...e);
    }
    log(...e) {
        this._log(this._levels.info, "log", ...e);
    }
    info(...e) {
        this._log(this._levels.info, "info", ...e);
    }
    warn(...e) {
        this._log(this._levels.warn, "warn", ...e);
    }
    error(...e) {
        this._log(this._levels.error, "error", ...e);
    }
    get history() {
        return [...o.LOG_HISTORY];
    }
}
o.LOG_LEVEL = 400;
o.MAX_LOG_HISTORY = 200;
o.LOG_HISTORY = [];
export const Z = o;
