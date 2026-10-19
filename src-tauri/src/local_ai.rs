//! Eardloom's built-in assistant: an open model running on the author's own computer.
//!
//! Off until the author turns it on. Then Eardloom downloads a pinned, checksum-verified
//! build of llama.cpp (MIT) and an Apache-2.0 model, and runs them locally on demand. The
//! engine only listens on this computer, starts when the assistant is used, and shuts
//! down after a while unused. Nothing is sent anywhere.

use crate::world::{err, CmdResult};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

// ---- pinned downloads -------------------------------------------------------

const ENGINE_BUILD: &str = "b11722";
const ENGINE_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b11722/llama-b11722-bin-win-vulkan-x64.zip";
const ENGINE_SHA256: &str = "45d32558a304456675b3bfe5af7c39bc814f719038cfcf1208afbb8a901fa51b";
const ENGINE_BYTES: u64 = 32_300_000;

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
    /// Graphics memory it wants to run fully on the GPU, in MB.
    pub vram_mb: u64,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "small",
        label: "Small (Qwen3 4B)",
        file: "Qwen3-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf",
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        bytes: 2_500_000_000,
        vram_mb: 4000,
    },
    ModelSpec {
        id: "standard",
        label: "Standard (Qwen3 8B)",
        file: "Qwen3-8B-Q4_K_M.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf",
        sha256: "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785",
        bytes: 5_030_000_000,
        vram_mb: 7000,
    },
    ModelSpec {
        id: "large",
        label: "Large (Qwen3 14B)",
        file: "Qwen3-14B-Q4_K_M.gguf",
        url: "https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/530227a7d994db8eca5ab5ced2fb692b614357fd/Qwen3-14B-Q4_K_M.gguf",
        sha256: "500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0",
        bytes: 9_000_000_000,
        vram_mb: 11000,
    },
];

/// Shut the engine down after this long without use, freeing graphics memory.
const IDLE_SECS: u64 = 10 * 60;
const CONTEXT_TOKENS: &str = "12288";

// ---- state --------------------------------------------------------------------

struct Running {
    child: Child,
    port: u16,
    key: String,
    model: String,
}

#[derive(Default)]
pub struct LocalAi {
    running: Mutex<Option<Running>>,
    last_used: AtomicU64,
    downloading: AtomicBool,
    cancel: Arc<AtomicBool>,
    watchdog: AtomicBool,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn root(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(err)?.join("local-ai"))
}
fn engine_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(root(app)?.join(format!("engine-{ENGINE_BUILD}")))
}
fn models_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(root(app)?.join("models"))
}

