export const themes = [
  {code:"violet",label:"Ink & Violet"},
  {code:"paper",label:"Paper (light)"},
  {code:"graphite",label:"Petrol & Copper"},
  {code:"carbon",label:"Carbon & Mint"},
  {code:"ice",label:"Ice blue"}, {code:"amber",label:"Amber"},
  {code:"coral",label:"Copper"}, {code:"gold",label:"Gold"},
  {code:"lime",label:"Lime"}, {code:"emerald",label:"Emerald"},
  {code:"teal",label:"Teal"}, {code:"ocean",label:"Ocean"},
  {code:"crimson",label:"Ruby"}, {code:"slate",label:"Monochrome"}
] as const;
export type ThemeName = typeof themes[number]["code"];
// Lock Pup's own violet. Only people who never picked a palette get it: a
// saved choice, including the earlier Petrol & Copper default, is kept.
export const defaultTheme: ThemeName = "violet";
export function applyTheme(code: string): void {
  document.documentElement.dataset.theme = themes.some(theme => theme.code === code) ? code : defaultTheme;
}
export function restoreTheme(): void {
  try {
    const key = "redaxa.personal-preferences.v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    // A new default must never overwrite a palette someone already chose.
    applyTheme(saved?.theme ?? defaultTheme);
  } catch { applyTheme(defaultTheme); }
}
