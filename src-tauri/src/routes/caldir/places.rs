//! Location autocomplete via OpenStreetMap Nominatim — keyless and free.
//! Done on the backend so we can send a proper User-Agent per Nominatim's usage
//! policy (browsers don't allow setting it). Errors return an empty list so the
//! Location field silently falls back to free text.

use crate::routes::TauResult;
use serde_json::Value;

const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";

pub(super) async fn search(query: String) -> TauResult<Vec<String>> {
    let query = query.trim();
    if query.len() < 3 {
        return Ok(Vec::new());
    }

    let Ok(url) = url::Url::parse_with_params(
        NOMINATIM_URL,
        &[
            ("q", query),
            ("format", "jsonv2"),
            ("limit", "6"),
            ("addressdetails", "0"),
        ],
    ) else {
        return Ok(Vec::new());
    };

    let res = reqwest::Client::new()
        .get(url)
        .header(
            "User-Agent",
            "CosmiCal/0.1 (https://github.com/davidboulay/cosmic-calendar)",
        )
        .header("Accept-Language", "en")
        .send()
        .await;

    let Ok(res) = res else {
        return Ok(Vec::new());
    };
    if !res.status().is_success() {
        return Ok(Vec::new());
    }

    let body: Value = res.json().await.unwrap_or(Value::Null);
    Ok(body
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r["display_name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default())
}
