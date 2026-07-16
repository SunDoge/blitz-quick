//! Desktop host for a Solid application running on Blitz Quick.

use std::path::{Path, PathBuf};

use blitz_quick::AppConfig;
#[cfg(feature = "screenshot")]
use blitz_quick::Applier;
use blitz_quick_desktop::DesktopApp;
use clap::Parser;

use crate::cli::Cli;

mod cli;
mod vite;

const BUNDLE_JS: &str = include_str!("gen/bundle.js");
const BUNDLE_CSS: &str = include_str!("gen/bundle.css");
type AppError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Debug)]
struct Assets {
    javascript: String,
    stylesheet: String,
}

fn main() -> Result<(), AppError> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init()?;

    let cli = Cli::parse();
    let assets = load_assets(&cli)?;
    #[cfg(feature = "screenshot")]
    if let Some(output) = &cli.screenshot {
        return run_screenshot(&cli, &assets, output);
    }
    run_window(&cli, assets)
}

fn load_assets(cli: &Cli) -> Result<Assets, AppError> {
    let (js_path, css_path) = if let Some(dist_dir) = &cli.dist_dir {
        let dist_dir = canonicalize_existing(dist_dir)?;
        (
            Some(dist_dir.join("bundle.js")),
            Some(dist_dir.join("bundle.css")),
        )
    } else {
        (
            cli.js.as_deref().map(canonicalize_existing).transpose()?,
            cli.css.as_deref().map(canonicalize_existing).transpose()?,
        )
    };

    if js_path.is_some() || css_path.is_some() {
        return Ok(Assets {
            javascript: read_asset(js_path.as_deref(), BUNDLE_JS, "JavaScript")?,
            stylesheet: read_asset(css_path.as_deref(), BUNDLE_CSS, "CSS")?,
        });
    }

    #[cfg(debug_assertions)]
    {
        let gen_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/gen");
        let default_js = gen_dir.join("bundle.js");
        let default_css = gen_dir.join("bundle.css");
        if default_js.exists() && default_css.exists() {
            return Ok(Assets {
                javascript: std::fs::read_to_string(&default_js)?,
                stylesheet: std::fs::read_to_string(&default_css)?,
            });
        }
    }

    Ok(Assets {
        javascript: BUNDLE_JS.to_owned(),
        stylesheet: BUNDLE_CSS.to_owned(),
    })
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, AppError> {
    std::fs::canonicalize(path)
        .map_err(|error| format!("failed to resolve {}: {error}", path.display()).into())
}

fn read_asset(path: Option<&Path>, embedded: &str, kind: &str) -> Result<String, AppError> {
    match path {
        Some(path) => std::fs::read_to_string(path).map_err(|error| {
            format!("failed to read {kind} at {}: {error}", path.display()).into()
        }),
        None => Ok(embedded.to_owned()),
    }
}

fn app_config(cli: &Cli, assets: &Assets) -> AppConfig {
    let config = if let Some(server_url) = &cli.vite_url {
        AppConfig::vite(server_url, &cli.vite_entry)
    } else {
        AppConfig::new(assets.javascript.clone())
    };
    let net_provider = blitz_net::Provider::shared(None);
    config
        .with_stylesheet(assets.stylesheet.clone())
        .with_viewport(cli.width, cli.height)
        .with_scale(cli.scale)
        .with_net_provider(net_provider)
}

fn run_window(cli: &Cli, assets: Assets) -> Result<(), AppError> {
    let mut runtime = DesktopApp::new(app_config(cli, &assets))
        .extension(|js| {
            js.with(|ctx| {
                let function = rquickjs::Function::new(ctx.clone(), |message: String| {
                    tracing::info!(%message, "JS FFI message");
                    format!("Rust received: {message}")
                })?;
                ctx.globals().set("myCustomFfi", function)
            })
        })
        .build()?;

    if let Some(server_url) = &cli.vite_url {
        let reload = runtime.applier_mut().reload_handle();
        let _vite_thread = vite::start_hmr_client(server_url, reload)?;
        runtime.run()?;
    } else {
        runtime.run()?;
    }
    Ok(())
}

#[cfg(feature = "screenshot")]
fn run_screenshot(cli: &Cli, assets: &Assets, output: &Path) -> Result<(), AppError> {
    let mut applier = Applier::new(app_config(cli, assets), |_| Ok(()))?;
    for _ in 0..cli.ticks {
        applier.tick_once();
    }
    applier.document_mut().resolve(0.0);

    let render_width = (cli.width as f64 * cli.scale) as u32;
    let render_height = (cli.height as f64 * cli.scale) as u32;
    let rgba = render_dom_to_rgba(
        applier.document_mut(),
        cli.scale,
        render_width,
        render_height,
    );
    image::save_buffer(
        output,
        &rgba,
        render_width,
        render_height,
        image::ExtendedColorType::Rgba8,
    )?;
    tracing::info!(path = %output.display(), "wrote screenshot ({render_width}x{render_height})");
    Ok(())
}

#[cfg(feature = "screenshot")]
fn render_dom_to_rgba(dom: &mut blitz_dom::BaseDocument, scale: f64, w: u32, h: u32) -> Vec<u8> {
    use anyrender::ImageRenderer as _;
    use anyrender::PaintScene as _;
    use anyrender_vello_cpu::VelloCpuImageRenderer;
    use peniko::kurbo::Rect;
    use peniko::{Color, Fill};

    let mut renderer = VelloCpuImageRenderer::new(w, h);
    let mut buffer = Vec::with_capacity((w * h * 4) as usize);
    renderer.render_to_vec(
        |scene| {
            scene.fill(
                Fill::NonZero,
                Default::default(),
                Color::from_rgba8(255, 255, 255, 255),
                None,
                &Rect::new(0.0, 0.0, w as f64, h as f64),
            );
            blitz_paint::paint_scene(scene, dom, scale, w, h, 0, 0);
        },
        &mut buffer,
    );
    buffer
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static NEXT_TEMP_DIR: AtomicU64 = AtomicU64::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let suffix = NEXT_TEMP_DIR.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "blitz-quick-desktop-{}-{suffix}",
                std::process::id()
            ));
            std::fs::create_dir(&path).expect("create temporary directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).expect("remove temporary directory");
        }
    }

    #[test]
    fn loads_javascript_and_css_from_dist_directory() {
        let dist = TempDir::new();
        std::fs::write(dist.path().join("bundle.js"), "globalThis.loaded = true;")
            .expect("write JavaScript bundle");
        std::fs::write(dist.path().join("bundle.css"), "body { color: red; }")
            .expect("write CSS bundle");
        let cli = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--dist-dir",
            dist.path().to_str().expect("UTF-8 temporary path"),
        ])
        .expect("parse CLI");

        let assets = load_assets(&cli).expect("load dist assets");
        assert_eq!(assets.javascript, "globalThis.loaded = true;");
        assert_eq!(assets.stylesheet, "body { color: red; }");
    }

    #[test]
    fn uses_embedded_css_when_only_javascript_is_overridden() {
        let dir = TempDir::new();
        let js_path = dir.path().join("custom.js");
        std::fs::write(&js_path, "globalThis.custom = true;").expect("write JavaScript bundle");
        let cli = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--js",
            js_path.to_str().expect("UTF-8 temporary path"),
        ])
        .expect("parse CLI");

        let assets = load_assets(&cli).expect("load JavaScript asset");

        assert_eq!(assets.javascript, "globalThis.custom = true;");
        assert_eq!(assets.stylesheet, BUNDLE_CSS);
    }

    #[test]
    fn reports_missing_bundle_in_dist_directory() {
        let dist = TempDir::new();
        let cli = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--dist-dir",
            dist.path().to_str().expect("UTF-8 temporary path"),
        ])
        .expect("parse CLI");

        let error = load_assets(&cli).expect_err("missing bundle must fail");

        assert!(error.to_string().contains("failed to read JavaScript"));
        assert!(error.to_string().contains("bundle.js"));
    }
}
