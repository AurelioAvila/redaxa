export const themes = [
  {code:"ice",label:"Ice blue"}, {code:"amber",label:"Amber"},
  {code:"coral",label:"Copper"}, {code:"gold",label:"Gold"},
  {code:"lime",label:"Lime"}, {code:"emerald",label:"Emerald"},
  {code:"teal",label:"Teal"}, {code:"ocean",label:"Ocean"},
  {code:"crimson",label:"Ruby"}, {code:"slate",label:"Monochrome"}
] as const;
export type ThemeName = typeof themes[number]["code"];
export function applyTheme(code: string): void {
  document.documentElement.dataset.theme = themes.some(theme => theme.code === code) ? code : "ocean";
}
export function restoreTheme(): void {
  try {
    const key = "redaxa.personal-preferences.v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    // One-time palette migration; subsequent user selections remain unchanged.
    if (localStorage.getItem("redaxa.ocean-default.v1") !== "1") {
      saved.theme = "ocean";
      localStorage.setItem(key, JSON.stringify(saved));
      localStorage.setItem("redaxa.ocean-default.v1", "1");
    }
    applyTheme(saved.theme ?? "ocean");
  } catch { applyTheme("ocean"); }
}
