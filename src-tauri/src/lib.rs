use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    Ok(dir.join("mailuo.json"))
}

/// Load the persisted app state. Returns "null" when no data has been saved yet.
#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<String, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        return Ok("null".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取数据失败: {e}"))
}

/// Persist the app state atomically (write to a temp file, then rename).
#[tauri::command]
fn save_state(app: tauri::AppHandle, data: String) -> Result<(), String> {
    // Reject payloads that aren't valid JSON so a frontend bug can't corrupt the store.
    serde_json::from_str::<serde_json::Value>(&data).map_err(|e| format!("数据格式错误: {e}"))?;
    let path = data_file(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &data).map_err(|e| format!("写入数据失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存数据失败: {e}"))?;
    Ok(())
}

/// 返回数据文件所在目录（供设置页展示与「在访达中打开」）
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = data_file(&app)?;
    Ok(path.parent().unwrap_or(&path).to_string_lossy().into_owned())
}

/// 解析 pi 可执行文件路径：优先使用用户配置，否则通过登录 shell 查找
fn resolve_pi(configured: Option<String>) -> Result<std::path::PathBuf, String> {
    if let Some(p) = configured {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            let pb = std::path::PathBuf::from(trimmed);
            if pb.is_file() {
                return Ok(pb);
            }
            if !trimmed.contains('/') {
                // 只是命令名，走 shell 解析
            } else {
                return Err(format!("配置的 pi 路径不存在：{trimmed}"));
            }
        }
    }
    // 交互式登录 shell 才会加载 .zshrc（nvm 等版本管理器都在这里注入 PATH）
    if let Ok(out) = std::process::Command::new("/bin/zsh")
        .args(["-lic", "command -v pi"])
        .output()
    {
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !path.is_empty() {
            let pb = std::path::PathBuf::from(path);
            if pb.is_file() {
                return Ok(pb);
            }
        }
    }
    // 兜底：扫描常见安装位置
    if let Some(home) = std::env::var_os("HOME") {
        let home = std::path::PathBuf::from(home);
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            versions.sort();
            for v in versions.into_iter().rev() {
                let candidate = v.join("bin/pi");
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
        for rel in [".bun/bin/pi", ".local/bin/pi"] {
            let candidate = home.join(rel);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    for abs in ["/usr/local/bin/pi", "/opt/homebrew/bin/pi"] {
        let candidate = std::path::PathBuf::from(abs);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("未找到 pi 命令。请先安装 pi（npm i -g @mariozechner/pi），或在设置 → AI 中填写其完整路径。".into())
}

/// 抓取交互式登录 shell 的环境变量（API 密钥、PATH 等常配置在 .zshrc 中，
/// GUI 进程默认拿不到）。进程生命周期内缓存一次。
fn login_shell_env() -> &'static Vec<(String, String)> {
    use std::sync::OnceLock;
    static ENV: OnceLock<Vec<(String, String)>> = OnceLock::new();
    ENV.get_or_init(|| {
        let Ok(out) = std::process::Command::new("/bin/zsh")
            .args(["-lic", "env -0"])
            .output()
        else {
            return Vec::new();
        };
        String::from_utf8_lossy(&out.stdout)
            .split('\0')
            .filter_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (!k.is_empty()).then(|| (k.to_string(), v.to_string()))
            })
            .collect()
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    pi_path: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    thinking: Option<String>,
    proxy: Option<String>,
}

/// 调用 pi agent（非交互、无工具、无会话），返回纯文本回复
#[tauri::command]
async fn run_agent(
    config: AgentConfig,
    system: Option<String>,
    prompt: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pi = resolve_pi(config.pi_path)?;
        let mut cmd = std::process::Command::new(&pi);
        cmd.args([
            "-p",
            "--no-session",
            "--no-tools",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-context-files",
        ]);
        if let Some(s) = system.as_deref().filter(|s| !s.trim().is_empty()) {
            cmd.args(["--system-prompt", s]);
        }
        if let Some(p) = config.provider.as_deref().filter(|s| !s.trim().is_empty()) {
            cmd.args(["--provider", p]);
        }
        if let Some(m) = config.model.as_deref().filter(|s| !s.trim().is_empty()) {
            cmd.args(["--model", m]);
        }
        if let Some(t) = config.thinking.as_deref().filter(|s| !s.trim().is_empty()) {
            cmd.args(["--thinking", t]);
        }
        cmd.arg(&prompt);
        // GUI 进程环境很小：先铺上登录 shell 的环境（API 密钥、PATH），
        // 再把 pi 所在目录（node 通常同目录）补进 PATH，保证 shebang 可解析。
        for (k, v) in login_shell_env() {
            cmd.env(k, v);
        }
        if let Some(p) = config.proxy.as_deref().filter(|s| !s.trim().is_empty()) {
            cmd.env("http_proxy", p)
                .env("https_proxy", p)
                .env("HTTP_PROXY", p)
                .env("HTTPS_PROXY", p);
        }
        if let Some(dir) = pi.parent() {
            let base = login_shell_env()
                .iter()
                .find(|(k, _)| k == "PATH")
                .map(|(_, v)| v.clone())
                .or_else(|| std::env::var("PATH").ok())
                .unwrap_or_default();
            cmd.env("PATH", format!("{}:{}", dir.to_string_lossy(), base));
        }
        let out = cmd
            .output()
            .map_err(|e| format!("启动 pi 失败：{e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: String = stderr
                .lines()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(if tail.trim().is_empty() {
                format!("pi 退出码 {:?}，无输出", out.status.code())
            } else {
                tail
            });
        }
        if stdout.is_empty() {
            return Err("pi 返回了空回复".into());
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| format!("agent 任务失败：{e}"))?
}

/* ---------- pi RPC 常驻会话（流式助手） ---------- */

struct AssistantProc {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    stdout: std::io::BufReader<std::process::ChildStdout>,
    /// 配置指纹：变化时重启进程
    key: String,
}

impl Drop for AssistantProc {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct AssistantState(std::sync::Arc<std::sync::Mutex<Option<AssistantProc>>>);

fn spawn_assistant(
    config: &AgentConfig,
    system: &str,
    key: String,
) -> Result<AssistantProc, String> {
    let pi = resolve_pi(config.pi_path.clone())?;
    let mut cmd = std::process::Command::new(&pi);
    cmd.args([
        "--mode",
        "rpc",
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--system-prompt",
        system,
    ]);
    if let Some(p) = config.provider.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.args(["--provider", p]);
    }
    if let Some(m) = config.model.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.args(["--model", m]);
    }
    if let Some(t) = config.thinking.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.args(["--thinking", t]);
    }
    for (k, v) in login_shell_env() {
        cmd.env(k, v);
    }
    if let Some(p) = config.proxy.as_deref().filter(|s| !s.trim().is_empty()) {
        cmd.env("http_proxy", p)
            .env("https_proxy", p)
            .env("HTTP_PROXY", p)
            .env("HTTPS_PROXY", p);
    }
    if let Some(dir) = pi.parent() {
        let base = login_shell_env()
            .iter()
            .find(|(k, _)| k == "PATH")
            .map(|(_, v)| v.clone())
            .or_else(|| std::env::var("PATH").ok())
            .unwrap_or_default();
        cmd.env("PATH", format!("{}:{}", dir.to_string_lossy(), base));
    }
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("启动 pi RPC 失败：{e}"))?;
    let stdin = child.stdin.take().ok_or("无法获取 pi stdin")?;
    let stdout = std::io::BufReader::new(child.stdout.take().ok_or("无法获取 pi stdout")?);
    Ok(AssistantProc {
        child,
        stdin,
        stdout,
        key,
    })
}

