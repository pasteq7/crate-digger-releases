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

function canceled() {
  return new DOMException("AI request was canceled.", "AbortError");
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(canceled());
    const abort = () => {
      clearTimeout(timer);
      reject(canceled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function aiJson(
  url,
  options,
  provider,
  {
    onAttempt = () => {},
    onRetry = () => {},
    onResponse = () => {},
    sleep = pause,
    random = Math.random,
  } = {},
) {
  const key =
    options.headers?.["x-goog-api-key"] ||
    options.headers?.Authorization?.replace(/^Bearer /, "") ||
    "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (options.signal?.aborted) throw canceled();
    onAttempt(attempt);
    let response,
      data,
      failure,
      transient = false;
    try {
      response = await fetch(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)])
          : AbortSignal.timeout(45000),
      });
      data = await response.json().catch(() => null);
      if (options.signal?.aborted) throw canceled();
      if (!response.ok) {
        failure = new Error(
          aiErrorMessage(provider, response.status, data, key),
        );
        transient =
          [408, 425, 429].includes(response.status) || response.status >= 500;
      } else if (!data) {
        failure = new Error(
          `${labels[provider] || "AI provider"} returned an unreadable response. Try again.`,
        );
        transient = true;
      }
    } catch (error) {
      if (options.signal?.aborted) throw canceled();
      const label = labels[provider] || "AI provider";
      failure = new Error(
        ["TimeoutError", "AbortError"].includes(error.name)
          ? `${label} timed out. Try again shortly.`
          : `Couldn't reach ${label}. Check your internet connection${provider === "ollama" ? " and whether Ollama is running" : ""}.`,
      );
      transient = true;
    }
    onResponse(data, attempt);
    if (!failure) return data;
    if (!transient || attempt === 3) throw failure;
    const retryAfter = response?.headers?.get("retry-after");
    const seconds =
      retryAfter && /^\d+(\.\d+)?$/.test(retryAfter.trim())
        ? Number(retryAfter) * 1000
        : Date.parse(retryAfter || "") - Date.now();
    const delay = Math.min(
      60000,
      Math.max(
        1000 * 2 ** (attempt - 1) + random() * 250,
        Number.isFinite(seconds) ? seconds : 0,
      ),
    );
    onRetry({ attempt, delay, message: failure.message });
    await sleep(delay, options.signal);
  }
}