/// llama-server.exe inside the unpacked engine (the zip may or may not have a top folder).
fn server_exe(dir: &Path) -> Option<PathBuf> {
    let direct = dir.join("llama-server.exe");
    if direct.is_file() {
        return Some(direct);
    }
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path().join("llama-server.exe")).find(|p| p.is_file())
}

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Ties the engine's lifetime to Eardloom's: it goes in a Windows job object that the
/// system closes when Eardloom's process ends, for any reason (even a crash or Task
/// Manager), which kills the engine with it.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Job(HANDLE);
    // The handle is only ever passed to Windows; it's never dereferenced here.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn job() -> Option<HANDLE> {
        JOB.get_or_init(|| unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            // Deliberately never closed: Windows closes it when Eardloom exits.
            (ok != 0).then_some(Job(handle))
        })
        .as_ref()
        .map(|j| j.0)
    }

    pub fn adopt(child: &std::process::Child) -> bool {
        match job() {
            Some(j) => unsafe { AssignProcessToJobObject(j, child.as_raw_handle() as HANDLE) != 0 },
            None => false,
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---- status -------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    label: String,
    bytes: u64,
    vram_mb: u64,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiStatus {
    engine_installed: bool,
    engine_bytes: u64,
    models: Vec<ModelInfo>,
    running_model: Option<String>,
    downloading: bool,
    disk_used: u64,
}

fn dir_size(p: &Path) -> u64 {
    fs::read_dir(p)
        .map(|rd| {
            rd.flatten()
                .map(|e| {
                    let path = e.path();
                    if path.is_dir() { dir_size(&path) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
                })
                .sum()
        })
        .unwrap_or(0)
}

#[tauri::command]
pub fn local_ai_status(app: AppHandle, state: State<LocalAi>) -> CmdResult<LocalAiStatus> {
    let models = models_dir(&app)?;
    Ok(LocalAiStatus {
        engine_installed: server_exe(&engine_dir(&app)?).is_some(),
        engine_bytes: ENGINE_BYTES,
        models: MODELS
            .iter()
            .map(|m| ModelInfo {
                id: m.id.into(),
                label: m.label.into(),
                bytes: m.bytes,
                vram_mb: m.vram_mb,
                installed: models.join(m.file).is_file(),
            })
            .collect(),
        running_model: state.running.lock().map_err(err)?.as_ref().map(|r| r.model.clone()),
        downloading: state.downloading.load(Ordering::SeqCst),
        disk_used: dir_size(&root(&app)?),
    })
}

/// Graphics devices as llama.cpp sees them, e.g. ("NVIDIA GeForce RTX 5070 Laptop GPU", 8151 MB).
#[tauri::command]
pub fn local_ai_hardware(app: AppHandle) -> CmdResult<Vec<(String, u64)>> {
    let exe = server_exe(&engine_dir(&app)?).ok_or("The engine isn't installed yet.")?;
    let mut cmd = Command::new(exe);
    cmd.arg("--list-devices");
    hide_window(&mut cmd);
    let out = cmd.output().map_err(err)?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    // Lines look like: "  Vulkan0: NVIDIA GeForce RTX 5070 Laptop GPU (8151 MiB, 7300 MiB free)"
    let mut devices = Vec::new();
    for line in text.lines() {
        let Some((_, rest)) = line.trim().split_once(": ") else { continue };
        let Some((name, mem)) = rest.rsplit_once(" (") else { continue };
        if let Some(mb) = mem.split_whitespace().next().and_then(|n| n.parse::<u64>().ok()) {
            if mem.contains("MiB") {
                devices.push((name.trim().to_string(), mb));
            }
        }
    }
    Ok(devices)
}

// ---- downloading ----------------------------------------------------------------

/// Downloads to `dest`, resuming a partial file, verifying the SHA-256 at the end.
fn download(app: &AppHandle, url: &str, dest: &Path, sha256: &str, expected: u64, label: &str, cancel: &AtomicBool) -> CmdResult<()> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let part = dest.with_extension("part");
    let mut have = part.metadata().map(|m| m.len()).unwrap_or(0);
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(30))).build().into();
    let mut req = agent.get(url);
    if have > 0 {
        req = req.header("Range", &format!("bytes={have}-"));
    }
    let resp = req.call().map_err(|e| format!("Download failed: {e}"))?;
    // A server that ignores Range sends the whole file again.
    if have > 0 && resp.status().as_u16() != 206 {
        have = 0;
    }
    let total = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .map(|n| n + have)
        .unwrap_or(expected);
    let mut file = if have > 0 { OpenOptions::new().append(true).open(&part).map_err(err)? } else { File::create(&part).map_err(err)? };
    let mut reader = resp.into_body().into_reader();
    let mut buf = vec![0u8; 1 << 20];
    let mut done = have;
    let mut last = Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Download cancelled.".into());
        }
        let n = reader.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(err)?;
        done += n as u64;
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            let _ = app.emit("local-ai://progress", json!({ "label": label, "done": done, "total": total }));
        }
    }
    file.flush().map_err(err)?;
    drop(file);
    let _ = app.emit("local-ai://progress", json!({ "label": format!("Checking {label}"), "done": total, "total": total }));
    // Verify the whole file before trusting it.
    let mut hasher = Sha256::new();
    let mut f = File::open(&part).map_err(err)?;
    loop {
        let n = f.read(&mut buf).map_err(err)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    if hex(&hasher.finalize()) != sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!("{label} didn't match its published checksum, so it was discarded. Please try again."));
    }
    fs::rename(&part, dest).map_err(err)
}

fn unzip(zip_path: &Path, dir: &Path) -> CmdResult<()> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path).map_err(err)?).map_err(err)?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(err)?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let out = dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
            continue;
        }
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(err)?;
        }
        let mut f = File::create(&out).map_err(err)?;
        std::io::copy(&mut entry, &mut f).map_err(err)?;
    }
    Ok(())
}

/// Downloads the engine (if needed) and the chosen model, in the background.
#[tauri::command]
pub fn local_ai_install(app: AppHandle, state: State<LocalAi>, model: String) -> CmdResult<()> {
    let spec = MODELS.iter().find(|m| m.id == model).ok_or("Unknown model.")?;
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("A download is already in progress.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = (|| -> CmdResult<()> {
            let engine = engine_dir(&app2)?;
            if server_exe(&engine).is_none() {
                let zip = root(&app2)?.join(format!("engine-{ENGINE_BUILD}.zip"));
                download(&app2, ENGINE_URL, &zip, ENGINE_SHA256, ENGINE_BYTES, "the AI engine", &cancel)?;
                unzip(&zip, &engine)?;
                let _ = fs::remove_file(zip);
            }
            let dest = models_dir(&app2)?.join(spec.file);
            if !dest.is_file() {
                download(&app2, spec.url, &dest, spec.sha256, spec.bytes, "the AI model", &cancel)?;
            }
            Ok(())
        })();
        app2.state::<LocalAi>().downloading.store(false, Ordering::SeqCst);
        let _ = app2.emit("local-ai://installed", json!({ "ok": result.is_ok(), "error": result.err() }));
    });
    Ok(())
}

