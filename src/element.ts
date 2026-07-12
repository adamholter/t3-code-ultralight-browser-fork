import { buildEmbedUrl } from "./embed-url";

export interface DefineCodexChatElementOptions {
  tagName?: string;
  defaultBridgeUrl?: string;
}

/**
 * Register a dependency-free `<codex-chat>` element. Safe to import during SSR;
 * registration becomes a no-op when DOM custom elements are unavailable.
 */
export function defineCodexChatElement(options: DefineCodexChatElementOptions = {}) {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") return false;
  const tagName = options.tagName ?? "codex-chat";
  if (customElements.get(tagName)) return false;
  const defaultBridgeUrl = options.defaultBridgeUrl ?? "http://127.0.0.1:4174";

  class CodexChatElement extends HTMLElement {
    static observedAttributes = ["bridge-url", "title", "min-height", "loading"];

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    private render() {
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      root.replaceChildren();
      this.style.setProperty("--codex-chat-min-height", this.getAttribute("min-height") ?? "420px");
      const style = document.createElement("style");
      style.textContent = `
        :host { display: block; width: 100%; height: 100%; min-height: var(--codex-chat-min-height); }
        iframe { display: block; width: 100%; height: 100%; min-height: inherit; border: 0; border-radius: inherit; background: transparent; }
      `;
      const iframe = document.createElement("iframe");
      iframe.src = buildEmbedUrl(this.getAttribute("bridge-url") ?? defaultBridgeUrl);
      iframe.title = this.getAttribute("title") ?? "Local Codex chat";
      iframe.loading = this.getAttribute("loading") === "lazy" ? "lazy" : "eager";
      iframe.allow = "clipboard-read; clipboard-write";
      iframe.part.add("frame");
      iframe.addEventListener("load", () => {
        this.dispatchEvent(new CustomEvent("codex-chat-ready", { bubbles: true, composed: true }));
      }, { once: true });
      root.append(style, iframe);
    }
  }

  customElements.define(tagName, CodexChatElement);
  return true;
}
