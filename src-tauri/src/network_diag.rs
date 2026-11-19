use crate::fivem::{parse_target, TargetKind};
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::{lookup_host, TcpStream};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteProbeSample {
    pub seq: u8,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteDiagnosticsReport {
    pub target: String,
    pub resolved_address: String,
    pub resolved_ip: String,
    pub port: u16,
    pub samples: Vec<RouteProbeSample>,
    pub sent: u8,
    pub received: u8,
    pub loss_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jitter_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_rtt_ms: Option<u64>,
    pub quality: String, // "excellent" | "good" | "fair" | "poor" | "unreachable"
    pub summary: String,
    pub checked_at_ms: u64,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn resolve_direct_endpoint(input: &str) -> Result<(String, String, u16), String> {
    let parsed = parse_target(input)?;
    let direct_addr = if parsed.kind == TargetKind::Join {
        let code = parsed.code.as_deref().unwrap_or("");
        let url = format!("https://servers-frontend.fivem.net/api/servers/single/{code}");
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(4500))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("สร้าง HTTP client ไม่สำเร็จ: {e}"))?;
        let res = client
            .get(&url)
            .header("Cache-Control", "no-cache")
            .send()
            .await
            .map_err(|_| "ไม่สามารถดึง IP ปลายทางจาก Cfx.re ได้".to_string())?;
        if !res.status().is_success() {
            return Err(format!("Cfx.re ตอบกลับ HTTP {}", res.status().as_u16()));
        }
        let body: Value = res
            .json()
            .await
            .map_err(|_| "ข้อมูลปลายทางจาก Cfx.re ไม่ถูกต้อง".to_string())?;
        let endpoints = body
            .get("Data")
            .and_then(|d| d.get("connectEndPoints"))
            .and_then(|e| e.as_array())
            .ok_or_else(|| "ไม่พบ Endpoint ของเซิร์ฟเวอร์นี้ใน Cfx.re".to_string())?;
        let mut chosen = None;
        for ep in endpoints {
            if let Some(ep_str) = ep.as_str() {
                if let Ok(direct) = parse_target(ep_str) {
                    if direct.kind == TargetKind::Direct {
                        chosen = Some(direct.address);
                        break;
                    }
                }
            }
        }
        chosen.ok_or_else(|| "เซิร์ฟเวอร์นี้ไม่ได้ประกาศ IP ปลายทางตรง".to_string())?
    } else {
        parsed.address
    };

    let (host, port_str) = direct_addr
        .rsplit_once(':')
        .ok_or_else(|| "ไม่พบพอร์ตของเซิร์ฟเวอร์".to_string())?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| "พอร์ตเซิร์ฟเวอร์ไม่ถูกต้อง".to_string())?;

    let addrs = lookup_host((host, port))
        .await
        .map_err(|_| format!("ไม่สามารถแปลงโดเมน {host} เป็น IP ได้"))?;
    let first_ip = addrs
        .into_iter()
        .next()
        .map(|a| a.ip().to_string())
        .ok_or_else(|| format!("ไม่พบ IP สำหรับ {host}"))?;

    Ok((direct_addr, first_ip, port))
}

pub fn summarize_route_metrics(
    samples: &[RouteProbeSample],
) -> (u8, f64, Option<u64>, Option<u64>, Option<u64>, Option<u64>, &'static str, &'static str) {
    let sent = samples.len() as u8;
    let rtts: Vec<u64> = samples.iter().filter_map(|s| if s.ok { s.rtt_ms } else { None }).collect();
    let received = rtts.len() as u8;
    let loss_percent = if sent == 0 {
        100.0
    } else {
        (((sent - received) as f64 / sent as f64) * 1000.0).round() / 10.0
    };

    if rtts.is_empty() {
        return (
            0,
            100.0,
            None,
            None,
            None,
            None,
            "unreachable",
            "ไม่สามารถเชื่อมต่อพอร์ตเซิร์ฟเวอร์ได้ เซิร์ฟเวอร์อาจกำลังรีสตาร์ทหรือเส้นทางเน็ตถูกบล็อก",
        );
    }

    let min_ms = *rtts.iter().min().unwrap();
    let max_ms = *rtts.iter().max().unwrap();
    let avg_ms = (rtts.iter().sum::<u64>() as f64 / rtts.len() as f64).round() as u64;

    let jitter_ms = if rtts.len() >= 2 {
        let mut diff_sum: u64 = 0;
        for w in rtts.windows(2) {
            diff_sum += w[0].abs_diff(w[1]);
        }
        (diff_sum as f64 / (rtts.len() - 1) as f64).round() as u64
    } else {
        0
    };

    let (quality, summary) = if loss_percent >= 25.0 || avg_ms >= 180 || jitter_ms >= 50 {
        (
            "poor",
            "เส้นทางไม่เสถียร (Ping/Jitter สูง หรือ Packet Loss) อาจเกิดอาการดีเลย์หรือหลุดในเกม",
        )
    } else if loss_percent > 0.0 || avg_ms >= 100 || jitter_ms >= 25 {
        (
            "fair",
            "เส้นทางพอใช้ได้ แต่มีความแกว่งเล็กน้อย แนะนำตรวจสอบ Wi-Fi หรือการดาวน์โหลดเบื้องหลัง",
        )
    } else if avg_ms <= 45 && jitter_ms <= 10 {
        (
            "excellent",
            "เส้นทางเสถียรมาก Ping ต่ำและ Jitter นิ่ง เหมาะทั้ง RP และสายไฟต์",
        )
    } else {
        (
            "good",
            "เส้นทางเสถียรดี ไม่มี Packet Loss พร้อมเข้าเมืองได้ราบรื่น",
        )
    };

    (
        received,
        loss_percent,
        Some(min_ms),
        Some(avg_ms),
        Some(max_ms),
        Some(jitter_ms),
        quality,
        summary,
    )
}

