export const MAIN_BRAIN_ID = "main";
export function validBrainId(id: string) {
  return id === MAIN_BRAIN_ID || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/** Main retains all legacy storage paths; new brains have independent namespaces. */
export function brainKey(brainId: string, key: string) {
  if (!validBrainId(brainId)) throw new Error("Invalid brain ID");
  if (!key || key.includes("..") || key.startsWith("/") || !/^[a-zA-Z0-9_./-]+$/.test(key)) throw new Error("Invalid brain storage key");
  return brainId === MAIN_BRAIN_ID ? key : `brains/${brainId}/${key}`;
}
