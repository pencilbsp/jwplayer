import { version } from "version";
import { isFileProtocol } from "utils/validator";

export const getScriptPath = function (scriptName: string, hashLength = __CONTENT_HASH_LENGTH__): string {
    if (!__HEADLESS__) {
        const scripts = document.getElementsByTagName("script");
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].src;
            if (src) {
                if (hashLength > 0) {
                    const base = scriptName.replace(".js", "");
                    const regex = new RegExp("/" + base + "\\.[0-9a-fA-F]{" + hashLength + "}\\.js$");
                    if (regex.test(src)) {
                        return src.substr(0, src.lastIndexOf("/") + 1);
                    }
                } else {
                    const index = src.lastIndexOf("/" + scriptName);
                    if (index >= 0) {
                        return src.substr(0, index + 1);
                    }
                }
            }
        }
    }
    return "";
};

// Gets the repository location from which modules and plugins are loaded by default
export const repo = function (): string {
    if (__SELF_HOSTED__) {
        return getScriptPath("jwplayer.js");
    }

    const playerRepo = __REPO__;
    const protocol = playerRepo && isFileProtocol() ? "https:" : "";
    return `${protocol}${playerRepo}`;
};

// Is the player at least a minimum required version?
export const versionCheck = function (target: string): boolean {
    const tParts = ("0" + target).split(/\W/);
    const jParts = version.split(/\W/);
    const tMajor = parseFloat(tParts[0]);
    const jMajor = parseFloat(jParts[0]);
    if (tMajor > jMajor) {
        return false;
    } else if (tMajor === jMajor) {
        if (parseFloat("0" + tParts[1]) > parseFloat(jParts[1])) {
            return false;
        }
    }
    return true;
};

export const loadFrom = function (): string {
    if (__DEBUG__ || __SELF_HOSTED__) {
        return getScriptPath("jwplayer.js");
    }
    return repo();
};
