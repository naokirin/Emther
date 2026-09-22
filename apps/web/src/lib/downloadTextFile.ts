/** テキストをブラウザでダウンロードさせる。失敗時は false。 */
export function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = "text/plain;charset=utf-8",
): boolean {
  try {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/** emther-suggestions-YYYYMMDD-HHmmss.ext */
export function suggestionExportFileName(ext: "csv" | "md", now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `emther-suggestions-${stamp}.${ext}`;
}
