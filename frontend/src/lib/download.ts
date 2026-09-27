// Shared "save this text as a file" idiom (v1's lib/handoff.ts had it; kept as its own small module
// since it's used by more than one export path — ThreadRow's markdown export, DataSection's Bin
// export/import screens — and isn't sync-specific). iOS: prefers the share sheet (straight to Files
// / AirDrop) when the browser supports it, falls back to a throwaway anchor click otherwise.
export const download = async (content: string, name: string, type = "text/plain"): Promise<boolean> => {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
    }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return true;
};
