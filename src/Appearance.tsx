import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Palette as PaletteIcon,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  themePresets,
  deriveTheme,
  validateTheme,
  mix,
} from "../electron/themes.mjs";
import type { Appearance, Palette, Settings, SettingsUpdate } from "./types";

export const defaultAppearance: Appearance = {
  palette: "sage",
  custom: [],
  followSystem: false,
  darkPalette: "sage",
  lightPalette: "paper",
};
let palettePreview: Palette | null = null;
export function paletteFor(
  settings: Settings,
  dark = matchMedia("(prefers-color-scheme: dark)").matches,
): Palette {
  const value = settings.appearance || {
    ...defaultAppearance,
    palette: settings.theme === "light" ? "paper" : "sage",
  };
  const id = value.followSystem
    ? dark
      ? value.darkPalette || "sage"
      : value.lightPalette || "paper"
    : value.palette;
  return (
    [...themePresets, ...value.custom].find((p: Palette) => p.id === id) ||
    themePresets[0]
  );
}
export function applyPalette(palette: Palette) {
  const root = document.documentElement;
  root.dataset.theme = palette.mode;
  root.dataset.palette = palette.id;
  root.style.colorScheme = palette.mode;
  const variables: Record<string, string> = {
    bg: palette.background,
    sidebar: palette.sidebar,
    panel: palette.surface,
    "panel-hover": palette.elevated,
    border: palette.border,
    text: palette.text,
    muted: palette.muted,
    subtle: palette.muted,
    accent: palette.accent,
    "accent-ink": palette.onAccent,
    "accent-bg": mix(
      palette.background,
      palette.accent,
      palette.mode === "dark" ? 0.14 : 0.1,
    ),
    player: palette.surface,
    hover: palette.elevated,
    soft: palette.muted,
    hero: "transparent",
  };
  for (const [key, color] of Object.entries(variables))
    root.style.setProperty(`--${key}`, color);
  void window.crate
    ?.chromeTheme({ background: palette.background, text: palette.text })
    .catch(() => {});
}
export function useAppearance(settings: Settings) {
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      applyPalette(palettePreview || paletteFor(settings, system.matches));
    document.documentElement.dataset.density =
      settings.density || "comfortable";
    document.documentElement.style.setProperty(
      "--font-scale",
      String((settings.fontScale || 100) / 100),
    );
    document.documentElement.style.setProperty(
      "--player-height",
      `${Math.round(86 * Math.max(1, (settings.fontScale || 100) / 100))}px`,
    );
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [
    settings.appearance,
    settings.theme,
    settings.density,
    settings.fontScale,
  ]);
}
export default function AppearanceSettings({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (value: SettingsUpdate) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Appearance>(
    () =>
      settings.appearance || {
        ...defaultAppearance,
        palette: settings.theme === "light" ? "paper" : "sage",
      },
  );
  const [editor, setEditor] = useState<Palette | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saved = useRef(settings);
  saved.current = settings;
  const input = useRef<HTMLInputElement>(null);
  const all = [...themePresets, ...draft.custom] as Palette[];
  const selected = all.find((p) => p.id === draft.palette) || all[0];
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(
      settings.appearance || {
        ...defaultAppearance,
        palette: settings.theme === "light" ? "paper" : "sage",
      },
    );
  useEffect(() => {
    palettePreview = dirty
      ? paletteFor({ ...settings, appearance: draft })
      : null;
    applyPalette(palettePreview || paletteFor(settings));
  }, [draft, dirty]);
  useEffect(
    () => () => {
      palettePreview = null;
      applyPalette(paletteFor(saved.current));
    },
    [],
  );
  function customize(palette: Palette, duplicate = false) {
    setEditor({
      ...palette,
      id:
        duplicate || themePresets.some((p: Palette) => p.id === palette.id)
          ? `custom-${crypto.randomUUID()}`
          : palette.id,
      name:
        duplicate || themePresets.some((p: Palette) => p.id === palette.id)
          ? `${palette.name} custom`
          : palette.name,
    });
    setError("");
  }
  function saveCustom() {
    try {
      const palette = validateTheme(editor) as Palette;
      const custom = [
        ...draft.custom.filter((p) => p.id !== palette.id),
        palette,
      ];
      if (custom.length > 30)
        throw new Error(
          "Keep up to 30 custom palettes. Remove one before adding another.",
        );
      setDraft({ ...draft, custom, palette: palette.id, followSystem: false });
      setEditor(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="appearance-settings" aria-label="Appearance">
      <div className="settings-section-heading">
        <div>
          <h2>Appearance</h2>
          <p>Quiet Collection, in your colors.</p>
        </div>
        <PaletteIcon size={20} />
      </div>
      <div className="palette-grid">
        {all.map((palette) => (
          <button
            key={palette.id}
            type="button"
            className={`palette-card ${draft.palette === palette.id ? "selected" : ""}`}
            aria-pressed={draft.palette === palette.id}
            onClick={() => {
              setDraft({ ...draft, palette: palette.id, followSystem: false });
              setMessage("");
            }}
          >
            <span
              className="palette-preview"
              style={{
                background: palette.background,
                color: palette.text,
                borderColor: palette.border,
              }}
            >
              <i style={{ background: palette.sidebar }} />
              <span>
                <b style={{ background: palette.accent }} />
                <em style={{ background: palette.surface }} />
                <em style={{ background: palette.elevated }} />
              </span>
            </span>
            <span>
              {palette.name}
              {draft.palette === palette.id && <Check size={14} />}
            </span>
          </button>
        ))}
      </div>
      <div className="palette-actions">
        <button
          className="secondary-button"
          onClick={() => customize(selected)}
        >
          <Plus size={14} /> Customize
        </button>
        <button
          className="text-button"
          onClick={() => customize(selected, true)}
        >
          <Copy size={14} /> Duplicate
        </button>
        <button className="text-button" onClick={() => input.current?.click()}>
          <Upload size={14} /> Import palette
        </button>
        <button
          className="text-button"
          onClick={() => {
            const blob = new Blob(
              [JSON.stringify({ version: 1, palette: selected }, null, 2)],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${selected.name.replace(/[^a-z\d-]/gi, "-")}.palette.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={14} /> Export
        </button>
        {!themePresets.some((p: Palette) => p.id === selected.id) && (
          <button
            className="text-button"
            onClick={() =>
              setDraft({
                ...draft,
                palette: "sage",
                custom: draft.custom.filter((p) => p.id !== selected.id),
                darkPalette:
                  draft.darkPalette === selected.id
                    ? "sage"
                    : draft.darkPalette,
                lightPalette:
                  draft.lightPalette === selected.id
                    ? "paper"
                    : draft.lightPalette,
              })
            }
          >
            <Trash2 size={14} /> Delete custom
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > 64000)
              throw new Error("Palette files must be smaller than 64 KB.");
            const data = JSON.parse(await file.text());
            if (data.version !== 1)
              throw new Error("Unsupported palette format.");
            const palette = validateTheme({
              ...data.palette,
              id: `custom-${crypto.randomUUID()}`,
            }) as Palette;
            if (draft.custom.length >= 30)
              throw new Error(
                "Remove a custom palette before importing another.",
              );
            setDraft({
              ...draft,
              custom: [...draft.custom, palette],
              palette: palette.id,
              followSystem: false,
            });
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {editor && (
        <div className="palette-editor">
          <label>
            Palette name
            <input
              value={editor.name}
              maxLength={60}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </label>
          <div className="color-fields">
            {(["background", "surface", "accent"] as const).map((key) => (
              <label key={key}>
                {key[0].toUpperCase() + key.slice(1)}
                <input
                  type="color"
                  aria-label={`${key} color`}
                  value={editor[key]}
                  onChange={(e) => {
                    try {
                      setEditor(
                        deriveTheme({ ...editor, [key]: e.target.value }),
                      );
                      setError("");
                    } catch (err) {
                      setEditor({ ...editor, [key]: e.target.value });
                      setError((err as Error).message);
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <details>
            <summary>Advanced color overrides</summary>
            <div className="color-fields">
              {(
                [
                  "sidebar",
                  "elevated",
                  "text",
                  "muted",
                  "border",
                  "onAccent",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    type="color"
                    value={editor[key]}
                    onChange={(e) =>
                      setEditor({ ...editor, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="palette-actions">
            <button className="secondary-button" onClick={saveCustom}>
              Save palette
            </button>
            <button
              className="text-button"
              onClick={() => {
                setEditor(null);
                setError("");
              }}
            >
              Cancel edit
            </button>
          </div>
        </div>
      )}
      <label className="setting-row">
        <span>
          <strong>Follow Windows appearance</strong>
          <small>Choose which palette to use for each system mode.</small>
        </span>
        <input
          type="checkbox"
          checked={draft.followSystem}
          onChange={(e) =>
            setDraft({ ...draft, followSystem: e.target.checked })
          }
        />
      </label>
      {draft.followSystem && (
        <div className="system-palettes">
          {(["dark", "light"] as const).map((mode) => (
            <label key={mode}>
              {mode === "dark" ? "Dark" : "Light"} palette
              <select
                value={
                  mode === "dark"
                    ? draft.darkPalette || "sage"
                    : draft.lightPalette || "paper"
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [mode === "dark" ? "darkPalette" : "lightPalette"]:
                      e.target.value,
                  })
                }
              >
                {all
                  .filter((p) => p.mode === mode)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {dirty && (
        <div className="appearance-apply">
          <span>Previewing · not applied yet</span>
          <button
            className="primary-button"
            disabled={saving || !!editor}
            onClick={async () => {
              setSaving(true);
              try {
                if (await onSave({ appearance: draft }))
                  setMessage("Appearance saved");
              } finally {
                setSaving(false);
              }
            }}
          >
            Apply appearance
          </button>
          <button
            className="text-button"
            onClick={() => {
              setDraft(saved.current.appearance || defaultAppearance);
              setEditor(null);
              setError("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <button
        className="text-button"
        onClick={() => {
          setDraft({ ...draft, palette: "sage", followSystem: false });
          setEditor(null);
        }}
      >
        <RotateCcw size={14} /> Reset to Sage
      </button>
    </section>
  );
}
