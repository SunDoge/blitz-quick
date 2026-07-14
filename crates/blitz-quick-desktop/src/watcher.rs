use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use notify::{EventKind, RecursiveMode, Watcher};

pub fn start_asset_watcher(
    js_path: Option<PathBuf>,
    css_path: Option<PathBuf>,
    tx: mpsc::Sender<blitz_quick::ReloadMsg>,
) -> notify::Result<std::thread::JoinHandle<()>> {
    let (notify_tx, notify_rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(notify_tx)?;
    let mut watched_directories = HashSet::new();
    for path in [&js_path, &css_path].into_iter().flatten() {
        if let Some(parent) = path.parent()
            && watched_directories.insert(parent.to_owned())
        {
            watcher.watch(parent, RecursiveMode::NonRecursive)?;
        }
    }

    Ok(std::thread::spawn(move || {
        let _watcher = watcher;
        tracing::info!(?js_path, ?css_path, "asset watcher started");

        while let Ok(result) = notify_rx.recv() {
            let event = match result {
                Ok(event) if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) => {
                    event
                }
                Ok(_) => continue,
                Err(error) => {
                    tracing::warn!(?error, "asset watcher error");
                    continue;
                }
            };

            if changed(&event.paths, js_path.as_deref())
                && !send_asset(js_path.as_deref(), &tx, blitz_quick::ReloadMsg::Js)
            {
                break;
            }
            if changed(&event.paths, css_path.as_deref())
                && !send_asset(css_path.as_deref(), &tx, blitz_quick::ReloadMsg::Css)
            {
                break;
            }
        }
    }))
}

fn changed(event_paths: &[PathBuf], watched_path: Option<&Path>) -> bool {
    watched_path.is_some_and(|watched| event_paths.iter().any(|path| path == watched))
}

fn send_asset(
    path: Option<&Path>,
    tx: &mpsc::Sender<blitz_quick::ReloadMsg>,
    message: impl FnOnce(String) -> blitz_quick::ReloadMsg,
) -> bool {
    let Some(path) = path else {
        return true;
    };
    match std::fs::read_to_string(path) {
        Ok(content) => tx.send(message(content)).is_ok(),
        Err(error) => {
            tracing::warn!(?path, ?error, "failed to reload asset");
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_requires_an_exact_watched_path() {
        let watched = Path::new("dist/bundle.js");
        let event_paths = vec![
            PathBuf::from("dist/bundle.css"),
            PathBuf::from("dist/bundle.js.map"),
        ];

        assert!(!changed(&event_paths, Some(watched)));
        assert!(changed(&[watched.to_owned()], Some(watched)));
        assert!(!changed(&[watched.to_owned()], None));
    }

    #[test]
    fn send_asset_reads_content_into_reload_message() {
        let path =
            std::env::temp_dir().join(format!("blitz-quick-watcher-{}.css", std::process::id()));
        std::fs::write(&path, "body { color: green; }").expect("write temporary asset");
        let (tx, rx) = mpsc::channel();

        let sent = send_asset(Some(&path), &tx, blitz_quick::ReloadMsg::Css);

        std::fs::remove_file(path).expect("remove temporary asset");
        assert!(sent);
        assert_eq!(
            rx.recv().expect("receive reload message"),
            blitz_quick::ReloadMsg::Css("body { color: green; }".to_owned())
        );
    }
}
