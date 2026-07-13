//! `fetch` bridge: exposes a JS `fetch()` backed by blitz-net's `Provider`.
//!
//! blitz-net's `Provider` is reqwest-based and `tokio::spawn`s each request on
//! a worker pool. The QuickJS runtime, by contrast, is single-threaded and
//! `!Send` (rquickjs uses `Rc`). So we can't resolve the JS `Promise` from the
//! tokio worker thread directly. Instead:
//!
//! 1. JS `fetch(url, init)` registers a Promise + id, calls the Rust host fn
//!    `__fetch_start(id, url, method, headersJson, body)`.
//! 2. `FetchBridge::start_fetch` builds a `blitz_traits::net::Request`, enters
//!    the tokio runtime guard (so the provider's internal `tokio::spawn` has a
//!    context), and calls `Provider::fetch_with_callback`.
//! 3. The callback runs on a tokio worker thread: it pushes a `FetchCompletion`
//!    into a shared `Mutex<Vec>` and wakes the main event loop.
//! 4. `Applier::poll` drains the queue on the JS thread and restores the saved
//!    resolve/reject functions, draining microtasks so `.then` handlers fire.
//!
//! Limitation inherited from blitz-net 0.3.0-alpha.6: it is a *resource* loader,
//! not a full HTTP client surface. The callback yields only `(final_url, body
//! bytes)` on success and a `ProviderError` on failure — never the response
//! status on a 2xx (we report 200), never any response headers, and on a
//! non-2xx the body is discarded (we still surface the status, with an empty
//! body). Good enough for GET-ing JSON/text; not for reading error bodies or
//! response headers.

use std::sync::{Arc, Mutex};

use blitz::net::Provider;
use blitz::traits::net::{
    Body, Bytes, HeaderMap, Method, NetWaker, Request, Url,
    http::{HeaderName, HeaderValue},
};

/// A completed fetch, queued from the tokio worker and drained on the JS thread.
pub struct FetchCompletion {
    pub id: u32,
    pub outcome: FetchOutcome,
}

pub enum FetchOutcome {
    /// Got a response. `status` is 200 on the success path (blitz-net doesn't
    /// expose the real 2xx code) or the exact code for a non-2xx
    /// (`ProviderError::HttpStatus`). `body` is empty for non-2xx (blitz-net
    /// discards it).
    Ok {
        status: u16,
        url: String,
        body: Vec<u8>,
    },
    /// Network/parse error before any response (rejected Promise in JS).
    Err { message: String },
}

pub struct FetchBridge {
    rt: Arc<tokio::runtime::Runtime>,
    provider: Arc<Provider>,
    /// Completions filled by tokio workers, drained by the JS thread in poll.
    completions: Arc<Mutex<Vec<FetchCompletion>>>,
    /// Latest event-loop waker, updated each poll. Fetch callbacks call it to
    /// re-poll the Applier so completions get drained + dispatched.
    waker: Arc<Mutex<Option<std::task::Waker>>>,
}

impl FetchBridge {
    pub fn new() -> Self {
        // Multi-thread runtime: the provider spawns one task per request, and
        // we want them to actually run in parallel rather than queue on a
        // single thread.
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("failed to build tokio runtime for fetch");

        let completions = Arc::new(Mutex::new(Vec::<FetchCompletion>::new()));
        let waker = Arc::new(Mutex::new(None::<std::task::Waker>));

        // The provider's own NetWaker (used by the `NetProvider::fetch` path,
        // not by `fetch_with_callback`). Wire it to the same loop waker so any
        // future use of the trait path also wakes us.
        let net_waker: Arc<dyn NetWaker> = {
            let w = waker.clone();
            Arc::new(move |_doc_id: usize| {
                if let Some(wk) = w.lock().unwrap().as_ref() {
                    wk.wake_by_ref();
                }
            })
        };
        let provider = Arc::new(Provider::new(Some(net_waker)));

        Self {
            rt: Arc::new(rt),
            provider,
            completions,
            waker,
        }
    }

    pub fn rt(&self) -> Arc<tokio::runtime::Runtime> {
        self.rt.clone()
    }

    /// Record the event-loop waker (called from `Applier::poll` each tick) so
    /// fetch completions on worker threads can wake the loop.
    pub fn set_waker(&self, waker: &std::task::Waker) {
        *self.waker.lock().unwrap() = Some(waker.clone());
    }

    /// Drain completed fetches. Called on the JS thread.
    pub fn drain(&self) -> Vec<FetchCompletion> {
        std::mem::take(&mut *self.completions.lock().unwrap())
    }

