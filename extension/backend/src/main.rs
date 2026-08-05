mod auth;
mod browser;
mod config;
mod events;
mod internal;
mod json_store;
mod models;
mod network;
mod server;
mod storage;

use std::path::PathBuf;
use std::sync::Arc;

use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::broadcast;

use crate::server::ServerManager;
use crate::storage::StorageManager;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<StorageManager>,
    pub manager: Arc<ServerManager>,
}

async fn wait_sigterm() {
    if let Ok(mut s) = signal(SignalKind::terminate()) {
        s.recv().await;
    }
}

#[tokio::main]
async fn main() {
    let mut internal_port: u16 = 8765;
    let mut data_dir: Option<PathBuf> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--internal-port" => {
                if let Some(v) = args.next() {
                    match v.parse::<u16>() {
                        Ok(p) if (1000..=10000).contains(&p) => internal_port = p,
                        _ => {
                            eprintln!("Invalid --internal-port '{v}': must be in range 1000-10000");
                            std::process::exit(1);
                        }
                    }
                }
            }
            "--data-dir" => {
                if let Some(v) = args.next() {
                    data_dir = Some(PathBuf::from(v));
                }
            }
            _ => {}
        }
    }
    let data_dir = data_dir.unwrap_or_else(|| PathBuf::from("data"));

    let (tx, _rx) = broadcast::channel::<events::EventMsg>(256);
    let storage = Arc::new(StorageManager::new(data_dir));
    let manager = Arc::new(ServerManager::new(storage.clone(), tx));
    let state = Arc::new(AppState { storage, manager });

    let internal_router = internal::build_router(state.clone());

    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", internal_port)).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Internal server failed to bind on 127.0.0.1:{internal_port}: {e}");
            std::process::exit(1);
        }
    };

    eprintln!("Starting LocalShare backend");
    eprintln!("Internal API: 127.0.0.1:{internal_port}");
    eprintln!("Data directory: {}", state.storage.data_dir.display());
    eprintln!("Browser server (LAN) is managed by the internal API via /internal/start");

    let state_for_shutdown = state.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = wait_sigterm() => {}
        }
        state_for_shutdown.manager.shutdown().await;
        std::process::exit(0);
    });

    if let Err(e) = axum::serve(listener, internal_router.into_make_service()).await {
        eprintln!("Internal server error: {e}");
        state.manager.shutdown().await;
    }
}
