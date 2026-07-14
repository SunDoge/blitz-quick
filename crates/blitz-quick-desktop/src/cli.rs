use std::path::PathBuf;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(version, about = "Desktop host for Blitz Quick applications")]
pub struct Cli {
    /// Vite development server URL. Enables module-level HMR.
    #[arg(
        long,
        value_name = "URL",
        conflicts_with_all = ["dist_dir", "js", "screenshot"]
    )]
    pub vite_url: Option<String>,

    /// Application module loaded from the Vite development server.
    #[arg(long, value_name = "PATH", default_value = "/src/index.tsx")]
    pub vite_entry: String,

    /// Directory containing bundle.js and bundle.css.
    #[arg(long, value_name = "DIR", conflicts_with_all = ["js", "css"])]
    pub dist_dir: Option<PathBuf>,

    /// Path to the JavaScript application bundle.
    #[arg(long, value_name = "FILE")]
    pub js: Option<PathBuf>,

    /// Path to the application stylesheet.
    #[arg(long, value_name = "FILE")]
    pub css: Option<PathBuf>,

    /// Render headlessly to an optional PNG path.
    #[arg(
        long,
        value_name = "PNG",
        num_args = 0..=1,
        default_missing_value = "frame.png"
    )]
    pub screenshot: Option<PathBuf>,

    /// Logical viewport width.
    #[arg(long, default_value_t = 800, value_parser = clap::value_parser!(u32).range(1..))]
    pub width: u32,

    /// Logical viewport height.
    #[arg(long, default_value_t = 600, value_parser = clap::value_parser!(u32).range(1..))]
    pub height: u32,

    /// Device scale factor used for layout and rendering.
    #[arg(long, default_value_t = 2.0, value_parser = parse_positive_f64)]
    pub scale: f64,

    /// Number of runtime ticks before taking a screenshot.
    #[arg(long, default_value_t = 1, value_parser = clap::value_parser!(u32).range(1..))]
    pub ticks: u32,
}

fn parse_positive_f64(value: &str) -> Result<f64, String> {
    let parsed = value
        .parse::<f64>()
        .map_err(|error| format!("invalid scale: {error}"))?;
    if parsed.is_finite() && parsed > 0.0 {
        Ok(parsed)
    } else {
        Err("scale must be finite and positive".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_screenshot_test_options() {
        let cli = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--dist-dir",
            "dist",
            "--screenshot",
            "result.png",
            "--width",
            "1024",
            "--height",
            "768",
            "--scale",
            "1.5",
            "--ticks",
            "3",
        ])
        .expect("parse CLI");

        assert_eq!(cli.dist_dir, Some(PathBuf::from("dist")));
        assert_eq!(cli.screenshot, Some(PathBuf::from("result.png")));
        assert_eq!((cli.width, cli.height, cli.ticks), (1024, 768, 3));
        assert_eq!(cli.scale, 1.5);
    }

    #[test]
    fn rejects_conflicting_asset_sources() {
        let error = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--dist-dir",
            "dist",
            "--js",
            "app.js",
        ])
        .expect_err("asset sources must conflict");

        assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn parses_vite_development_mode() {
        let cli = Cli::try_parse_from([
            "blitz-quick-desktop",
            "--vite-url",
            "http://127.0.0.1:5173",
            "--vite-entry",
            "/src/main.tsx",
        ])
        .expect("parse Vite options");

        assert_eq!(cli.vite_url.as_deref(), Some("http://127.0.0.1:5173"));
        assert_eq!(cli.vite_entry, "/src/main.tsx");
    }

    #[test]
    fn screenshot_path_is_optional() {
        let cli = Cli::try_parse_from(["blitz-quick-desktop", "--screenshot"])
            .expect("parse screenshot flag");

        assert_eq!(cli.screenshot, Some(PathBuf::from("frame.png")));
    }

    #[test]
    fn rejects_non_positive_render_options() {
        for args in [
            ["blitz-quick-desktop", "--width", "0"],
            ["blitz-quick-desktop", "--height", "0"],
            ["blitz-quick-desktop", "--ticks", "0"],
            ["blitz-quick-desktop", "--scale", "0"],
        ] {
            let error = Cli::try_parse_from(args).expect_err("zero value must be rejected");
            assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        }
    }

    #[test]
    fn rejects_non_finite_scale() {
        for scale in ["NaN", "inf"] {
            let error = Cli::try_parse_from(["blitz-quick-desktop", "--scale", scale])
                .expect_err("invalid scale must be rejected");
            assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
        }

        let error = Cli::try_parse_from(["blitz-quick-desktop", "--scale=-1"])
            .expect_err("negative scale must be rejected");
        assert_eq!(error.kind(), clap::error::ErrorKind::ValueValidation);
    }
}
