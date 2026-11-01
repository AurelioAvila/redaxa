// Redaxa for Linux waitlist (linux.html). Posts to the mailing list Redaxa
// shares with PC Tweaker, tagged "redaxa-linux"; that API allows this origin
// on /api/newsletter only. `company` is the honeypot the API checks.
const form = document.getElementById("linux-waitlist");
const status = document.getElementById("waitlist-status");
const email = document.getElementById("waitlist-email");
const say = (message, error = false) => {
  status.textContent = message;
  status.classList.toggle("error", error);
  email.setAttribute("aria-invalid", String(error));
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!email.checkValidity()) {
    say("Enter a valid email address, such as name@example.com.", true);
    email.focus();
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  say("Sending…");
  try {
    const res = await fetch("https://api.pctweaker.app/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value.trim(), source: "redaxa-linux", company: form.company.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "We could not add you to the waitlist. Please try again.");
    form.replaceChildren(status);
    say("You're on the waitlist. We'll email you when Redaxa for Linux is ready.");
  } catch (error) {
    say(error instanceof TypeError ? "We could not reach the waitlist. Check your connection and try again." : error.message, true);
    button.disabled = false;
  }
});
