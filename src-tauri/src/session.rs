use crate::fivem::{execute_real_launch, LaunchRequest, LaunchResult};
use crate::presence::get_fivem_sessions;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatusPayload {
    pub state: String,
    pub message: String,
}

fn status_message(state: &str) -> &'static str {
    match state {
        "starting" => "กำลังรอ FiveM เปิด",
        "running" => "FiveM กำลังทำงาน",
        "closed" => "FiveM ปิดแล้ว",
        "startup-timeout" => "ไม่พบ FiveM หลังส่งคำสั่งเปิด กรุณาลองเปิดใหม่",
        "detection-error" => "ตรวจสอบ FiveM ไม่ได้ กรุณาตรวจสอบเกมก่อนเปิดซ้ำ",
        "dispatch-error" => "เปิด FiveM ไม่สำเร็จ",
        _ => "",
    }
}

fn emit_status(app: &AppHandle, state: &str) {
    let payload = GameStatusPayload {
        state: state.to_string(),
        message: status_message(state).to_string(),
    };
    let _ = app.emit("estra://game-status", payload);
}

fn hide_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

fn restore_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

struct ActiveWatch {
    id: u64,
    baseline: HashSet<u32>,
    started_at: Instant,
    seen: bool,
    absent_at: Option<Instant>,
    error_at: Option<Instant>,
}

#[derive(Default)]
struct SessionInner {
    next_id: u64,
    active: Option<ActiveWatch>,
    dispatching: bool,
}

#[derive(Clone, Default)]
pub struct GameSessionMonitor {
    inner: Arc<Mutex<SessionInner>>,
}

impl GameSessionMonitor {
    pub async fn launch(&self, app: AppHandle, req: LaunchRequest) -> Result<LaunchResult, String> {
        let (existing_seen, is_dispatching) = {
            let guard = self.inner.lock().map_err(|_| "Session lock failed".to_string())?;
            (guard.active.as_ref().map(|a| a.seen), guard.dispatching)
        };

        if let Some(seen) = existing_seen {
            if !seen || is_dispatching {
                return Err("กำลังติดตามการเปิด FiveM ครั้งก่อน กรุณารอสักครู่".into());
            }
            {
                let mut guard = self.inner.lock().map_err(|_| "Session lock failed".to_string())?;
                guard.dispatching = true;
            }
            let prev_id = {
                let guard = self.inner.lock().map_err(|_| "Session lock failed".to_string())?;
                guard.active.as_ref().map(|a| a.id)
            };
            let baseline = tokio::task::spawn_blocking(get_fivem_sessions)
                .await
                .ok()
                .and_then(|r| r.ok());
            let res = execute_real_launch(req).await;
            {
                let mut guard = self.inner.lock().map_err(|_| "Session lock failed".to_string())?;
                guard.dispatching = false;
            }
            match res {
                Ok(result) => {
                    let need_new_watch = {
                        let guard = self.inner.lock().map_err(|_| "Session lock failed".to_string())?;
                        guard.active.as_ref().map(|a| a.id) != prev_id
                    };
                    if need_new_watch {
                        if let Some(pids) = baseline {
                            let watch_id = self.start_watch(pids);
                            emit_status(&app, "starting");
                            self.spawn_poll(app.clone(), watch_id);
                        } else {
                            emit_status(&app, "detection-error");
                            restore_window(&app);
                            return Ok(result);
                        }
                    }
                    hide_window(&app);
                    Ok(result)
                }
                Err(e) => {
                    emit_status(&app, "dispatch-error");
                    restore_window(&app);
                    Err(e)
                }
            }
        } else {
            let baseline = tokio::task::spawn_blocking(get_fivem_sessions)
                .await
                .ok()
                .and_then(|r| r.ok());
            let watch_id = self.start_watch(baseline.clone().unwrap_or_default());
            match execute_real_launch(req).await {
                Ok(result) => {
                    if baseline.is_none() {
                        self.clear_if(watch_id);
                        emit_status(&app, "detection-error");
                        restore_window(&app);
                        return Ok(result);
                    }
                    hide_window(&app);
                    emit_status(&app, "starting");
                    self.spawn_poll(app, watch_id);
                    Ok(result)
                }
                Err(e) => {
                    self.clear_if(watch_id);
                    emit_status(&app, "dispatch-error");
                    restore_window(&app);
                    Err(e)
                }
            }
        }
    }

    fn start_watch(&self, pids: Vec<u32>) -> u64 {
        let mut guard = self.inner.lock().unwrap();
        guard.next_id += 1;
        let id = guard.next_id;
        guard.active = Some(ActiveWatch {
            id,
            baseline: pids.into_iter().collect(),
            started_at: Instant::now(),
            seen: false,
            absent_at: None,
            error_at: None,
        });
        id
    }

    fn clear_if(&self, id: u64) {
        if let Ok(mut guard) = self.inner.lock() {
            if guard.active.as_ref().map(|a| a.id) == Some(id) {
                guard.active = None;
            }
        }
    }

    fn spawn_poll(&self, app: AppHandle, watch_id: u64) {
        let monitor = self.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(2000)).await;
                let pids_res = tokio::task::spawn_blocking(get_fivem_sessions).await;
                let mut finish_reason: Option<&'static str> = None;
                let mut notify_running = false;

                {
                    let Ok(mut guard) = monitor.inner.lock() else { break };
                    let Some(active) = guard.active.as_mut() else { break };
                    if active.id != watch_id {
                        break;
                    }
                    match pids_res {
                        Ok(Ok(pids)) => {
                            active.error_at = None;
                            if pids.iter().any(|pid| !active.baseline.contains(pid)) {
                                if !active.seen {
                                    notify_running = true;
                                }
                                active.seen = true;
                                active.absent_at = None;
                            } else if active.seen {
                                let absent = active.absent_at.get_or_insert_with(Instant::now);
                                if absent.elapsed() >= Duration::from_secs(12) {
                                    finish_reason = Some("closed");
                                }
                            } else if active.started_at.elapsed() >= Duration::from_secs(90) {
                                finish_reason = Some("startup-timeout");
                            }
                        }
                        _ => {
                            let err_at = active.error_at.get_or_insert_with(Instant::now);
                            if err_at.elapsed() >= Duration::from_secs(15) {
                                finish_reason = Some("detection-error");
                            }
                        }
                    }
                    if finish_reason.is_some() {
                        guard.active = None;
                    }
                }

                if notify_running {
                    emit_status(&app, "running");
                }
                if let Some(reason) = finish_reason {
                    emit_status(&app, reason);
                    restore_window(&app);
                    break;
                }
            }
        });
    }
}
