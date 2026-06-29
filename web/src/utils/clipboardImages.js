export function imageFilesFromClipboard(clipboardData) {
  const files = [];
  const items = Array.from(clipboardData?.items || []);

  for (const item of items) {
    if (item.kind === "file" && (item.type || "").startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  if (!files.length) {
    for (const file of Array.from(clipboardData?.files || [])) {
      if ((file.type || "").startsWith("image/")) files.push(file);
    }
  }

  return files;
}

export function isEditablePasteTarget(target) {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}
