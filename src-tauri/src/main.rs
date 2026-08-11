// PromptShield is a graphical Windows app: never open a companion console.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    promptshield_desktop_lib::run();
}
