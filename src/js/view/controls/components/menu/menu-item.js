import { toggleClass, createElement } from "utils/dom";
import { itemButtonTemplate, itemTemplate, itemToggleTemplate } from "view/controls/templates/menu/menu-item";
import { addClickAction } from "view/utils/add-click-action";
export class MenuItem {
    constructor(_content, _action, _template = itemTemplate) {
        this.el = createElement(_template(_content));
        this.ui = addClickAction(this.el, _action, this);
    }
    destroy() {
        if (this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.ui.destroy();
    }
}

export class ButtonMenuItem extends MenuItem {
    constructor(_content, _action, _template = itemButtonTemplate) {
        super(_content, _action, _template);
    }
    activate() {
        if (this.active) {
            return;
        }
        toggleClass(this.el, "jw-settings-item-active", true);
        this.el.setAttribute("aria-checked", "true");
        this.active = true;
    }
    deactivate() {
        if (!this.active) {
            return;
        }
        toggleClass(this.el, "jw-settings-item-active", false);
        this.el.setAttribute("aria-checked", "false");
        this.active = false;
    }
}

export class ToggleMenuItem {
    constructor(label, initialState, onToggle) {
        this.el = createElement(itemToggleTemplate(label, initialState));

        this.toggle = this.el.querySelector(".jw-toggle-switch");

        this._clickHandler = (evt) => {
            if (evt.stopPropagation) {
                evt.stopPropagation();
            } else {
                evt.cancelBubble = true; // fallback IE8 nếu cần
            }
            const newState = !this.toggle.classList.contains("jw-toggle-on");
            this.setState(newState);
            onToggle(newState);
        };

        this.el.addEventListener("click", this._clickHandler);
    }

    setState(on) {
        this.toggle.classList.toggle("jw-toggle-on", on);
        this.toggle.classList.toggle("jw-toggle-off", !on);
    }

    destroy() {
        if (this.el) {
            this.el.removeEventListener("click", this._clickHandler);
            if (this.el.parentNode) {
                this.el.parentNode.removeChild(this.el);
            }
        }
        this.toggle = null;
    }
}
