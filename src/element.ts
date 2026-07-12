import { buildEmbedUrl } from "./embed-url";
import {
  createCodexEmbedController,
  subscribeCodexEmbedEvents,
  type CodexEmbedCommandResult,
  type CodexEmbedController,
  type CodexEmbedSendOptions,
} from "./embed-events";

export interface DefineCodexChatElementOptions {
  tagName?: string;
  defaultBridgeUrl?: string;
}

export interface CodexChatElementApi extends HTMLElement {
  sendPrompt(text: string, options?: CodexEmbedSendOptions): Promise<CodexEmbedCommandResult>;
  newThread(): Promise<CodexEmbedCommandResult>;
  stop(): Promise<CodexEmbedCommandResult>;
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
    private unsubscribeEvents: (() => void) | null = null;
    private controller: CodexEmbedController | null = null;
    private pendingRender: Promise<void> | null = null;

    connectedCallback() {
      this.scheduleRender();
    }

    attributeChangedCallback(_name: string, previous: string | null, next: string | null) {
      if (this.isConnected && previous !== next) this.scheduleRender();
    }

    disconnectedCallback() {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      this.controller?.dispose();
      this.controller = null;
    }

    async sendPrompt(text: string, sendOptions?: CodexEmbedSendOptions) {
      const controller = await this.readyController();
      return controller.send(text, sendOptions);
    }

    async newThread() {
      const controller = await this.readyController();
      return controller.newThread();
    }

    async stop() {
      const controller = await this.readyController();
      return controller.stop();
    }

    private scheduleRender() {
      if (this.pendingRender) return;
      this.pendingRender = new Promise((resolveRender) => {
        queueMicrotask(() => {
          this.pendingRender = null;
          if (this.isConnected) this.render();
          resolveRender();
        });
      });
    }

    private async readyController() {
      await this.pendingRender;
      if (!this.controller) throw new Error("Embedded Codex chat is not connected");
      return this.controller;
    }

    private render() {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      this.controller?.dispose();
      this.controller = null;
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
        this.dispatchEvent(new CustomEvent("codex-chat-load", { bubbles: true, composed: true }));
      }, { once: true });
      root.append(style, iframe);
      this.controller = createCodexEmbedController(iframe);
      this.unsubscribeEvents = subscribeCodexEmbedEvents(iframe, (detail) => {
        if (detail.event === "command" && detail.command === "ping") return;
        const options = { detail, bubbles: true, composed: true };
        this.dispatchEvent(new CustomEvent("codex-chat-event", options));
        this.dispatchEvent(new CustomEvent(`codex-chat-${detail.event}`, options));
      });
    }
  }

  customElements.define(tagName, CodexChatElement);
  return true;
}
