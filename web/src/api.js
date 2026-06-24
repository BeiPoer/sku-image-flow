// 统一的 API 请求层：自动解析 JSON，失败时抛出后端给的 error 文案。
export async function api(path, options = {}) {
  const res = await fetch(path, options);
  const contentType = res.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await res.json().catch(() => null);
  }
  if (!res.ok) {
    const message = (payload && payload.error) || `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return payload;
}

// 把后端文件路径转成可访问的 URL（产品图 / 候选图）。
export function fileUrl(filePath) {
  return "/api/file?path=" + encodeURIComponent(filePath);
}
