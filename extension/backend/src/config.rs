use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_iso() -> String {
    chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S%.6f")
        .to_string()
}

pub fn home_dir() -> PathBuf {
    static HOME: OnceLock<PathBuf> = OnceLock::new();
    HOME.get_or_init(|| {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/"))
    })
    .clone()
}

fn default_upload_dir() -> PathBuf {
    home_dir().join("Downloads")
}

fn default_shared_dir() -> PathBuf {
    home_dir().join("Public").join("LocalShare")
}

fn default_server_secret() -> String {
    new_uuid()
}

fn default_port() -> u16 {
    8080
}

fn default_internal_port() -> u16 {
    8765
}

fn default_true() -> bool {
    true
}

/// Lexically normalize an absolute path (like Path.resolve() without requiring
/// the file to exist). Collapses "." and ".." components.
pub fn lexical_resolve(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Config {
    #[serde(default = "default_upload_dir")]
    pub upload_dir: PathBuf,
    #[serde(default = "default_shared_dir")]
    pub shared_dir: PathBuf,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_internal_port")]
    pub internal_port: u16,
    #[serde(default)]
    pub sharing_enabled: bool,
    #[serde(default = "default_server_secret")]
    pub server_secret: String,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default = "default_true")]
    pub notify_on_upload: bool,
    #[serde(default = "default_true")]
    pub notify_on_download: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            upload_dir: default_upload_dir(),
            shared_dir: default_shared_dir(),
            port: 8080,
            internal_port: 8765,
            sharing_enabled: false,
            server_secret: default_server_secret(),
            auto_start: false,
            notify_on_upload: true,
            notify_on_download: true,
        }
    }
}

impl Config {
    pub fn normalize_path(p: &Path) -> PathBuf {
        let expanded = if p == Path::new("~") || p.starts_with("~/") {
            if let Ok(rest) = p.strip_prefix("~") {
                home_dir().join(rest)
            } else {
                p.to_path_buf()
            }
        } else {
            p.to_path_buf()
        };
        let abs = if expanded.is_absolute() {
            expanded
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("/"))
                .join(expanded)
        };
        lexical_resolve(&abs)
    }

    pub fn normalize(&mut self) {
        self.upload_dir = Self::normalize_path(&self.upload_dir);
        self.shared_dir = Self::normalize_path(&self.shared_dir);
    }

    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errs = Vec::new();
        if !(1000..=10000).contains(&self.port) {
            errs.push("port must be in range 1000-10000".into());
        }
        if !(1000..=10000).contains(&self.internal_port) {
            errs.push("internal_port must be in range 1000-10000".into());
        }
        if errs.is_empty() {
            Ok(())
        } else {
            Err(errs)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub internal_port: Option<u16>,
    pub upload_dir: Option<PathBuf>,
    pub shared_dir: Option<PathBuf>,
    pub sharing_enabled: bool,
    pub connected_clients: usize,
    pub pending_clients: usize,
}