/// 向常驻 pi RPC 会话发送一条消息，流式回传事件：
/// {type:"delta",text} / {type:"done"} / {type:"error",message}
#[tauri::command]
async fn assistant_send(
    state: tauri::State<'_, AssistantState>,
    config: AgentConfig,
    system: String,
    message: String,
    on_event: tauri::ipc::Channel<serde_json::Value>,
) -> Result<(), String> {
    use std::io::{BufRead, Write};
    let slot = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = slot.lock().map_err(|_| "助手状态锁失败")?;
        let key = format!(
            "{}|{}|{}|{}|{}",
            config.pi_path.as_deref().unwrap_or(""),
            config.provider.as_deref().unwrap_or(""),
            config.model.as_deref().unwrap_or(""),
            config.thinking.as_deref().unwrap_or(""),
            system
        );
        // 进程不存在 / 已退出 / 配置变化 → 重启
        let need_spawn = match guard.as_mut() {
            Some(p) => p.key != key || p.child.try_wait().map(|s| s.is_some()).unwrap_or(true),
            None => true,
        };
        if need_spawn {
            *guard = Some(spawn_assistant(&config, &system, key)?);
        }
        let proc = guard.as_mut().unwrap();

        let req = serde_json::json!({ "id": "1", "type": "prompt", "message": message });
        if let Err(e) = writeln!(proc.stdin, "{}", req) {
            *guard = None;
            return Err(format!("发送消息失败：{e}"));
        }

        let mut line = String::new();
        loop {
            line.clear();
            let n = proc.stdout.read_line(&mut line).map_err(|e| {
                format!("读取回复失败：{e}")
            })?;
            if n == 0 {
                *guard = None;
                return Err("pi 会话意外退出（可检查设置中的模型与代理配置）".into());
            }
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match event.get("type").and_then(|t| t.as_str()) {
                Some("message_update") => {
                    if let Some(delta) = event
                        .pointer("/assistantMessageEvent/delta")
                        .and_then(|d| d.as_str())
                    {
                        if event.pointer("/assistantMessageEvent/type")
                            == Some(&serde_json::Value::String("text_delta".into()))
                        {
                            let _ = on_event
                                .send(serde_json::json!({ "type": "delta", "text": delta }));
                        }
                    }
                }
                Some("agent_settled") => {
                    let _ = on_event.send(serde_json::json!({ "type": "done" }));
                    return Ok(());
                }
                Some("response") => {
                    if event.get("success") == Some(&serde_json::Value::Bool(false)) {
                        let msg = event
                            .get("error")
                            .and_then(|e| e.as_str())
                            .unwrap_or("未知错误")
                            .to_string();
                        return Err(msg);
                    }
                }
                _ => {}
            }
        }
    })
    .await
    .map_err(|e| format!("助手任务失败：{e}"))?
}

/// 重置助手会话（新对话 / 切换项目时调用）
#[tauri::command]
fn assistant_reset(state: tauri::State<'_, AssistantState>) {
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AssistantState::default())
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            get_data_dir,
            run_agent,
            assistant_send,
            assistant_reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
