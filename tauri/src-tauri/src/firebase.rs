use std::path::Path;
use serde_json::Value;
use yup_oauth2::{read_service_account_key, ServiceAccountAuthenticator};

pub struct FirebaseClient {
    db_url: String,
    authenticator: Option<yup_oauth2::authenticator::Authenticator<hyper_rustls::HttpsConnector<hyper_util::client::legacy::connect::HttpConnector>>>,
    client: reqwest::Client,
}

impl FirebaseClient {
    pub async fn new(service_account_path: &str, db_url: &str) -> Self {
        let client = reqwest::Client::new();
        let db_url = db_url.trim_end_matches('/').to_string();

        if Path::new(service_account_path).exists() {
            match read_service_account_key(service_account_path).await {
                Ok(key) => {
                    match ServiceAccountAuthenticator::builder(key).build().await {
                        Ok(authenticator) => {
                            println!("✅ Firebase Service Account loaded successfully from: {}", service_account_path);
                            return FirebaseClient {
                                db_url,
                                authenticator: Some(authenticator),
                                client,
                            };
                        }
                        Err(e) => {
                            eprintln!("❌ Failed to build Firebase authenticator: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ Failed to read Firebase service account key: {}", e);
                }
            }
        } else {
            eprintln!("⚠️ Firebase service account file not found: {}", service_account_path);
        }

        FirebaseClient {
            db_url,
            authenticator: None,
            client,
        }
    }

    pub fn is_available(&self) -> bool {
        self.authenticator.is_some()
    }

    async fn get_access_token(&self) -> Option<String> {
        if let Some(ref auth) = self.authenticator {
            let scopes = &["https://www.googleapis.com/auth/firebase.database", "https://www.googleapis.com/auth/userinfo.email"];
            match auth.token(scopes).await {
                Ok(token) => Some(token.token().unwrap_or("").to_string()),
                Err(e) => {
                    eprintln!("❌ Failed to get Firebase OAuth2 token: {}", e);
                    None
                }
            }
        } else {
            None
        }
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        let url = format!("{}/{}.json", self.db_url, path.trim_start_matches('/'));
        let mut req = self.client.get(&url);

        if let Some(token) = self.get_access_token().await {
            req = req.bearer_auth(token);
        } else if self.is_available() {
            return Err("Firebase is configured but failed to obtain access token".to_string());
        }

        match req.send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    resp.json::<Value>().await.map_err(|e| e.to_string())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    Err(format!("Firebase GET failed with status {}: {}", status, body))
                }
            }
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn push(&self, path: &str, data: &Value) -> Result<String, String> {
        let url = format!("{}/{}.json", self.db_url, path.trim_start_matches('/'));
        let mut req = self.client.post(&url).json(data);

        if let Some(token) = self.get_access_token().await {
            req = req.bearer_auth(token);
        } else if self.is_available() {
            return Err("Firebase is configured but failed to obtain access token".to_string());
        }

        match req.send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    let res_val = resp.json::<Value>().await.map_err(|e| e.to_string())?;
                    if let Some(name) = res_val.get("name").and_then(|n| n.as_str()) {
                        Ok(name.to_string())
                    } else {
                        Err("Response from Firebase push did not contain key 'name'".to_string())
                    }
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    Err(format!("Firebase PUSH failed with status {}: {}", status, body))
                }
            }
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn update(&self, path: &str, data: &Value) -> Result<(), String> {
        let url = format!("{}/{}.json", self.db_url, path.trim_start_matches('/'));
        let mut req = self.client.patch(&url).json(data);

        if let Some(token) = self.get_access_token().await {
            req = req.bearer_auth(token);
        } else if self.is_available() {
            return Err("Firebase is configured but failed to obtain access token".to_string());
        }

        match req.send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    Err(format!("Firebase UPDATE failed with status {}: {}", status, body))
                }
            }
            Err(e) => Err(e.to_string()),
        }
    }

    pub async fn delete(&self, path: &str) -> Result<(), String> {
        let url = format!("{}/{}.json", self.db_url, path.trim_start_matches('/'));
        let mut req = self.client.delete(&url);

        if let Some(token) = self.get_access_token().await {
            req = req.bearer_auth(token);
        } else if self.is_available() {
            return Err("Firebase is configured but failed to obtain access token".to_string());
        }

        match req.send().await {
            Ok(resp) => {
                if resp.status().is_success() {
                    Ok(())
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    Err(format!("Firebase DELETE failed with status {}: {}", status, body))
                }
            }
            Err(e) => Err(e.to_string()),
        }
    }
}
