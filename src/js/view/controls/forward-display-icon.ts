import { addClickAction } from 'view/utils/add-click-action';
import type UI from 'utils/ui';
import type ViewModel from 'view/view-model';
import type { PlayerAPI } from 'types/generic.type';
export default class ForwardDisplayIcon {
    el: HTMLElement;
    ui: UI;

    constructor(model: ViewModel, api: PlayerAPI, element: HTMLElement) {
        const iconDisplay = element.querySelector('.jw-icon') as HTMLElement;

        this.el = element;
        this.ui = addClickAction(iconDisplay, function (): void {
            const currentPosition = model.get('position');
            const duration = model.get('duration');
            let forwardPosition = currentPosition + 10;

            // duration is negative in DVR mode
            if (model.get('streamType') === 'DVR') {
                forwardPosition = currentPosition;
            }
            // Seek 10s next. Seek value should be <= 0 in VOD mode and <= (negative) duration in DVR mode
            api.seek(Math.min(forwardPosition, duration));
        });
    }

    element(): HTMLElement {
        return this.el;
    }
}
