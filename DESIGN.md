# Redaxa workspace design — fourth proposal

Status: local preview, user approval pending. Earlier graphite, ivory/purple and horizontal night-blue proposals were rejected. The user explicitly excludes ivory and purple, dislikes the detached top navigation and typography, and wants profile photos comparable to PC Tweaker.

Operate mode. A continuous slate workspace (#141a22) contains a compact 176px navigation rail and the working surface. No separate horizontal header bar. Muted blue actions (#b6cfff), panels #1c2530, text #edf1f7 and secondary text #abb8cb. Locally bundled Inter variable gives controls, headings and prose one consistent type system; titles use moderate weight rather than heavy display lettering. The existing logo remains grayscale in the workspace.

The prompt editor leads at normal window size, with results below; wide windows can place them alongside. The repository route shares navigation and typography. Account menu is compact with direct actions. Profile photo accepts JPG/PNG/WebP up to 5 MB, center crops to a 256px JPEG, strips metadata through re-encoding, and persists locally under a hash of the signed-in email. Change/remove actions work; photos are not uploaded or synchronized. Initials are the fallback.

Native window stays 960 × 680, minimum 720 × 520. At narrow web widths navigation wraps above content. Preserve authentication, verified plan state, Pro gating, API priority/alerts, explicit reveal, secret-free exports, scope disclosure and local scanner behavior. Do not claim full vulnerability coverage or valid API keys based on matches.

Development account routing uses the existing guarded loopback proxy on any development port, including 4190; packaged desktop and browser authentication routing are unchanged. The local account debug flag logs only HTTP status and whether a structured account state was returned, never identities or tokens.

No commit or distribution before user review. Public marketing layout remains outside this revision.

## Integrated window and full palettes
The user's reference to the top bar meant the operating-system title bar, not workspace navigation. Native decorations are now disabled and a themed 34px title bar provides drag, minimize, maximize/restore and close using Tauri window commands. Browser pages do not show these controls.

Theme behavior follows PC Tweaker's site (site/src/theme.tsx): page, panels, text, hairlines and accent share semantic tokens. Ten full palettes exclude ivory and purple. The picker uses a single solid dot and readable name per palette; no diagonal split swatches. Selection persists across prompt/repository routes. Shared themes.css is packaged with both desktop and web.
