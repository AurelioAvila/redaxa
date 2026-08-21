const statusBox = document.getElementById("status");
const formBox = document.getElementById("form");
const statusEmail = document.getElementById("status-email");
const msg = document.getElementById("msg");

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (!response) { reject(new Error("No response from PromptShield background.")); return; }
      if (!response.ok) { reject(new Error(response.error)); return; }
      resolve(response.result);
    });
  });
}

async function render() {
  const status = await send({ type: "STATUS" }).catch(() => ({ signedIn: false }));
  if (status.signedIn) {
    statusBox.classList.add("show");
    formBox.classList.remove("show");
    statusEmail.textContent = status.email;
    // Honest state: "Active" only with a live trial/subscription — otherwise
    // say what's missing instead of showing a green light that isn't true.
    const pillText = document.getElementById("status-pill-text");
    const pillDot = document.querySelector("#status-pill i");
    if (status.active) {
      pillText.textContent = "Protection active";
      pillDot.style.background = "var(--accent)";
    } else {
      pillText.textContent = "Plan required";
      pillDot.style.background = "#ff9d8a";
    }
  } else {
    statusBox.classList.remove("show");
    formBox.classList.add("show");
  }
}

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  msg.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await send({ type: "SIGN_IN", email, password });
    await render();
  } catch (error) {
    msg.textContent = error.message || "Sign-in failed.";
  }
});

document.getElementById("open-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});

document.getElementById("sign-out").addEventListener("click", async () => {
  await send({ type: "SIGN_OUT" });
  await render();
});

// The popup is 280px wide -- no room for a real signup/recovery form, so
// hand those off to the hosted dashboard, which already has the full flow
// (name/DOB fields, password confirmation, email verification, reset links).
const DASHBOARD_URL = "https://promptshield-beta.vercel.app/dashboard.html";

document.getElementById("create-account").addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}?auth=signup` });
});

document.getElementById("forgot-password").addEventListener("click", () => {
  chrome.tabs.create({ url: `${DASHBOARD_URL}?auth=recovery` });
});

void render();
