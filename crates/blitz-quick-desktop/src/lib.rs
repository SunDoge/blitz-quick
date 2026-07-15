//! Reusable desktop host for Blitz Quick applications.

use anyrender_vello::VelloWindowRenderer as WindowRenderer;
use blitz_quick::{AppConfig, Applier, JsRuntime};
use blitz_shell::{
    BlitzApplication, BlitzShellProxy, EventLoop, WindowConfig, create_default_event_loop,
};

pub type DesktopError = Box<dyn std::error::Error + Send + Sync>;
type Extension = Box<dyn Fn(&JsRuntime) -> rquickjs::Result<()> + 'static>;

/// Configures a desktop application and its Rust-provided JavaScript APIs.
pub struct DesktopApp {
    config: AppConfig,
    extensions: Vec<Extension>,
}

impl DesktopApp {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config,
            extensions: Vec::new(),
        }
    }

    /// Register Rust functions or values in the QuickJS runtime before boot.
    pub fn extension(
        mut self,
        extension: impl Fn(&JsRuntime) -> rquickjs::Result<()> + 'static,
    ) -> Self {
        self.extensions.push(Box::new(extension));
        self
    }

    pub fn build(self) -> Result<DesktopRuntime, DesktopError> {
        let extensions = self.extensions;
        let applier = Applier::new(self.config, move |js| {
            for extension in &extensions {
                extension(js)?;
            }
            Ok(())
        })?;
        Ok(DesktopRuntime { applier })
    }

    pub fn run(self) -> Result<(), DesktopError> {
        self.build()?.run()
    }
}

/// A built application that can be integrated with host services before run.
pub struct DesktopRuntime {
    applier: Applier,
}

impl DesktopRuntime {
    pub fn applier(&self) -> &Applier {
        &self.applier
    }

    pub fn applier_mut(&mut self) -> &mut Applier {
        &mut self.applier
    }

    pub fn run(self) -> Result<(), DesktopError> {
        let event_loop: EventLoop = create_default_event_loop();
        let (proxy, receiver) = BlitzShellProxy::new(event_loop.create_proxy());
        let mut application: BlitzApplication<WindowRenderer> =
            BlitzApplication::new(proxy, receiver);
        application.add_window(WindowConfig::new(
            Box::new(self.applier) as _,
            WindowRenderer::new(),
        ));
        event_loop.run_app(application)?;
        Ok(())
    }
}