#[tauri::command]
pub fn local_ai_cancel_download(state: State<LocalAi>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Removes models (and the engine, when `everything`), stopping the engine first.
#[tauri::command]
pub fn local_ai_remove(app: AppHandle, state: State<LocalAi>, model: Option<String>, everything: bool) -> CmdResult<()> {
    stop(&state);
    if everything {
        let r = root(&app)?;
        if r.exists() {
            fs::remove_dir_all(r).map_err(err)?;
        }
        return Ok(());
    }
    if let Some(spec) = model.and_then(|m| MODELS.iter().find(|s| s.id == m)) {
        let path = models_dir(&app)?.join(spec.file);
        let _ = fs::remove_file(path.with_extension("part"));
        if path.exists() {
            fs::remove_file(path).map_err(err)?;
        }
    }
    Ok(())
}

// ---- running ----------------------------------------------------------------------

fn free_port() -> CmdResult<u16> {
    let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(err)?;
    Ok(l.local_addr().map_err(err)?.port())
}

fn stop(state: &LocalAi) {
    if let Ok(mut g) = state.running.lock() {
        if let Some(mut r) = g.take() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

/// Called when Eardloom exits, so the engine never outlives the app.
pub fn shutdown(app: &AppHandle) {
    stop(&app.state::<LocalAi>());
}

fn healthy(port: u16, key: &str) -> bool {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(2))).http_status_as_error(false).build().into();
    agent
        .get(&format!("http://127.0.0.1:{port}/health"))
        .header("Authorization", &format!("Bearer {key}"))
        .call()
        .is_ok_and(|r| r.status().as_u16() == 200)
}

/// Starts the engine with the chosen model (if it isn't already running it) and waits until it's ready.
#[tauri::command]
pub async fn local_ai_start(app: AppHandle, model: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || start_blocking(&app, &model)).await.map_err(err)?
}

fn start_blocking(app: &AppHandle, model: &str) -> CmdResult<()> {
    let state = app.state::<LocalAi>();
    state.last_used.store(now_secs(), Ordering::SeqCst);
    {
        let mut g = state.running.lock().map_err(err)?;
        if let Some(r) = g.as_mut() {
            let alive = r.child.try_wait().map(|s| s.is_none()).unwrap_or(false);
            if alive && r.model == model {
                return Ok(());
            }
        }
    }
    stop(&state);
    let spec = MODELS.iter().find(|m| m.id == model).ok_or("Unknown model.")?;
    let exe = server_exe(&engine_dir(app)?).ok_or("The AI engine isn't installed.")?;
    let model_path = models_dir(app)?.join(spec.file);
    if !model_path.is_file() {
        return Err("That model isn't downloaded.".into());
    }
    let port = free_port()?;
    let key = crate::ai::random_token();
    let mut cmd = Command::new(&exe);
    cmd.current_dir(exe.parent().unwrap_or(Path::new(".")))
        .arg("-m")
        .arg(&model_path)
        .args(["--host", "127.0.0.1", "--port", &port.to_string(), "--api-key", &key])
        // Everything on the GPU it can fit; a compact cache so a 12k-token conversation fits in 8 GB.
        .args(["-ngl", "999", "-c", CONTEXT_TOKENS, "-fa", "auto", "-ctk", "q8_0", "-ctv", "q8_0", "--jinja", "--no-webui"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window, and below-normal priority so writing always stays responsive.
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the AI engine: {e}"))?;
    #[cfg(windows)]
    if !job::adopt(&child) {
        eprintln!("Couldn't tie the AI engine to Eardloom's lifetime; it will still stop on exit and when idle.");
    }

    // Keep the last lines of its log for error messages.
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut l) = log.lock() {
                    l.push(line);
                    if l.len() > 40 {
                        l.remove(0);
                    }
                }
            }
        });
    }
    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let tail = log.lock().map(|l| l.join("\n")).unwrap_or_default();
            return Err(format!("The AI engine stopped while starting ({status}).\n{tail}"));
        }
        if healthy(port, &key) {
            break;
        }
        if started.elapsed() > Duration::from_secs(180) {
            let _ = child.kill();
            return Err("The AI engine took too long to start.".into());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    *state.running.lock().map_err(err)? = Some(Running { child, port, key, model: model.into() });
    ensure_watchdog(app);
    Ok(())
}

