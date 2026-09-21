export const OPEN_PERSON_QUICK_ADD_EVENT = "emther:open-person-quick-add";
export const PERSON_REGISTERED_EVENT = "emther:person-registered";

export type OpenPersonQuickAddDetail = {
  name?: string;
  aliases?: string;
};

/** どの画面からでも人物クイック追加ダイアログを開く。 */
export function openPersonQuickAdd(detail: OpenPersonQuickAddDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_PERSON_QUICK_ADD_EVENT, { detail }));
}
