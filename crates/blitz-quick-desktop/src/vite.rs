use serde_json::Value;
use tungstenite::client::IntoClientRequest;

pub fn start_hmr_client(
    server_url: &str,
    reload: blitz_quick::ReloadHandle,
) -> Result<std::thread::JoinHandle<()>, Box<dyn std::error::Error + Send + Sync>> {
    let mut websocket_url = url::Url::parse(server_url)?;
    websocket_url
        .set_scheme(if websocket_url.scheme() == "https" {
            "wss"
        } else {
            "ws"
        })
        .map_err(|()| "invalid Vite WebSocket scheme")?;
    let mut request = websocket_url.as_str().into_client_request()?;
    request.headers_mut().insert(
        tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL,
        "vite-hmr".parse()?,
    );
    let (mut socket, _) = tungstenite::connect(request)?;

    Ok(std::thread::spawn(move || {
        tracing::info!(url = %websocket_url, "Vite HMR client connected");
        while let Ok(message) = socket.read() {
            let Ok(text) = message.to_text() else {
                continue;
            };
            let Ok(payload) = serde_json::from_str::<Value>(text) else {
                continue;
            };
            if !forward_payload(&payload, &reload) {
                break;
            }
        }
        tracing::warn!("Vite HMR client disconnected");
    }))
}

fn forward_payload(payload: &Value, reload: &blitz_quick::ReloadHandle) -> bool {
    messages(payload)
        .into_iter()
        .all(|message| reload.send(message).is_ok())
}

fn messages(payload: &Value) -> Vec<blitz_quick::ReloadMsg> {
    match payload.get("type").and_then(Value::as_str) {
        Some("update") => payload
            .get("updates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|update| update.get("type").and_then(Value::as_str) == Some("js-update"))
            .filter_map(|update| {
                let path = update.get("path").and_then(Value::as_str)?;
                let accepted_path = update.get("acceptedPath").and_then(Value::as_str)?;
                let timestamp = update.get("timestamp").and_then(Value::as_u64)?;
                tracing::debug!(%path, %accepted_path, timestamp, "received Vite HMR update");
                Some(blitz_quick::ReloadMsg::HmrUpdate {
                    path: path.to_owned(),
                    accepted_path: accepted_path.to_owned(),
                    timestamp,
                })
            })
            .collect(),
        Some("full-reload") => vec![blitz_quick::ReloadMsg::FullReload],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_vite_javascript_updates() {
        let payload = serde_json::json!({
            "type": "update",
            "updates": [{
                "type": "js-update",
                "path": "/src/Counter.tsx",
                "acceptedPath": "/src/Counter.tsx",
                "timestamp": 42
            }]
        });
        assert_eq!(
            messages(&payload),
            vec![blitz_quick::ReloadMsg::HmrUpdate {
                path: "/src/Counter.tsx".to_owned(),
                accepted_path: "/src/Counter.tsx".to_owned(),
                timestamp: 42,
            }]
        );
    }
}