pub async fn probe_server_route(
    target: &str,
    sample_count: Option<u8>,
) -> Result<RouteDiagnosticsReport, String> {
    let count = sample_count.unwrap_or(6).clamp(3, 10);
    let (resolved_address, resolved_ip, port) = resolve_direct_endpoint(target).await?;
    let connect_target = format!("{resolved_ip}:{port}");

    let mut samples = Vec::with_capacity(count as usize);
    for seq in 1..=count {
        let started = Instant::now();
        let res = tokio::time::timeout(
            Duration::from_millis(2200),
            TcpStream::connect(&connect_target),
        )
        .await;
        match res {
            Ok(Ok(stream)) => {
                let rtt = started.elapsed().as_millis().max(1) as u64;
                drop(stream);
                samples.push(RouteProbeSample {
                    seq,
                    ok: true,
                    rtt_ms: Some(rtt),
                    error: None,
                });
            }
            Ok(Err(e)) => {
                samples.push(RouteProbeSample {
                    seq,
                    ok: false,
                    rtt_ms: None,
                    error: Some(e.kind().to_string()),
                });
            }
            Err(_) => {
                samples.push(RouteProbeSample {
                    seq,
                    ok: false,
                    rtt_ms: None,
                    error: Some("timeout".into()),
                });
            }
        }
        if seq < count {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }

    // Measure single HTTP /info.json latency for full application-layer verification
    let http_rtt_ms = if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(3500))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        let t0 = Instant::now();
        let url = format!("http://{resolved_address}/info.json");
        match client.get(&url).header("Cache-Control", "no-cache").send().await {
            Ok(resp) if resp.status().is_success() => Some(t0.elapsed().as_millis().max(1) as u64),
            _ => None,
        }
    } else {
        None
    };

    let (received, loss_percent, min_ms, avg_ms, max_ms, jitter_ms, quality, summary) =
        summarize_route_metrics(&samples);

    Ok(RouteDiagnosticsReport {
        target: target.trim().to_string(),
        resolved_address,
        resolved_ip,
        port,
        samples,
        sent: count,
        received,
        loss_percent,
        min_ms,
        avg_ms,
        max_ms,
        jitter_ms,
        http_rtt_ms,
        quality: quality.into(),
        summary: summary.into(),
        checked_at_ms: now_unix_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_excellent_route_metrics_correctly() {
        let samples = vec![
            RouteProbeSample { seq: 1, ok: true, rtt_ms: Some(18), error: None },
            RouteProbeSample { seq: 2, ok: true, rtt_ms: Some(20), error: None },
            RouteProbeSample { seq: 3, ok: true, rtt_ms: Some(19), error: None },
            RouteProbeSample { seq: 4, ok: true, rtt_ms: Some(23), error: None },
        ];
        let (recv, loss, min, avg, max, jitter, quality, _) = summarize_route_metrics(&samples);
        assert_eq!(recv, 4);
        assert_eq!(loss, 0.0);
        assert_eq!(min, Some(18));
        assert_eq!(avg, Some(20));
        assert_eq!(max, Some(23));
        assert_eq!(jitter, Some(2));
        assert_eq!(quality, "excellent");
    }

    #[test]
    fn flags_high_loss_or_jitter_as_poor() {
        let samples = vec![
            RouteProbeSample { seq: 1, ok: true, rtt_ms: Some(40), error: None },
            RouteProbeSample { seq: 2, ok: false, rtt_ms: None, error: Some("timeout".into()) },
            RouteProbeSample { seq: 3, ok: true, rtt_ms: Some(150), error: None },
            RouteProbeSample { seq: 4, ok: false, rtt_ms: None, error: Some("timeout".into()) },
        ];
        let (recv, loss, _, _, _, jitter, quality, _) = summarize_route_metrics(&samples);
        assert_eq!(recv, 2);
        assert_eq!(loss, 50.0);
        assert_eq!(jitter, Some(110));
        assert_eq!(quality, "poor");
    }
}
