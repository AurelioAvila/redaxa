export const themes = [
  {code:"paper",label:"Paper"},
  {code:"ink",label:"Ink & Copper"},
  {code:"graphite",label:"Petrol & Copper"},
  {code:"carbon",label:"Carbon & Mint"},
  {code:"ice",label:"Ice blue"}, {code:"amber",label:"Amber"},
  {code:"coral",label:"Copper"}, {code:"gold",label:"Gold"},
  {code:"lime",label:"Lime"}, {code:"emerald",label:"Emerald"},
  {code:"teal",label:"Teal"}, {code:"ocean",label:"Ocean"},
  {code:"crimson",label:"Ruby"}, {code:"slate",label:"Monochrome"}
] as const;
export type ThemeName = typeof themes[number]["code"];
// Light Paper for everyone who never picked a palette.
export const defaultTheme: ThemeName = "paper";
// Before 0.5.1 every saved preference carried the theme, so the default of the
// time (Petrol & Copper) was written for people who never chose it. Only a
// click on a theme sets themeChosen; without it, that old default means
// "never chose" and becomes Paper. Any other saved palette was a real choice.
export const legacyDefaultTheme = "graphite";
export function chosenTheme(saved: unknown): ThemeName {
  const record = typeof saved === "object" && saved !== null ? saved as { theme?: unknown; themeChosen?: unknown } : {};
  const theme = themes.find((candidate) => candidate.code === record.theme)?.code;
  if (!theme || (theme === legacyDefaultTheme && record.themeChosen !== true)) return defaultTheme;
  return theme;
}
export function applyTheme(code: string): void {
  document.documentElement.dataset.theme = themes.some(theme => theme.code === code) ? code : defaultTheme;
}
export function restoreTheme(): void {
  try {
    const key = "redaxa.personal-preferences.v1";
    // A new default must never overwrite a palette someone actually chose.
    applyTheme(chosenTheme(JSON.parse(localStorage.getItem(key) ?? "{}")));
  } catch { applyTheme(defaultTheme); }
}
