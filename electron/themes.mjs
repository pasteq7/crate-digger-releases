// Shared data and validation: themes never contain executable CSS.
export const themeTokens = [
  "background",
  "sidebar",
  "surface",
  "elevated",
  "text",
  "muted",
  "border",
  "accent",
  "onAccent",
];
const preset = (id, name, mode, colors) => ({
  id,
  name,
  mode,
  ...Object.fromEntries(themeTokens.map((key, i) => [key, colors[i]])),
});
export const themePresets = [
  preset("sage", "Sage", "dark", [
    "#181a18",
    "#121412",
    "#222620",
    "#2c3129",
    "#edefe8",
    "#b0b5a9",
    "#353b32",
    "#c5d1b1",
    "#20251b",
  ]),
  preset("ink", "Ink", "dark", [
    "#171b22",
    "#11151b",
    "#202733",
    "#2b3543",
    "#edf1f6",
    "#abb6c5",
    "#343f4e",
    "#9fbce0",
    "#182330",
  ]),
  preset("plum", "Plum", "dark", [
    "#1e1920",
    "#151116",
    "#2a222d",
    "#362c3b",
    "#f2eaf1",
    "#bcacbd",
    "#48394a",
    "#c8a6cc",
    "#2b1c2d",
  ]),
  preset("ember", "Ember", "dark", [
    "#201a17",
    "#17120f",
    "#2c2420",
    "#392e27",
    "#f4ece6",
    "#bcaea3",
    "#4a3b32",
    "#d6a17e",
    "#2c1e15",
  ]),
  preset("paper", "Paper", "light", [
    "#f4f1e9",
    "#e9e5dc",
    "#fdfbf7",
    "#e7e2d8",
    "#272922",
    "#626359",
    "#cccbbf",
    "#a34f3d",
    "#ffffff",
  ]),
  preset("mono", "Mono", "dark", [
    "#181818",
    "#101010",
    "#242424",
    "#303030",
    "#f2f2f2",
    "#b0b0b0",
    "#3b3b3b",
    "#d6d6d6",
    "#1a1a1a",
  ]),
];
const hex = /^#[a-f\d]{6}$/i;
const rgb = (color) =>
  color
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16));
export function contrast(a, b) {
  const light = (color) =>
    rgb(color)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = light(a),
    y = light(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mix(a, b, amount) {
  return (
    "#" +
    rgb(a)
      .map((v, i) =>
        Math.round(v * (1 - amount) + rgb(b)[i] * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function deriveTheme({
  background,
  surface,
  accent,
  name = "My palette",
  id = "custom",
}) {
  if (
    ![background, surface, accent].every(
      (v) => typeof v === "string" && hex.test(v),
    )
  )
    throw new Error("Use six-digit hex colors, such as #181a18.");
  const text =
    contrast(background, "#f5f5f5") >= contrast(background, "#171717")
      ? "#f5f5f5"
      : "#171717";
  const mode = text === "#f5f5f5" ? "dark" : "light";
  const sidebar = mix(
    background,
    mode === "dark" ? "#000000" : "#171717",
    0.12,
  );
  const elevated = mix(surface, text, 0.045);
  const onAccent =
    contrast(accent, "#171717") >= contrast(accent, "#ffffff")
      ? "#171717"
      : "#ffffff";
  let muted = mix(text, background, 0.25);
  if (
    [background, sidebar, surface, elevated].some(
      (bg) => contrast(muted, bg) < 4.5,
    )
  )
    muted = text;
  return validateTheme({
    id,
    name,
    mode,
    background,
    sidebar,
    surface,
    elevated,
    text,
    muted,
    border: mix(background, text, 0.2),
    accent,
    onAccent,
  });
}
export function validateTheme(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !/^[a-z\d-]{1,80}$/.test(value.id) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 60 ||
    !["dark", "light"].includes(value.mode)
  )
    throw new Error("Invalid palette name or identity.");
  for (const key of themeTokens)
    if (typeof value[key] !== "string" || !hex.test(value[key]))
      throw new Error(`Invalid ${key} color. Use #RRGGBB.`);
  for (const fg of ["text", "muted"])
    for (const bg of ["background", "sidebar", "surface", "elevated"])
      if (contrast(value[fg], value[bg]) < 4.5)
        throw new Error(
          `${fg === "text" ? "Text" : "Secondary text"} needs more contrast against ${bg}. Choose a lighter or darker surface.`,
        );
  if (contrast(value.onAccent, value.accent) < 4.5)
    throw new Error("Button text needs more contrast against the accent.");
  if (
    contrast(value.accent, value.background) < 3 ||
    contrast(value.accent, value.surface) < 3
  )
    throw new Error(
      "The accent needs more contrast against the background and surface for focus indicators.",
    );
  return {
    id: value.id,
    name: value.name.trim(),
    mode: value.mode,
    ...Object.fromEntries(
      themeTokens.map((key) => [key, value[key].toLowerCase()]),
    ),
  };
}
export function validateAppearance(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.palette !== "string" ||
    !Array.isArray(value.custom) ||
    value.custom.length > 30 ||
    typeof value.followSystem !== "boolean"
  )
    throw new Error("Invalid appearance preferences.");
  const custom = value.custom.map(validateTheme);
  const ids = [...themePresets, ...custom].map((p) => p.id);
  if (new Set(ids).size !== ids.length || !ids.includes(value.palette))
    throw new Error("Select an existing palette with a unique identity.");
  const darkPalette = value.darkPalette || "sage",
    lightPalette = value.lightPalette || "paper";
  if (
    ![...themePresets, ...custom].some(
      (p) => p.id === darkPalette && p.mode === "dark",
    ) ||
    ![...themePresets, ...custom].some(
      (p) => p.id === lightPalette && p.mode === "light",
    )
  )
    throw new Error("Select one dark and one light system palette.");
  return {
    palette: value.palette,
    custom,
    followSystem: value.followSystem,
    darkPalette,
    lightPalette,
  };
}
