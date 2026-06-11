fn main() {
    // Optional build-time overrides for the turnkey Google Meet OAuth (see
    // src/google_meet.rs). Both are non-secret and committable: CLIENT_ID is the
    // public "Desktop" OAuth client id, PROXY_URL is the n8n OAuth proxy webhook
    // that holds the confidential client_secret server-side. If unset, the
    // compiled-in defaults are used. No client secret is ever baked into the
    // binary — that lives only on the proxy.
    for key in ["COSMICAL_GOOGLE_CLIENT_ID", "COSMICAL_OAUTH_PROXY_URL"] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(val) = std::env::var(key) {
            if !val.is_empty() {
                println!("cargo:rustc-env={key}={val}");
            }
        }
    }
    tauri_build::build()
}
