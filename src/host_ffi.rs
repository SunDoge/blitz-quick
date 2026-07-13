use rquickjs::{Ctx, Result, TypedArray};

#[rquickjs::function(rename = "__host_log")]
pub fn host_log(s: String) {
    tracing::info!(target: "js", "{s}");
}

#[rquickjs::function(rename = "__host_log_level")]
pub fn host_log_level(tag: String, msg: String) {
    match tag.as_str() {
        "error" => tracing::error!(target: "js", "{msg}"),
        "warn" => tracing::warn!(target: "js", "{msg}"),
        "info" | "log" => tracing::info!(target: "js", "{msg}"),
        _ => tracing::debug!(target: "js", "{msg}"),
    }
}

#[rquickjs::function(rename = "now")]
pub fn performance_now() -> f64 {
    use std::time::Instant;
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_secs_f64() * 1000.0
}

#[rquickjs::function(rename = "__host_utf8_encode")]
pub fn host_utf8_encode<'js>(ctx: Ctx<'js>, s: String) -> Result<TypedArray<'js, u8>> {
    TypedArray::new(ctx, s.into_bytes())
}

#[rquickjs::function(rename = "sysInfo")]
pub fn sys_info() -> String {
    format!(
        "Blitz OS (Rust Native, CPU: {}, Arch: {})",
        std::env::consts::FAMILY,
        std::env::consts::ARCH
    )
}
