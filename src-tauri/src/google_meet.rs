//! Turnkey Google Meet link creation via the Google Calendar REST API.
//!
//! CalDAV (what caldir speaks) can't mint Meet links — Google only creates one
//! when an event is inserted through the REST API with
//! `conferenceData.createRequest` + `conferenceDataVersion=1`. So for events
//! that need a Meet link we call that endpoint directly, authorized by a Google
//! OAuth grant the user approves once.
//!
//! The OAuth client is a *public* "Desktop" client: the `client_id` is baked in
//! (it isn't a secret) and the flow is PKCE loopback, so no `client_secret` ever
//! ships in the downloaded binary. The authorization code is never exchanged
//! with Google directly — it's POSTed to the CosmiCal OAuth proxy (an n8n
//! webhook) which adds the confidential `client_secret` server-side and performs
//! the exchange. Any user who installs CosmiCal can therefore sign in with a
//! single "Connect" click and no credential entry.

use anyhow::{Result, anyhow};
use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars";
/// Combined scope for the single CosmiCal Google sign-in: creating Meet
/// conferences (calendar.events) plus reading contacts for invitee
/// autocomplete (saved contacts + auto-saved "other" contacts).
pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly";

/// Public OAuth client id (Google "Desktop app" type). Not a secret — it's part
/// of every auth URL. Overridable at build time via `COSMICAL_GOOGLE_CLIENT_ID`.
pub const CLIENT_ID: &str = match option_env!("COSMICAL_GOOGLE_CLIENT_ID") {
    Some(v) => v,
    None => "179257707161-f7akrpe0gkud5r42b2dvd6bk1tfvsd3q.apps.googleusercontent.com",
};

/// CosmiCal OAuth proxy webhook (n8n) holding the client secret server-side.
/// Overridable at build time via `COSMICAL_OAUTH_PROXY_URL`.
pub const PROXY_URL: &str = match option_env!("COSMICAL_OAUTH_PROXY_URL") {
    Some(v) => v,
    None => "https://n8n.lojel.com/webhook/cosmical/google/oauth/token",
};

/// A PKCE verifier/challenge pair (RFC 7636, S256).
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// Generate a fresh PKCE pair. The verifier stays in this process; only the
/// SHA-256 challenge is sent to Google, so an intercepted code is useless
/// without it — which is what protects the open proxy webhook.
pub fn generate_pkce() -> Pkce {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let verifier = b64.encode(bytes);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = b64.encode(digest);
    Pkce { verifier, challenge }
}

/// Build the consent URL. `access_type=offline` + `prompt=consent` ensures we
/// get a refresh token even on re-authorization; `code_challenge` enables PKCE.
pub fn build_auth_url(redirect_uri: &str, state: &str, challenge: &str) -> Result<String> {
    let url = url::Url::parse_with_params(
        AUTH_URL,
        &[
            ("response_type", "code"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect_uri),
            ("scope", SCOPE),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
        ],
    )?;
    Ok(url.to_string())
}

/// POST an OAuth grant to the proxy webhook and return the parsed token JSON.
/// The proxy adds the client_id/secret and forwards to Google's token endpoint.
async fn post_proxy(body: &Value) -> Result<Value> {
    let res = reqwest::Client::new()
        .post(PROXY_URL)
        .json(body)
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(anyhow!("OAuth proxy {status}: {body}"));
    }
    // Google relays errors as a JSON body with a 200 from the proxy too.
    if let Some(err) = body.get("error").and_then(Value::as_str) {
        let desc = body
            .get("error_description")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Err(anyhow!("Google OAuth error: {err} {desc}"));
    }
    Ok(body)
}

/// Exchange an authorization code (+ PKCE verifier) for a long-lived refresh
/// token, via the proxy.
pub async fn exchange_code(
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<String> {
    let body = post_proxy(&json!({
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
    }))
    .await?;
    body["refresh_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("Google did not return a refresh token. Remove CosmiCal from your Google account's connected apps and reconnect."))
}

/// Mint a short-lived access token from the stored refresh token, via the proxy.
pub async fn access_token(refresh_token: &str) -> Result<String> {
    let body = post_proxy(&json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }))
    .await?;
    body["access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("Google did not return an access token"))
}

/// Insert an event (with a Meet conference) on the given Google calendar.
/// Returns the created event JSON, including `hangoutLink`/`conferenceData`.
pub async fn insert_event(access_token: &str, calendar_id: &str, event: &Value) -> Result<Value> {
    let url = format!(
        "{EVENTS_URL}/{}/events?conferenceDataVersion=1",
        urlencoding(calendar_id)
    );
    let res = reqwest::Client::new()
        .post(&url)
        .bearer_auth(access_token)
        .json(event)
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(anyhow!("Google events.insert {status}: {body}"));
    }
    Ok(body)
}

