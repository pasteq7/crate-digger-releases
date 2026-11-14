export function soundcloudUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return null;
    if (
      u.hostname === "on.soundcloud.com" &&
      /^\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)
    )
      return `https://on.soundcloud.com${u.pathname.replace(/\/$/, "")}`;
    if (
      !["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(
        u.hostname,
      )
    )
      return null;
    const parts = u.pathname.replace(/\/$/, "").split("/").slice(1);
    if (
      !parts.every((part) => /^[a-zA-Z0-9_-]+$/.test(part)) ||
      !(
        (parts.length === 2 && parts[1] !== "sets") ||
        (parts.length === 3 && parts[1] === "sets")
      )
    )
      return null;
    if (
      [
        "search",
        "discover",
        "you",
        "settings",
        "upload",
        "pages",
        "terms-of-use",
        "oauth",
        "connect",
      ].includes(parts[0])
    )
      return null;
    return `https://soundcloud.com/${parts.join("/")}`;
  } catch {
    return null;
  }
}
export function soundcloudSearchUrl(artist, title = "") {
  return `https://soundcloud.com/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}`;
}