/// Stops the engine after a while unused, so it isn't holding memory while the author writes.
fn ensure_watchdog(app: &AppHandle) {
    let state = app.state::<LocalAi>();
    if state.watchdog.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let state = app.state::<LocalAi>();
        let busy = state.running.lock().map(|g| g.is_some()).unwrap_or(false);
        if busy && now_secs().saturating_sub(state.last_used.load(Ordering::SeqCst)) > IDLE_SECS {
            stop(&state);
            let _ = app.emit("local-ai://stopped", "idle");
        }
    });
}

#[tauri::command]
pub fn local_ai_stop(state: State<LocalAi>) {
    stop(&state);
}

/// Streams a chat completion from the local engine. Text arrives as `local-ai://delta`
/// events; the full assistant message (including any tool calls) is returned at the end.
#[tauri::command]
pub async fn local_ai_chat(app: AppHandle, request_id: String, body: Value) -> CmdResult<Value> {
    tauri::async_runtime::spawn_blocking(move || chat_blocking(&app, &request_id, body)).await.map_err(err)?
}

fn chat_blocking(app: &AppHandle, request_id: &str, mut body: Value) -> CmdResult<Value> {
    let state = app.state::<LocalAi>();
    state.last_used.store(now_secs(), Ordering::SeqCst);
    let (port, key) = {
        let g = state.running.lock().map_err(err)?;
        let r = g.as_ref().ok_or("The assistant isn't running.")?;
        (r.port, r.key.clone())
    };
    body["stream"] = json!(true);
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let resp = agent
        .post(&format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .header("Authorization", &format!("Bearer {key}"))
        .content_type("application/json")
        .send(body.to_string())
        .map_err(|e| format!("The assistant couldn't be reached: {e}"))?;
    if resp.status().as_u16() != 200 {
        let text = resp.into_body().read_to_string().unwrap_or_default();
        return Err(format!("The assistant reported an error: {text}"));
    }

    let mut content = String::new();
    let mut reasoning = String::new();
    // Tool calls arrive in pieces, keyed by index.
    let mut calls: Vec<Value> = Vec::new();
    let reader = BufReader::new(resp.into_body().into_reader());
    for line in reader.lines().map_while(Result::ok) {
        let Some(data) = line.strip_prefix("data: ") else { continue };
        if data.trim() == "[DONE]" {
            break;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else { continue };
        let Some(delta) = chunk.pointer("/choices/0/delta") else { continue };
        if let Some(t) = delta.get("reasoning_content").and_then(Value::as_str) {
            reasoning.push_str(t);
            let _ = app.emit("local-ai://delta", json!({ "id": request_id, "thinking": t }));
        }
        if let Some(t) = delta.get("content").and_then(Value::as_str) {
            content.push_str(t);
            let _ = app.emit("local-ai://delta", json!({ "id": request_id, "text": t }));
        }
        if let Some(tc) = delta.get("tool_calls").and_then(Value::as_array) {
            for part in tc {
                let i = part.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                while calls.len() <= i {
                    calls.push(json!({ "id": "", "type": "function", "function": { "name": "", "arguments": "" } }));
                }
                let c = &mut calls[i];
                if let Some(id) = part.get("id").and_then(Value::as_str) {
                    c["id"] = json!(id);
                }
                if let Some(n) = part.pointer("/function/name").and_then(Value::as_str) {
                    let name = format!("{}{n}", c["function"]["name"].as_str().unwrap_or(""));
                    c["function"]["name"] = json!(name);
                }
                if let Some(a) = part.pointer("/function/arguments").and_then(Value::as_str) {
                    let args = format!("{}{a}", c["function"]["arguments"].as_str().unwrap_or(""));
                    c["function"]["arguments"] = json!(args);
                }
            }
        }
        state.last_used.store(now_secs(), Ordering::SeqCst);
    }
    let mut msg = json!({ "role": "assistant", "content": content });
    if !calls.is_empty() {
        msg["tool_calls"] = Value::Array(calls);
    }
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn engine_processes_are_tied_to_eardloom() {
        // Any child will do; it must join the kill-on-close job.
        let mut child = Command::new("cmd").args(["/C", "ping -n 30 127.0.0.1 >NUL"]).spawn().unwrap();
        let adopted = job::adopt(&child);
        let _ = child.kill();
        let _ = child.wait();
        assert!(adopted, "the engine must be in Eardloom's job so it dies with the app");
    }

    #[test]
    fn pinned_downloads_are_well_formed() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(m.url.contains("/resolve/") && m.url.ends_with(m.file), "{} must be pinned to a revision", m.id);
        }
        assert_eq!(ENGINE_SHA256.len(), 64);
        assert!(ENGINE_URL.contains(ENGINE_BUILD));
    }
}
