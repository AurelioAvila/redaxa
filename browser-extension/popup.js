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

document.getElementById("sign-out").addEventListener("click", async () => {
  await send({ type: "SIGN_OUT" });
  await render();
});

void render();
