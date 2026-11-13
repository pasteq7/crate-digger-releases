const labels = { gemini: "Google Gemini", openai: "OpenAI", ollama: "Ollama" };

export function aiErrorMessage(provider, status, data, key = "") {
  const label = labels[provider] || "AI provider";
  let detail =
    data?.error?.message || (typeof data?.error === "string" ? data.error : "");
  if (typeof detail !== "string") detail = "";
  for (const secret of [key, key.trim(), encodeURIComponent(key)].filter(
    Boolean,
  )) {
    detail = detail.replaceAll(secret, "[redacted]");
  }
  detail = detail
    .replace(/AIza[\w-]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [redacted]");
  detail = detail.replace(/\s+/g, " ").trim().slice(0, 650);
  let action;
  if (
    status === 401 ||
    /API_KEY_INVALID|API key not valid|invalid.*api.*key/i.test(
      JSON.stringify(data?.error?.details || []) + detail,
    )
  ) {
    action = `The API key was rejected. Replace your ${label} key in Settings.`;
  } else if (status === 403) {
    action =
      "Access was denied. Check the key's project permissions, API restrictions, and model access.";
  } else if (status === 404) {
    action =
      provider === "gemini"
        ? "That model is unavailable for this key. Use Check connection in Settings and select an available model."
        : "That model was not found. Check its name in Settings.";
  } else if (status === 429) {
    action =
      "The request hit a rate or quota limit. Check your provider's quota and usage before retrying.";
  } else if (status === 402) {
    action =
      "The provider requires available credits. Check your provider account.";
  } else if (status >= 500) {
    action = "The provider is temporarily unavailable. Try again shortly.";
  } else {
    action =
      "The request was rejected. Check the selected model and provider settings.";
  }
  return `${label} (HTTP ${status}): ${action}${detail ? ` ${detail}` : ""}`;
}

export async function aiJson(url, options, provider) {
  const key =
    options.headers?.["x-goog-api-key"] ||
    options.headers?.Authorization?.replace(/^Bearer /, "") ||
    "";
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(45000),
    });
  } catch (error) {
    const label = labels[provider] || "AI provider";
    throw new Error(
      ["TimeoutError", "AbortError"].includes(error.name)
        ? `${label} timed out. Try again shortly.`
        : `Couldn't reach ${label}. Check your internet connection${provider === "ollama" ? " and whether Ollama is running" : ""}.`,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(aiErrorMessage(provider, response.status, data, key));
  if (!data)
    throw new Error(
      `${labels[provider] || "AI provider"} returned an unreadable response. Try again.`,
    );
  return data;
}
