import BUFFER_ICON from 'assets/SVG/buffer.svg';
import REPLAY_ICON from 'assets/SVG/replay.svg';
import ERROR_ICON from 'assets/SVG/playback-error.svg';
import PLAY_ICON from 'assets/SVG/play.svg';
import PAUSE_ICON from 'assets/SVG/pause.svg';
import REWIND_ICON from 'assets/SVG/rewind-10.svg';
import FORWARD_ICON from 'assets/SVG/forward-10.svg';
import NEXT_ICON from 'assets/SVG/next.svg';
import STOP_ICON from 'assets/SVG/stop.svg';
import VOLUME_ICON_0 from 'assets/SVG/volume-0.svg';
import VOLUME_ICON_50 from 'assets/SVG/volume-50.svg';
import VOLUME_ICON_100 from 'assets/SVG/volume-100.svg';
import CAPTIONS_ON_ICON from 'assets/SVG/captions-on.svg';
import CAPTIONS_OFF_ICON from 'assets/SVG/captions-off.svg';
import AIRPLAY_ON_ICON from 'assets/SVG/airplay-on.svg';
import AIRPLAY_OFF_ICON from 'assets/SVG/airplay-off.svg';
import ARROW_LEFT_ICON from 'assets/SVG/arrow-left.svg';
import ARROW_RIGHT_ICON from 'assets/SVG/arrow-right.svg';
import PLAYBACK_RATE_ICON from 'assets/SVG/playback-rate.svg';
import SETTINGS_ICON from 'assets/SVG/settings.svg';
import AUDIO_TRACKS_ICON from 'assets/SVG/audio-tracks.svg';
import QUALITY_ICON from 'assets/SVG/quality-100.svg';
import FULLSCREEN_EXIT_ICON from 'assets/SVG/fullscreen-not.svg';
import FULLSCREEN_ENTER_ICON from 'assets/SVG/fullscreen.svg';
import PIP_ON_ICON from 'assets/SVG/pip-on.svg';
import PIP_OFF_ICON from 'assets/SVG/pip-off.svg';
import CLOSE_ICON from 'assets/SVG/close.svg';
import JW_LOGO from 'assets/SVG/jw-logo.svg';
import svgParse from 'utils/svgParser';

let collection: XMLDocument | null = null;

export function cloneIcon(name: string): Node | null {
    const icon = getCollection().querySelector(nameToClass(name));
    if (icon) {
        return clone(icon);
    }
    if (__DEBUG__) {
        throw new Error('Icon not found ' + name);
    }
    return null;
}

export function cloneIcons(names: string): Node[] {
    const icons = getCollection().querySelectorAll(names.split(',').map(nameToClass).join(','));
    if (__DEBUG__ && !icons.length) {
        throw new Error('Icons not found ' + names);
    }
    return Array.prototype.map.call(icons, icon => clone(icon));
}

function nameToClass(name: string): string {
    return `.jw-svg-icon-${name}`;
}

function clone(icon: Node): Node {
    return icon.cloneNode(true);
}

function getCollection(): XMLDocument {
    if (!collection) {
        collection = parseCollection();
    }
    return collection;
}

function parseCollection(): XMLDocument {
    return svgParse('<xml>' +
        BUFFER_ICON +
        REPLAY_ICON +
        ERROR_ICON +
        PLAY_ICON +
        PAUSE_ICON +
        REWIND_ICON +
        FORWARD_ICON +
        NEXT_ICON +
        STOP_ICON +
        VOLUME_ICON_0 +
        VOLUME_ICON_50 +
        VOLUME_ICON_100 +
        CAPTIONS_ON_ICON +
        CAPTIONS_OFF_ICON +
        AIRPLAY_ON_ICON +
        AIRPLAY_OFF_ICON +
        ARROW_LEFT_ICON +
        ARROW_RIGHT_ICON +
        PLAYBACK_RATE_ICON +
        SETTINGS_ICON +
        AUDIO_TRACKS_ICON +
        QUALITY_ICON +
        PIP_ON_ICON +
        PIP_OFF_ICON +
        FULLSCREEN_EXIT_ICON +
        FULLSCREEN_ENTER_ICON +
        CLOSE_ICON +
        JW_LOGO +
        '</xml>');
}
