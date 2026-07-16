//! Hacker News app — Rust shell.

use blitz_quick::AppConfig;
use blitz_quick::rquickjs;
use blitz_quick_desktop::DesktopApp;
use futures_util::{StreamExt, stream};
use snafu::{ResultExt, Whatever};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(feature = "vite")]
use blitz_quick::start_hmr_client;

#[cfg(not(feature = "vite"))]
const BUNDLE_JS: &str = include_str!("../dist/bundle.js");
#[cfg(not(feature = "vite"))]
const BUNDLE_CSS: &str = include_str!("../dist/bundle.css");
#[cfg(feature = "vite")]
const DEFAULT_VITE_URL: &str = "http://127.0.0.1:5174";

const HN_API: &str = "https://hacker-news.firebaseio.com/v0";
const CACHE_TTL: Duration = Duration::from_secs(120);
const ITEM_CONCURRENCY: usize = 8;
const STORY_LIMIT: usize = 30;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum Feed {
    Top,
    New,
    Best,
}

impl Feed {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "top" => Some(Self::Top),
            "new" => Some(Self::New),
            "best" => Some(Self::Best),
            _ => None,
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Top => "topstories",
            Self::New => "newstories",
            Self::Best => "beststories",
        }
    }
}

#[derive(Clone)]
struct CachedFeed {
    inserted_at: Instant,
    json: String,
}

struct HackerNewsClient {
    client: reqwest::Client,
    cache: Mutex<HashMap<Feed, CachedFeed>>,
}

impl HackerNewsClient {
    fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
            cache: Mutex::new(HashMap::new()),
        })
    }

    async fn fetch_stories(&self, feed: Feed, force: bool) -> rquickjs::Result<String> {
        if !force && let Some(json) = self.cached(feed) {
            tracing::debug!(?feed, "using cached Hacker News feed");
            return Ok(json);
        }

        let ids: Vec<u64> = self
            .client
            .get(format!("{HN_API}/{}.json", feed.endpoint()))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| {
                tracing::error!(?feed, %error, "failed to fetch Hacker News feed");
                rquickjs::Error::Unknown
            })?
            .json()
            .await
            .map_err(|error| {
                tracing::error!(?feed, %error, "failed to decode Hacker News feed");
                rquickjs::Error::Unknown
            })?;

        let mut stories = stream::iter(ids.into_iter().take(STORY_LIMIT).enumerate())
            .map(|(index, id)| async move {
                let story = self.fetch_story(id).await;
                (index, story)
            })
            .buffer_unordered(ITEM_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;
        stories.sort_unstable_by_key(|(index, _)| *index);

        let json = serde_json::to_string(
            &stories
                .into_iter()
                .map(|(_, story)| story)
                .collect::<Vec<_>>(),
        )
        .map_err(|error| {
            tracing::error!(%error, "failed to encode Hacker News stories");
            rquickjs::Error::Unknown
        })?;

        self.cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(
                feed,
                CachedFeed {
                    inserted_at: Instant::now(),
                    json: json.clone(),
                },
            );
        Ok(json)
    }

    fn cached(&self, feed: Feed) -> Option<String> {
        self.cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(&feed)
            .filter(|entry| entry.inserted_at.elapsed() < CACHE_TTL)
            .map(|entry| entry.json.clone())
    }

    async fn fetch_story(&self, id: u64) -> serde_json::Value {
        match self
            .client
            .get(format!("{HN_API}/item/{id}.json"))
            .send()
            .await
        {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response.json().await.unwrap_or_else(|error| {
                    tracing::warn!(id, %error, "failed to decode Hacker News story");
                    fallback_story(id)
                }),
                Err(error) => {
                    tracing::warn!(id, %error, "failed to fetch Hacker News story");
                    fallback_story(id)
                }
            },
            Err(error) => {
                tracing::warn!(id, %error, "failed to fetch Hacker News story");
                fallback_story(id)
            }
        }
    }
}

fn fallback_story(id: u64) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "title": "[failed to load]",
        "url": "",
        "by": "",
        "score": 0,
        "descendants": 0,
    })
}

fn main() -> Result<(), Whatever> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init()
        .whatever_context("failed to init tracing")?;

    let net_provider = blitz_net::Provider::shared(None);
    let hn_client =
        Arc::new(HackerNewsClient::new().whatever_context("failed to create Hacker News client")?);

    #[cfg(feature = "vite")]
    let vite_url = std::env::var("VITE_URL").unwrap_or_else(|_| DEFAULT_VITE_URL.to_owned());

    #[cfg(feature = "vite")]
    let config = AppConfig::vite(&vite_url, "packages/index.tsx");
    #[cfg(not(feature = "vite"))]
    let config = AppConfig::new(BUNDLE_JS).with_stylesheet(BUNDLE_CSS);

    let app = DesktopApp::new(
        config
            .with_viewport(1040, 720)
            .with_net_provider(net_provider),
    )
    .extension(move |js| {
        let hn_client = Arc::clone(&hn_client);
        js.with(move |ctx| {
            let f = rquickjs::Function::new(
                ctx.clone(),
                rquickjs::prelude::Async(move |feed: String, force: bool| {
                    let hn_client = Arc::clone(&hn_client);
                    async move {
                        let feed = Feed::parse(&feed).ok_or(rquickjs::Error::Unknown)?;
                        hn_client.fetch_stories(feed, force).await
                    }
                }),
            )?;
            ctx.globals().set("fetchStories", f)
        })
    })
    .build()
    .whatever_context("failed to build app")?;

    #[cfg(feature = "vite")]
    {
        let mut app = app;
        let reload = app.applier_mut().reload_handle();
        let _hmr = start_hmr_client(&vite_url, reload)
            .whatever_context("failed to start Vite HMR client")?;
        app.run().whatever_context("app exited with error")?;
    }
    #[cfg(not(feature = "vite"))]
    app.run().whatever_context("app exited with error")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Feed;

    #[test]
    fn parses_supported_feeds() {
        assert_eq!(Feed::parse("top"), Some(Feed::Top));
        assert_eq!(Feed::parse("new"), Some(Feed::New));
        assert_eq!(Feed::parse("best"), Some(Feed::Best));
        assert_eq!(Feed::parse("saved"), None);
    }

    #[test]
    fn maps_feeds_to_api_endpoints() {
        assert_eq!(Feed::Top.endpoint(), "topstories");
        assert_eq!(Feed::New.endpoint(), "newstories");
        assert_eq!(Feed::Best.endpoint(), "beststories");
    }
}