    /// Start an async fetch. Returns immediately; the completion lands in
    /// `drain()` later (after a wake). Synchronous failures (bad URL/method)
    /// are pushed as an `Err` completion immediately so JS still gets a
    /// rejection.
    pub fn start_fetch(
        &self,
        id: u32,
        url: String,
        method: String,
        headers_json: String,
        body: Option<String>,
    ) {
        let request = match self.build_request(&url, &method, &headers_json, body) {
            Ok(r) => r,
            Err(msg) => {
                self.push(FetchCompletion {
                    id,
                    outcome: FetchOutcome::Err { message: msg },
                });
                return;
            }
        };

        let completions = self.completions.clone();
        let waker = self.waker.clone();
        // Enter the runtime context so the provider's internal `tokio::spawn`
        // has a current runtime. The guard may drop after this call; the
        // spawned task lives on the runtime's worker pool independently.
        let _guard = self.rt.enter();
        self.provider.fetch_with_callback(
            request,
            Box::new(move |result| {
                let completion = match result {
                    Ok((final_url, bytes)) => FetchCompletion {
                        id,
                        outcome: FetchOutcome::Ok {
                            // blitz-net only calls back on 2xx and doesn't
                            // surface the exact status; assume 200.
                            status: 200,
                            url: final_url,
                            body: bytes.to_vec(),
                        },
                    },
                    Err(blitz::net::ProviderError::HttpStatus { status, url }) => FetchCompletion {
                        id,
                        outcome: FetchOutcome::Ok {
                            status: status.as_u16(),
                            url,
                            body: Vec::new(),
                        },
                    },
                    Err(e) => FetchCompletion {
                        id,
                        outcome: FetchOutcome::Err {
                            message: e.to_string(),
                        },
                    },
                };
                completions.lock().unwrap().push(completion);
                if let Some(wk) = waker.lock().unwrap().as_ref() {
                    wk.wake_by_ref();
                }
            }),
        );
    }

    /// Build a `Request` from the JS arguments. Headers come in as a JSON
    /// object (`{name: value}`); body is an optional string.
    fn build_request(
        &self,
        url: &str,
        method: &str,
        headers_json: &str,
        body: Option<String>,
    ) -> Result<Request, String> {
        let parsed_url = Url::parse(url).map_err(|e| format!("bad url: {e}"))?;
        let method = Method::from_bytes(method.trim().to_uppercase().as_bytes())
            .map_err(|e| format!("bad method: {e}"))?;

        let mut headers = HeaderMap::new();
        let mut content_type: Option<String> = None;
        if !headers_json.trim().is_empty() {
            let map: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(headers_json).map_err(|e| format!("bad headers json: {e}"))?;
            for (name, value) in map {
                let value = value
                    .as_str()
                    .ok_or_else(|| format!("header {name} value must be a string"))?
                    .to_string();
                if name.eq_ignore_ascii_case("content-type") {
                    content_type = Some(value.clone());
                }
                let hname = HeaderName::from_bytes(name.as_bytes())
                    .map_err(|e| format!("bad header name: {e}"))?;
                let hval =
                    HeaderValue::from_str(&value).map_err(|e| format!("bad header value: {e}"))?;
                headers.append(hname, hval);
            }
        }

        let body = match body {
            Some(b) if !b.is_empty() => Body::Bytes(Bytes::from(b)),
            _ => Body::Empty,
        };

        // `Request` is `#[non_exhaustive]`, so build via its constructor then
        // set the pub fields directly.
        let mut request = Request::get(parsed_url);
        request.method = method;
        request.content_type = content_type;
        request.headers = headers;
        request.body = body;
        Ok(request)
    }

    fn push(&self, completion: FetchCompletion) {
        self.completions.lock().unwrap().push(completion);
        if let Some(wk) = self.waker.lock().unwrap().as_ref() {
            wk.wake_by_ref();
        }
    }
}

impl Default for FetchBridge {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::task::{Wake, Waker};

    /// A waker that does nothing — tests poll `drain()` manually instead of
    /// driving an event loop.
    struct NoopWake;
    impl Wake for NoopWake {
        fn wake(self: Arc<Self>) {}
    }

    /// Fetch a `data:` URL end-to-end through blitz-net's Provider and the
    /// completion queue (no JS, no event loop). Exercises the tokio spawn path,
    /// the `Mutex<Vec>` handoff, and the `Ok { status: 200, body }` mapping.
    #[test]
    fn fetch_data_url() {
        let bridge = FetchBridge::new();
        bridge.set_waker(&Waker::from(Arc::new(NoopWake)));

        // base64 of "hello"
        bridge.start_fetch(
            1,
            "data:text/plain;base64,aGVsbG8=".into(),
            "GET".into(),
            "{}".into(),
            None,
        );

        let mut completion = None;
        for _ in 0..200 {
            let mut v = bridge.drain();
            if !v.is_empty() {
                completion = v.pop();
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let c = completion.expect("fetch did not complete in time");
        assert_eq!(c.id, 1);
        match c.outcome {
            FetchOutcome::Ok { status, body, .. } => {
                assert_eq!(status, 200);
                assert_eq!(body, b"hello");
            }
            FetchOutcome::Err { message } => panic!("fetch failed: {message}"),
        }
    }

    /// A bad URL is reported as an `Err` completion synchronously (no network).
    #[test]
    fn fetch_bad_url_rejects() {
        let bridge = FetchBridge::new();
        bridge.set_waker(&Waker::from(Arc::new(NoopWake)));

        bridge.start_fetch(2, "not a url".into(), "GET".into(), "{}".into(), None);

        // Sync failure is pushed immediately.
        let v = bridge.drain();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].id, 2);
        assert!(matches!(v[0].outcome, FetchOutcome::Err { .. }));
    }
}
