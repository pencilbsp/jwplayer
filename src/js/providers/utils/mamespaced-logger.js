import { stringify } from "json5";

/** Các cấp độ log */
const LOG_LEVELS = {
    debug: 0,
    info: 100,
    warn: 200,
    error: 400,
};

/**
 * Hàm chuẩn hóa message log thành chuỗi
 */
const stringifyLogValue = (value) => {
    switch (typeof value) {
        case "object":
            return ((obj) => {
                if (obj === null) {
                    return "null";
                }
                let output = "";
                try {
                    output += stringify(obj, null, "  ");
                } catch (err) {
                    output += "{error stringifying value}";
                }
                return output;
            })(value);
        case "undefined":
            return "undefined";
        default:
            const str = value.toString == null ? undefined : value.toString();
            return str !== null && str !== undefined ? str : "{error stringifying value}";
    }
};

/**
 * Logger có namespace (ghi log có phân cấp)
 */
class NamespacedLogger {
    constructor(namespace, levels = LOG_LEVELS) {
        this._namespace = namespace;
        this._levels = levels;
    }

    /**
     * Tạo logger con với namespace mở rộng
     */
    child(childNamespace) {
        return new NamespacedLogger(
            `${this._namespace}/${childNamespace}`,
            this._levels
        );
    }

    /**
     * Hàm log chính (nội bộ)
     */
    _log(levelValue, consoleMethod, ...messages) {
        try {
            // Log ra console nếu đạt mức LOG_LEVEL
            if (levelValue >= NamespacedLogger.LOG_LEVEL) {
                console[consoleMethod](`[${this._namespace}]:`, ...messages);
            }

            // Giữ lịch sử log
            if (
                NamespacedLogger.LOG_HISTORY.length >=
                NamespacedLogger.MAX_LOG_HISTORY
            ) {
                NamespacedLogger.LOG_HISTORY.shift();
            }
            NamespacedLogger.LOG_HISTORY.push([
                new Date(),
                consoleMethod.toUpperCase(),
                this._namespace,
                messages.map(stringifyLogValue).join("\n"),
            ]);
        } catch (err) {
            console.error(err);
        }
    }

    /** Log với các cấp độ khác nhau */
    trace(...messages) {
        this._log(this._levels.debug, "trace", ...messages);
    }
    debug(...messages) {
        this._log(this._levels.debug, "debug", ...messages);
    }
    log(...messages) {
        this._log(this._levels.info, "log", ...messages);
    }
    info(...messages) {
        this._log(this._levels.info, "info", ...messages);
    }
    warn(...messages) {
        this._log(this._levels.warn, "warn", ...messages);
    }
    error(...messages) {
        this._log(this._levels.error, "error", ...messages);
    }

    /** Lấy lịch sử log */
    get history() {
        return [...NamespacedLogger.LOG_HISTORY];
    }
}

/** Cấu hình mặc định cho Logger */
NamespacedLogger.LOG_LEVEL = 400;
NamespacedLogger.MAX_LOG_HISTORY = 200;
NamespacedLogger.LOG_HISTORY = [];

/** Export class logger chính */
export default NamespacedLogger;
