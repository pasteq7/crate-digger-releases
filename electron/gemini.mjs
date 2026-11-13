import { aiJson } from "./ai-http.mjs";

export const defaultGeminiModel = "gemini-3.8-flash";

export function geminiRequest(model, prompt, key) {
  const name = (model || defaultGeminiModel).trim().replace(/^models\//, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("Enter a Gemini model name, such as gemini-3.8-flash.");
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`,
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key.trim(),
    },
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024 },
    },
  };
}

export async function geminiModels(key) {
  const models = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({
      pageSize: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await aiJson(
      `https://generativelanguage.googleapis.com/v1beta/models?${query}`,
      {
        headers: { "x-goog-api-key": key.trim() },
      },
      "gemini",
    );
    for (const model of data.models || []) {
      if (
        model.name?.startsWith("models/gemini-") &&
        model.supportedGenerationMethods?.includes("generateContent") &&
        !/image|tts|live|audio|robot|embedding/i.test(model.name)
      ) {
        models.push(model.name.slice(7));
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return [...new Set(models)].sort();
}

export function geminiText(data, maxLength = 600) {
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error(
      "Google Gemini returned no explanation. Try again or choose another model in Settings.",
    );
  }
  return text.slice(0, maxLength);
}
