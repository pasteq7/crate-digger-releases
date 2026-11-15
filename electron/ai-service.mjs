import { aiJson } from "./ai-http.mjs";
import { defaultGeminiModel, geminiRequest, geminiText } from "./gemini.mjs";

export class AiService {
  constructor(settings, key, activity) {
    this.settings = settings;
    this.key = key;
    this.activity = activity;
  }
  async generate(
    prompt,
    {
      schema,
      signal,
      maxTokens = 8192,
      purpose = "Generate AI response",
      validate,
      describe = (text) => text.slice(0, 600),
    } = {},
  ) {
    const s = this.settings();
    if (s.ai === "none")
      throw new Error("Choose an AI provider in Settings to use AI discovery.");
    let url,
      body,
      headers = { "Content-Type": "application/json" };
    if (s.ai === "ollama") {
      const base = new URL(s.aiEndpoint);
      if (
        base.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      )
        throw new Error("Use a local Ollama address in Settings.");
      url = new URL("/api/generate", base);
      body = {
        model: s.aiModel,
        prompt,
        stream: false,
        ...(schema ? { format: schema } : {}),
        options: { num_predict: maxTokens },
      };
    } else {
      const key = this.key(s.ai);
      if (!key)
        throw new Error(
          `Add your ${s.ai === "gemini" ? "Google Gemini" : "OpenAI"} API key in Settings first.`,
        );
      if (s.ai === "gemini") {
        ({ url, body, headers } = geminiRequest(s.aiModel, prompt, key));
        body.generationConfig.maxOutputTokens = maxTokens;
        if (schema)
          Object.assign(body.generationConfig, {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
          });
      } else {
        url = "https://api.openai.com/v1/chat/completions";
        headers.Authorization = `Bearer ${key.trim()}`;
        body = {
          model: s.aiModel || "gpt-4.1-mini",
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: maxTokens,
          store: false,
          ...(schema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "album_discovery",
                    strict: true,
                    schema,
                  },
                },
              }
            : {}),
        };
      }
    }
    const read = (data) => {
      const text =
        s.ai === "gemini"
          ? geminiText(data, 120000)
          : data.response || data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim())
        throw new Error(
          "The AI returned no suggestions. Try another model in Settings.",
        );
      const result = text.slice(0, 120000);
      validate?.(result);
      return result;
    };
    const args = [
      url,
      { method: "POST", headers, body: JSON.stringify(body), signal },
      s.ai,
    ];
    return this.activity
      ? this.activity.request(...args, {
          purpose,
          model:
            body.model ||
            s.aiModel?.trim().replace(/^models\//, "") ||
            defaultGeminiModel,
          read,
          describe,
        })
      : read(await aiJson(...args));
  }
}
