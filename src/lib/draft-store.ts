import type { ComposerContextItem, PermissionMode } from "../types";
import type { ComposerImageAttachment } from "../components/Composer";

export interface ComposerDraft {
  text: string;
  images: ComposerImageAttachment[];
  context: ComposerContextItem[];
  collaborationMode: "build" | "plan";
  permissionMode: PermissionMode;
}

const DB = "t3-code-ultralight";
const STORE = "drafts";

export async function loadDraft(key: string): Promise<ComposerDraft | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result?.draft ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(key: string, draft: ComposerDraft) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, draft });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDraft(key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