/// Fetch a single event by id. Used to wait for an asynchronously-created Meet
/// conference to finalize (the `createRequest` link is often still pending in
/// the insert response).
pub async fn get_event(access_token: &str, calendar_id: &str, event_id: &str) -> Result<Value> {
    let url = format!(
        "{EVENTS_URL}/{}/events/{}?conferenceDataVersion=1",
        urlencoding(calendar_id),
        urlencoding(event_id)
    );
    let res = reqwest::Client::new()
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(anyhow!("Google events.get {status}: {body}"));
    }
    Ok(body)
}

/// Resolve a caldir iCalUID (+ optional occurrence start, for a single instance)
/// to the real Google event id. We don't string-munge the UID because the
/// iCalUID and the event id can differ, and an instance's id encodes the
/// occurrence. Instead we query `events.list?iCalUID=…` (expanding instances and
/// matching the occurrence by time when needed), which is robust to that and to
/// tangled local overrides.
pub async fn resolve_event_id(
    access_token: &str,
    calendar_id: &str,
    ical_uid: &str,
    instance_utc: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<String> {
    let base = format!("{EVENTS_URL}/{}/events", urlencoding(calendar_id));
    let url = match instance_utc {
        Some(utc) => {
            // Bracket the occurrence generously (±36h) to absorb tz/DST skew,
            // then pick the instance whose start is closest to the target.
            let tmin = (utc - chrono::Duration::hours(36)).to_rfc3339();
            let tmax = (utc + chrono::Duration::hours(36)).to_rfc3339();
            format!(
                "{base}?iCalUID={}&singleEvents=true&maxResults=50&timeMin={}&timeMax={}",
                urlencoding(ical_uid),
                urlencoding(&tmin),
                urlencoding(&tmax)
            )
        }
        None => format!("{base}?iCalUID={}&singleEvents=false&maxResults=5", urlencoding(ical_uid)),
    };

    let res = reqwest::Client::new()
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(anyhow!("Google events.list (RSVP lookup) {status}: {body}"));
    }
    let items = body["items"].as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return Err(anyhow!("event not found on this Google calendar"));
    }

    match instance_utc {
        None => items[0]["id"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| anyhow!("event has no id")),
        Some(utc) => {
            let target = utc.timestamp();
            let start_ts = |it: &Value| -> i64 {
                it["originalStartTime"]["dateTime"]
                    .as_str()
                    .or_else(|| it["start"]["dateTime"].as_str())
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp())
                    .unwrap_or(i64::MAX / 2)
            };
            items
                .iter()
                .min_by_key(|it| (start_ts(it) - target).abs())
                .and_then(|it| it["id"].as_str())
                .map(String::from)
                .ok_or_else(|| anyhow!("matching occurrence not found"))
        }
    }
}

/// RSVP to a Google event by setting only the signed-in user's
/// `responseStatus`. Works even when the user isn't the organizer: we GET the
/// event, change our own attendee entry, and PATCH just the `attendees` array
/// (Google permits an attendee to change their own response without being the
/// organizer — unlike caldir's full-event push, which Google rejects as a
/// shared-property change). `response_status` is Google's vocabulary:
/// "accepted" | "declined" | "tentative" | "needsAction".
pub async fn set_response_status(
    access_token: &str,
    calendar_id: &str,
    event_id: &str,
    self_email: &str,
    response_status: &str,
) -> Result<()> {
    let event = get_event(access_token, calendar_id, event_id).await?;
    let mut attendees = event["attendees"].as_array().cloned().unwrap_or_default();

    let mut found = false;
    for a in attendees.iter_mut() {
        let is_self = a["self"].as_bool() == Some(true)
            || a["email"]
                .as_str()
                .is_some_and(|e| e.eq_ignore_ascii_case(self_email));
        if is_self {
            a["responseStatus"] = json!(response_status);
            found = true;
        }
    }
    if !found {
        attendees.push(json!({
            "email": self_email,
            "responseStatus": response_status,
            "self": true,
        }));
    }

    // PATCH only the attendees array. sendUpdates=none avoids emailing everyone.
    let url = format!(
        "{EVENTS_URL}/{}/events/{}?sendUpdates=none",
        urlencoding(calendar_id),
        urlencoding(event_id)
    );
    let res = reqwest::Client::new()
        .patch(&url)
        .bearer_auth(access_token)
        .json(&json!({ "attendees": attendees }))
        .send()
        .await?;
    let status = res.status();
    if !status.is_success() {
        let body: Value = res.json().await.unwrap_or(Value::Null);
        return Err(anyhow!("Google events.patch (RSVP) {status}: {body}"));
    }
    Ok(())
}

