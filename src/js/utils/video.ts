import { attachControlsObserver } from "./helpers";

const video = __HEADLESS__ ? null : document.createElement("video");

if (video) attachControlsObserver(video);

export default video;
