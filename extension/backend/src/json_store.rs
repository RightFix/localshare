use std::marker::PhantomData;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;

pub struct JsonStore<T> {
    path: PathBuf,
    lock: tokio::sync::Mutex<()>,
    _marker: PhantomData<T>,
}

impl<T> JsonStore<T>
where
    T: Default + Serialize + DeserializeOwned + Clone,
{
    pub fn new(path: PathBuf) -> Self {
        JsonStore {
            path,
            lock: tokio::sync::Mutex::new(()),
            _marker: PhantomData,
        }
    }

    async fn read(&self) -> Option<T> {
        let content = match tokio::fs::read_to_string(&self.path).await {
            Ok(c) => c,
            Err(_) => return Some(T::default()),
        };
        if content.trim().is_empty() {
            return Some(T::default());
        }
        match serde_json::from_str(&content) {
            Ok(v) => Some(v),
            Err(e) => {
                eprintln!(
                    "Failed to parse {}: {e}",
                    self.path.display()
                );
                Some(T::default())
            }
        }
    }

    async fn write(&self, data: &T) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string_pretty(data)?;
        let tmp = self.path.with_extension("tmp");
        tokio::fs::write(&tmp, json).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }

    pub async fn load(&self) -> T {
        let _guard = self.lock.lock().await;
        self.read().await.unwrap_or_default()
    }

    pub async fn save(&self, data: &T) {
        let _guard = self.lock.lock().await;
        let _ = self.write(data).await;
    }

    pub async fn update(&self, mutator: impl FnOnce(&mut T)) -> T {
        let _guard = self.lock.lock().await;
        let mut data = self.read().await.unwrap_or_default();
        mutator(&mut data);
        let _ = self.write(&data).await;
        data
    }
}
