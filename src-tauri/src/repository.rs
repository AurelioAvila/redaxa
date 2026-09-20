use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, process::{ChildStdin, Command, Stdio}, sync::{Arc, Mutex}};
use tauri::Manager;

#[derive(Default)]
pub struct EngineState {
    running: bool,
    cancelled: bool,
    input: Option<ChildStdin>,
    progress: Value,
}
pub type RepositoryState = Arc<Mutex<EngineState>>;

#[tauri::command]
pub fn repository_progress(state: tauri::State<'_, RepositoryState>) -> Result<Value, String> {
    state.lock().map(|s| s.progress.clone()).map_err(|_| "Scanner unavailable".into())
}

pub fn cancel(state: &RepositoryState) {
    if let Ok(mut s) = state.lock() {
        s.cancelled = true;
        if let Some(input) = s.input.as_mut() { let _ = input.write_all(b"{\"type\":\"cancel\"}\n"); let _ = input.flush(); }
    }
}

#[tauri::command]
pub fn repository_cancel(state: tauri::State<'_, RepositoryState>) { cancel(state.inner()); }

#[tauri::command]
pub async fn repository_scan(app: tauri::AppHandle, state: tauri::State<'_, RepositoryState>, url: String, access_token: Option<String>, demo: Option<bool>) -> Result<Value, String> {
    if url.len() > 2048 || access_token.as_ref().map_or(false, |v| v.len() > 16384) { return Err("Invalid request".into()); }
    let state = state.inner().clone();
    {
        let mut s = state.lock().map_err(|_| "Scanner unavailable")?;
        if s.running { return Err("A repository check is already running".into()); }
        s.running = true;
        s.cancelled = false;
        s.progress = json!({"stage":"Starting local repository engine", "checked":0,"findings":0});
    }
    let task_state = state.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let directory = app.path().resource_dir().map_err(|_| "Scanner resources unavailable")?.join("repository-runtime");
        let runtime = if cfg!(debug_assertions) && !directory.join("node.exe").is_file() {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("repository-runtime")
        } else { directory };
        let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let bin = runtime.join("git").join("bin");
        let mut command = Command::new(runtime.join("node.exe"));
        command.arg(runtime.join("engine.cjs")).current_dir(&runtime).env_clear()
            .env("SystemRoot", &system).env("WINDIR", &system)
            .env("PATH", format!("{};{}\\System32", bin.display(), system))
            .env("GIT_EXEC_PATH", &bin)
            .env("GIT_CONFIG_COUNT", "1").env("GIT_CONFIG_KEY_0", "http.sslBackend").env("GIT_CONFIG_VALUE_0", "schannel")
            .env("TEMP", std::env::temp_dir()).env("TMP", std::env::temp_dir())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|_| "Local scanner could not start. Reinstall the latest Redaxa update.")?;
        let mut input = child.stdin.take().ok_or("Scanner input unavailable")?;
        let mut request = serde_json::to_vec(&json!({"type":"scan","url":url,"accessToken":access_token.unwrap_or_default(),"demo":demo.unwrap_or(false)})).map_err(|_| "Invalid request")?;
        request.push(b'\n');
        if input.write_all(&request).and_then(|_|input.flush()).is_err() { let _=child.kill();let _=child.wait();return Err("Scanner connection failed".into()); }
        request.fill(0);
        {
            let mut s=task_state.lock().map_err(|_| "Scanner unavailable")?;
            if s.cancelled {let _=input.write_all(b"{\"type\":\"cancel\"}\n");let _=input.flush();}
            s.input = Some(input);
        }
        let stdout = child.stdout.take().ok_or("Scanner output unavailable")?;
        let mut reader = BufReader::new(stdout);
        let mut outcome: Result<Value, String> = Err("The local scanner stopped unexpectedly".into());
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) { Ok(0)|Err(_) => break, Ok(_) => {} }
            if line.len()>128*1024*1024 { outcome=Err("Scanner report exceeded its safety limit".into());let _=child.kill();break; }
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            match message["type"].as_str() {
                Some("progress") => if let Ok(mut s)=task_state.lock() {s.progress=message["progress"].clone();},
                Some("result") => {outcome=Ok(message["report"].clone());break;},
                Some("error") => {outcome=Err(format!("{}: {}",message["code"].as_str().unwrap_or("SCAN_FAILED"),message["error"].as_str().unwrap_or("Repository check failed")));break;},
                _ => {}
            }
        }
        if let Ok(mut s)=task_state.lock() {s.input.take();}
        let _=child.wait();
        outcome
    }).await.map_err(|_| "Scanner worker failed".to_string());
    if let Ok(mut s)=state.lock() {s.running=false;s.input.take();}
    result?
}

// Only a repository selection is carried by the protocol; no automatic scan,
// shell action, arbitrary navigation or credentials are accepted from a URL.
pub fn repository_deep_link(value: &str) -> Option<String> {
    let link = tauri::Url::parse(value).ok()?;
    if link.scheme()!="redaxa" || link.host_str()!=Some("repository") || !link.username().is_empty() || link.password().is_some() || link.port().is_some() {return None;}
    if !matches!(link.path(), ""|"/") || link.fragment().is_some() {return None;}
    let params:Vec<_>=link.query_pairs().collect();if params.len()!=1 || params[0].0!="repo" {return None;}
    let repo=tauri::Url::parse(&params[0].1).ok()?;
    if repo.scheme()!="https"||repo.host_str()!=Some("github.com")||!repo.username().is_empty()||repo.password().is_some()||repo.port().is_some()||repo.query().is_some()||repo.fragment().is_some(){return None;}
    let parts:Vec<_>=repo.path().trim_matches('/').split('/').collect();
    if parts.len()!=2||parts.iter().any(|p|p.is_empty()||p.len()>100||p==&"."||p==&".."||!p.chars().all(|c|c.is_ascii_alphanumeric()||matches!(c,'-'|'_'|'.'))){return None;}
    Some(repo.to_string())
}

pub fn open_deep_link(app: &tauri::AppHandle, value: &str) {
    let Some(repo)=repository_deep_link(value) else{return};
    if let Some(window)=app.get_webview_window("main") {
        // Preserve only the trusted application's own base origin.
        if let Ok(current)=window.url() {
            let trusted = (current.scheme()=="tauri"&&current.host_str()==Some("localhost")) || ((current.scheme()=="http"||current.scheme()=="https")&&current.host_str()==Some("tauri.localhost")) || (cfg!(debug_assertions)&&current.scheme()=="http"&&current.host_str()==Some("127.0.0.1"));
            if !trusted {return;}
            if let Ok(mut target)=current.join("/github.html") {
                target.query_pairs_mut().append_pair("repo",&repo);
                let _=window.navigate(target);let _=window.show();let _=window.set_focus();
            }
        }
    }
}

#[cfg(test)] mod tests {
 use super::*;
 #[test] fn deep_links_select_only_public_github_repositories(){
  assert!(repository_deep_link("redaxa://repository?repo=https%3A%2F%2Fgithub.com%2FAurelioAvila%2Fpc-tweaker-app").is_some());
  for bad in ["redaxa://repository?repo=http://127.0.0.1/x", "redaxa://repository?repo=https://github.com/a/b&exec=1", "redaxa://repository?repo=https://github.com/a/b/tree/main", "redaxa://repository?repo=https://user@github.com/a/b", "redaxa://elsewhere?repo=https://github.com/a/b"] {assert!(repository_deep_link(bad).is_none());}
 }
}