/// The Meet URL from a created-event response, if present.
pub fn meet_link(created: &Value) -> Option<String> {
    if let Some(link) = created["hangoutLink"].as_str() {
        return Some(link.to_string());
    }
    created["conferenceData"]["entryPoints"]
        .as_array()
        .and_then(|points| {
            points
                .iter()
                .find(|p| p["entryPointType"].as_str() == Some("video"))
                .or_else(|| points.first())
        })
        .and_then(|p| p["uri"].as_str())
        .map(String::from)
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// --- Contacts (Google People API) ---------------------------------------

const PEOPLE_SEARCH_URL: &str = "https://people.googleapis.com/v1/people:searchContacts";
const OTHER_CONTACTS_SEARCH_URL: &str = "https://people.googleapis.com/v1/otherContacts:search";

/// A contact for invitee autocomplete / name resolution.
pub struct Contact {
    pub name: Option<String>,
    pub email: String,
}

/// Warm the People API search cache. Google requires a priming request (empty
/// query) before `searchContacts`/`otherContacts:search` return results; we do
/// this once right after connecting. Best-effort.
pub async fn warmup_contacts(access_token: &str) {
    let client = reqwest::Client::new();
    for base in [PEOPLE_SEARCH_URL, OTHER_CONTACTS_SEARCH_URL] {
        let Ok(url) = url::Url::parse_with_params(
            base,
            &[("query", ""), ("readMask", "names,emailAddresses")],
        ) else {
            continue;
        };
        let _ = client.get(url).bearer_auth(access_token).send().await;
    }
}

/// Normalize a People API email value: strip a `mailto:` scheme prefix and
/// reject anything that isn't a plausible address (the API sometimes returns
/// encoded contact ids or scheme-prefixed values in `emailAddresses[].value`).
fn normalize_email(raw: &str) -> Option<String> {
    let mut e = raw.trim();
    if e.len() >= 7 && e[..7].eq_ignore_ascii_case("mailto:") {
        e = e[7..].trim();
    }
    if e.chars().any(char::is_whitespace) {
        return None;
    }
    let (local, domain) = e.split_once('@')?;
    if local.is_empty() || !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.')
    {
        return None;
    }
    Some(e.to_string())
}

fn parse_people(body: &Value) -> Vec<Contact> {
    body["results"]
        .as_array()
        .map(|results| {
            results
                .iter()
                .filter_map(|r| {
                    let person = &r["person"];
                    // Pick the first entry that's actually a valid email address.
                    let email = person["emailAddresses"]
                        .as_array()?
                        .iter()
                        .filter_map(|e| e["value"].as_str())
                        .find_map(normalize_email)?;
                    let name = person["names"]
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|n| n["displayName"].as_str())
                        .map(String::from);
                    Some(Contact { name, email })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Search the user's saved + auto-saved Google contacts by name or email.
pub async fn search_contacts(access_token: &str, query: &str) -> Result<Vec<Contact>> {
    let client = reqwest::Client::new();
    let mut out: Vec<Contact> = Vec::new();
    for base in [PEOPLE_SEARCH_URL, OTHER_CONTACTS_SEARCH_URL] {
        let url = url::Url::parse_with_params(
            base,
            &[
                ("query", query),
                ("readMask", "names,emailAddresses"),
                ("pageSize", "10"),
            ],
        )?;
        let res = client.get(url).bearer_auth(access_token).send().await?;
        if res.status().is_success() {
            let body: Value = res.json().await.unwrap_or(Value::Null);
            out.extend(parse_people(&body));
        }
    }

    // Dedup by lowercased email, preferring an entry that carries a name.
    let mut index = std::collections::HashMap::<String, usize>::new();
    let mut deduped: Vec<Contact> = Vec::new();
    for c in out {
        let key = c.email.to_lowercase();
        match index.get(&key) {
            Some(&i) => {
                if deduped[i].name.is_none() && c.name.is_some() {
                    deduped[i].name = c.name;
                }
            }
            None => {
                index.insert(key, deduped.len());
                deduped.push(c);
            }
        }
    }
    Ok(deduped)
}
