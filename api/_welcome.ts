import { appUrl, markWelcomed, type AuthUser } from "./_billing.js";
import { sendWelcomeEmail } from "./_email.js";

const WELCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Best-effort on confirmation and the next sign-in if the first send failed. */
export async function welcomeOnce(user: AuthUser): Promise<void> {
  try {
    if (!user.emailConfirmedAt || user.metadata?.welcomed_at) return;
    const createdAt = user.createdAt ? Date.parse(user.createdAt) : NaN;
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > WELCOME_WINDOW_MS) return;

    // The same payload and user-scoped key prevent duplicate sends when two
    // confirmation/sign-in requests race. Mark only after Resend accepts it.
    const sent = await sendWelcomeEmail(user.email, null, appUrl(), user.id);
    if (!sent) { console.error("redaxa welcome not sent"); return; }
    await markWelcomed(user.id, user.metadata);
  } catch (error) {
    console.error("redaxa welcome failed", String(error).slice(0, 300));
  }
}
