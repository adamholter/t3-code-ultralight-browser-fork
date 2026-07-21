import type { CodexTurn, ThreadItem, UserInput } from "../types";

export function flattenItems(turns: CodexTurn[]): ThreadItem[] {
  return turns.flatMap((turn) => turn.items);
}

export function userInputText(content: UserInput[]) {
  return content.filter((part) => part.type === "text").map((part) => "text" in part ? part.text : "").join("\n");
}

export function userInputImages(content: UserInput[]) {
  return content.flatMap((part) => part.type === "image" && "url" in part && typeof part.url === "string"
    ? [{ url: part.url, name: "name" in part && typeof part.name === "string" ? part.name : "Attached image" }]
    : []);
}

function userInputSignature(content: UserInput[]) {
  return JSON.stringify({ text: userInputText(content), images: userInputImages(content).map((image) => image.url) });
}

export function upsertItem(items: ThreadItem[], item: ThreadItem) {
  const index = items.findIndex((current) => current.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export function reconcileStreamedItem(items: ThreadItem[], item: ThreadItem) {
  if (item.type === "userMessage") {
    const signature = userInputSignature(Array.isArray(item.content) ? item.content : []);
    const localIndex = items.findIndex((current) =>
      current.type === "userMessage" &&
      String(current.id).startsWith("local-") &&
      userInputSignature(Array.isArray(current.content) ? current.content : []) === signature,
    );
    if (localIndex >= 0) {
      const next = [...items];
      next[localIndex] = item;
      return next;
    }
  }
  return upsertItem(items, item);
}

export function appendItemDelta(items: ThreadItem[], itemId: string, field: "text" | "summary" | "aggregatedOutput", delta: string) {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) return items;
  const next = [...items];
  const item = { ...next[index] } as any;
  if (field === "summary") {
    const summary = Array.isArray(item.summary) ? [...item.summary] : [""];
    summary[summary.length - 1] = `${summary.at(-1) ?? ""}${delta}`;
    item.summary = summary;
  } else {
    item[field] = `${item[field] ?? ""}${delta}`;
  }
  next[index] = item;
  return next;
}
