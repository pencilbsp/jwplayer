declare const __BUILD_VERSION__: string;
declare const __DEBUG__: boolean;
declare interface Window {
  msCrypto: Crypto;
  jwready?: boolean;
  jwplayerPluginJsonp?: Function;
  HlsJsProvider?: any;
  VideoProvider?: any;
  WebKitPlaybackTargetAvailabilityEvent?: Function;
}

declare interface Document {
  webkitHidden: boolean;
}

declare interface AudioTrackList {
  [Symbol.iterator](): IterableIterator<any>;
  length: number;
}

declare const __SELF_HOSTED__: boolean;
declare const __REPO__: string;
declare const __HEADLESS__: boolean;
declare const __CONTENT_HASH_LENGTH__: number;
