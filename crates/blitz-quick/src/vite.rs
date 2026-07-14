use rquickjs::loader::{ImportAttributes, Loader, Resolver};
use rquickjs::{Ctx, Error, Module, Result};
use url::Url;

pub(crate) const HMR_CLIENT: &str = r#"
const records = globalThis.__blitz_hmr_records ??= new Map();

export function createHotContext(ownerPath) {
  let record = records.get(ownerPath);
  if (!record) {
    record = { data: {}, current: null, next: null, loading: false };
    records.set(ownerPath, record);
  }

  const context = {
    data: record.data,
    accepted: [],
    disposed: [],
    invalidated: false,
    accept(callback) {
      if (typeof callback === "function") this.accepted.push(callback);
    },
    dispose(callback) {
      this.disposed.push(callback);
    },
    decline() {
      this.invalidated = true;
    },
    invalidate() {
      this.invalidated = true;
    },
    on() {},
    send() {},
    prune() {},
  };

  if (record.loading) record.next = context;
  else record.current = context;
  return context;
}

globalThis.__blitz_apply_hmr = async function (path, acceptedPath, timestamp) {
  const record = records.get(path);
  if (!record?.current) return false;

  const previous = record.current;
  for (const dispose of previous.disposed) dispose(record.data);
  record.loading = true;
  record.next = null;

  try {
    const separator = acceptedPath.includes("?") ? "&" : "?";
    const module = await import(`${acceptedPath}${separator}t=${timestamp}`);
    const next = record.next;
    if (!next || next.invalidated) return false;
    record.current = next;
    for (const accept of previous.accepted) accept(module);
    return !previous.invalidated;
  } finally {
    record.loading = false;
    record.next = null;
  }
};
"#;

pub(crate) struct ViteResolver {
    origin: Url,
}

impl ViteResolver {
    pub(crate) fn new(origin: Url) -> Self {
        Self { origin }
    }

    fn resolve_url(&self, base: &str, name: &str) -> Option<Url> {
        if let Ok(url) = Url::parse(name) {
            return Some(url);
        }
        if name.starts_with('/') {
            return self.origin.join(name).ok();
        }
        Url::parse(base)
            .ok()
            .and_then(|base| base.join(name).ok())
            .or_else(|| self.origin.join(name).ok())
    }
}

impl Resolver for ViteResolver {
    fn resolve<'js>(
        &mut self,
        _ctx: &Ctx<'js>,
        base: &str,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> Result<String> {
        self.resolve_url(base, name)
            .map(Into::into)
            .ok_or_else(|| Error::new_resolving_message(base, name, "invalid Vite module URL"))
    }
}

pub(crate) struct ViteLoader {
    agent: ureq::Agent,
}

impl ViteLoader {
    pub(crate) fn new() -> Self {
        let config = ureq::Agent::config_builder().proxy(None).build();
        Self {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl Loader for ViteLoader {
    fn load<'js>(
        &mut self,
        ctx: &Ctx<'js>,
        name: &str,
        _attributes: Option<ImportAttributes<'js>>,
    ) -> Result<Module<'js>> {
        let source = if Url::parse(name)
            .ok()
            .is_some_and(|url| url.path() == "/@vite/client")
        {
            HMR_CLIENT.to_owned()
        } else {
            let mut response = self
                .agent
                .get(name)
                .call()
                .map_err(|error| Error::new_loading_message(name, error.to_string()))?;
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if !content_type.contains("javascript") {
                return Err(Error::new_loading_message(
                    name,
                    format!("expected JavaScript from Vite, received {content_type:?}"),
                ));
            }
            response
                .body_mut()
                .read_to_string()
                .map_err(|error| Error::new_loading_message(name, error.to_string()))?
        };
        Module::declare(ctx.clone(), name, source)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_vite_module_urls() {
        let resolver = ViteResolver::new(Url::parse("http://127.0.0.1:5173/").unwrap());

        assert_eq!(
            resolver
                .resolve_url("http://127.0.0.1:5173/src/App.tsx", "./Counter.tsx")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:5173/src/Counter.tsx"
        );
        assert_eq!(
            resolver
                .resolve_url("http://127.0.0.1:5173/src/App.tsx", "/@solid-refresh")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:5173/@solid-refresh"
        );
    }
}
