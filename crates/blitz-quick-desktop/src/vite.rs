use serde::Deserialize;
use tungstenite::client::IntoClientRequest;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum VitePayload {
    Update {
        updates: Vec<ViteUpdate>,
    },
    FullReload,
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ViteUpdate {
    JsUpdate {
        path: String,
        #[serde(rename = "acceptedPath")]
        accepted_path: String,
        timestamp: u64,
    },
    CssUpdate {
        #[serde(rename = "acceptedPath")]
        accepted_path: String,
        timestamp: u64,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, PartialEq, Eq)]
enum ViteMessage {
    Update {
        path: String,
        accepted_path: String,
        timestamp: u64,
    },
    CssUpdate {
        accepted_path: String,
        timestamp: u64,
    },
    FullReload,
}

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
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let client = reqwest::Client::builder().no_proxy().build()?;
    let server_url = url::Url::parse(server_url)?;

    Ok(std::thread::spawn(move || {
        tracing::info!(url = %websocket_url, "Vite HMR client connected");
        while let Ok(message) = socket.read() {
            let Ok(text) = message.to_text() else {
                continue;
            };
            let payload = match serde_json::from_str::<VitePayload>(text) {
                Ok(payload) => payload,
                Err(error) => {
                    tracing::warn!(?error, payload = text, "invalid Vite HMR payload");
                    continue;
                }
            };
            for message in messages(payload) {
                let result = match message {
                    ViteMessage::Update {
                        path,
                        accepted_path,
                        timestamp,
                    } => {
                        tracing::debug!(%path, %accepted_path, timestamp, "received Vite HMR update");
                        let started = std::time::Instant::now();
                        match runtime.block_on(fetch_module(
                            &client,
                            &server_url,
                            &accepted_path,
                            timestamp,
                        )) {
                            Ok(source) => {
                                tracing::debug!(%path, elapsed = ?started.elapsed(), "prefetched Vite HMR module");
                                match runtime.block_on(fetch_stylesheet(
                                    &client,
                                    &server_url,
                                    "/__uno.css",
                                    timestamp,
                                )) {
                                    Ok(stylesheet) => {
                                        let _ =
                                            reload.send(blitz_quick::ReloadMsg::Css(stylesheet));
                                    }
                                    Err(error) => {
                                        tracing::warn!(?error, "failed to refresh UnoCSS module");
                                    }
                                }
                                reload.send(blitz_quick::ReloadMsg::HmrUpdate {
                                    path,
                                    accepted_path,
                                    timestamp,
                                    source,
                                })
                            }
                            Err(error) => {
                                tracing::error!(%path, %accepted_path, ?error, "failed to prefetch Vite HMR module");
                                continue;
                            }
                        }
                    }
                    ViteMessage::CssUpdate {
                        accepted_path,
                        timestamp,
                    } => {
                        match runtime.block_on(fetch_stylesheet(
                            &client,
                            &server_url,
                            &accepted_path,
                            timestamp,
                        )) {
                            Ok(stylesheet) => reload.send(blitz_quick::ReloadMsg::Css(stylesheet)),
                            Err(error) => {
                                tracing::error!(?error, "failed to fetch Vite stylesheet update");
                                continue;
                            }
                        }
                    }
                    ViteMessage::FullReload => reload.send(blitz_quick::ReloadMsg::FullReload),
                };
                if result.is_err() {
                    tracing::warn!("Vite HMR receiver disconnected");
                    return;
                }
            }
        }
        tracing::warn!("Vite HMR client disconnected");
    }))
}

async fn fetch_module(
    client: &reqwest::Client,
    server_url: &url::Url,
    accepted_path: &str,
    timestamp: u64,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut module_url = server_url.join(accepted_path)?;
    module_url
        .query_pairs_mut()
        .append_pair("t", &timestamp.to_string());
    let response = client.get(module_url).send().await?.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.contains("javascript") {
        return Err(format!("expected JavaScript, received {content_type:?}").into());
    }
    Ok(response.text().await?)
}

async fn fetch_stylesheet(
    client: &reqwest::Client,
    server_url: &url::Url,
    accepted_path: &str,
    timestamp: u64,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut stylesheet_url = server_url.join(accepted_path)?;
    stylesheet_url
        .query_pairs_mut()
        .append_pair("direct", "")
        .append_pair("t", &timestamp.to_string());
    let response = client
        .get(stylesheet_url)
        .send()
        .await?
        .error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !content_type.contains("text/css") {
        return Err(format!("expected CSS, received {content_type:?}").into());
    }
    Ok(response.text().await?)
}

fn messages(payload: VitePayload) -> Vec<ViteMessage> {
    match payload {
        VitePayload::Update { updates } => updates
            .into_iter()
            .filter_map(|update| match update {
                ViteUpdate::JsUpdate {
                    path,
                    accepted_path,
                    timestamp,
                } => {
                    if accepted_path
                        .split_once('?')
                        .map_or(accepted_path.as_str(), |(path, _)| path)
                        .ends_with(".css")
                    {
                        Some(ViteMessage::CssUpdate {
                            accepted_path,
                            timestamp,
                        })
                    } else {
                        Some(ViteMessage::Update {
                            path,
                            accepted_path,
                            timestamp,
                        })
                    }
                }
                ViteUpdate::CssUpdate {
                    accepted_path,
                    timestamp,
                } => Some(ViteMessage::CssUpdate {
                    accepted_path,
                    timestamp,
                }),
                ViteUpdate::Other => None,
            })
            .collect(),
        VitePayload::FullReload => vec![ViteMessage::FullReload],
        VitePayload::Other => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_vite_javascript_updates() {
        let payload = serde_json::from_str(
            r#"{
                "type": "update",
                "updates": [{
                    "type": "js-update",
                    "path": "/src/Counter.tsx",
                    "acceptedPath": "/src/Counter.tsx",
                    "timestamp": 42
                }]
            }"#,
        )
        .unwrap();
        assert_eq!(
            messages(payload),
            vec![ViteMessage::Update {
                path: "/src/Counter.tsx".to_owned(),
                accepted_path: "/src/Counter.tsx".to_owned(),
                timestamp: 42,
            }]
        );
    }

    #[test]
    fn handles_css_updates_and_ignores_unknown_payloads() {
        let connected = serde_json::from_str(r#"{"type":"connected"}"#).unwrap();
        let css_update = serde_json::from_str(
            r#"{"type":"update","updates":[{
                "type":"css-update",
                "acceptedPath":"/@id/__x00__virtual:uno.css",
                "timestamp":42
            }]}"#,
        )
        .unwrap();

        assert!(messages(connected).is_empty());
        assert_eq!(
            messages(css_update),
            vec![ViteMessage::CssUpdate {
                accepted_path: "/@id/__x00__virtual:uno.css".to_owned(),
                timestamp: 42,
            }]
        );
    }

    #[test]
    fn treats_vite_css_wrapper_modules_as_stylesheets() {
        let payload = serde_json::from_str(
            r#"{"type":"update","updates":[{
                "type":"js-update",
                "path":"/__uno.css",
                "acceptedPath":"/__uno.css",
                "timestamp":42
            }]}"#,
        )
        .unwrap();

        assert_eq!(
            messages(payload),
            vec![ViteMessage::CssUpdate {
                accepted_path: "/__uno.css".to_owned(),
                timestamp: 42,
            }]
        );
    }
}
