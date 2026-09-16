export function appendMessageDelta(current: string, data: Record<string, unknown>): string {
  return current + (typeof data.messageDelta === "string" ? data.messageDelta : "")
}
