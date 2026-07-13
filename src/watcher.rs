use notify::{EventKind, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;

pub fn start_bundle_watcher(
    dir: PathBuf,
    tx: std::sync::Arc<std::sync::Mutex<mpsc::Sender<crate::applier::ReloadMsg>>>,
) {
    std::thread::spawn(move || {
        let (notify_tx, notify_rx) = mpsc::channel();
        let mut watcher = notify::recommended_watcher(notify_tx).unwrap();
        let gen_dir = dir.join("src/gen");

        let _ = watcher.watch(&gen_dir, RecursiveMode::Recursive);
        tracing::info!("Bundle watcher started on {:?}", gen_dir);

        while let Ok(res) = notify_rx.recv() {
            if let Ok(event) = res {
                if let EventKind::Modify(_) = event.kind {
                    let mut js_changed = false;
                    let mut css_changed = false;
                    for p in event.paths {
                        if p.ends_with("bundle.js") {
                            js_changed = true;
                        } else if p.ends_with("bundle.css") {
                            css_changed = true;
                        }
                    }

                    if js_changed {
                        let path = gen_dir.join("bundle.js");
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            if let Ok(guard) = tx.lock() {
                                let _ = guard.send(crate::applier::ReloadMsg::Js(content));
                            }
                        }
                    }
                    if css_changed {
                        let path = gen_dir.join("bundle.css");
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            if let Ok(guard) = tx.lock() {
                                let _ = guard.send(crate::applier::ReloadMsg::Css(content));
                            }
                        }
                    }
                }
            }
        }
    });
}
