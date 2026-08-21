# PromptShield 0.1.9 — the privacy control layer

PromptShield grows from a scanner into a control layer: organizations, shared policies, explainable decisions, and a metadata-first audit trail.

- **Organizations.** Business workspaces are now real organizations with owner/admin/member roles. Accepting a team invite joins the workspace automatically.
- **Shared protected terms.** An admin protects a term once — a project codename, a client name — and every member's checks flag it, on every device and surface.
- **Organization policies.** Per category (credentials, financial, personal, protected terms) an admin chooses Warn, Redact or **Block**. Block removes "Send anyway" in the browser extension: the prompt does not leave until it is fixed.
- **Explainable decisions.** Every scan now returns the rule that decided and a human-written reason, shown in the dashboard results, the extension panel, and the send-interception modal.
- **Audit trail, metadata only.** Every check leaves an event — surface, detection kinds, decision — never the prompt, never a value, by table design. Your activity (all devices) and organization activity (owners/admins) are visible in the dashboard.
- **Desktop auto-update.** The desktop app now checks for signed updates at startup and installs them with one click.
- Landing: an always-visible Dashboard link.

Nothing about the core promise changed: prompts are scanned and discarded. The audit trail cannot contain content because its table has no column to put it in.
