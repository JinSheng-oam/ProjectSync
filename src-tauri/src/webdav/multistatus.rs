use super::*;

pub(super) fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

pub(super) fn parse_multistatus(body: &[u8], base_url: &Url, request_url: &Url) -> AppResult<Vec<DavEntry>> {
    #[derive(Default)]
    struct Properties {
        size: Option<u64>,
        modified_at: Option<i64>,
        etag: Option<String>,
        is_collection: Option<bool>,
        status: Option<u16>,
    }

    fn ends_with(stack: &[String], parts: &[&str]) -> bool {
        stack.len() == parts.len() + 1
            && stack[0] == "multistatus"
            && stack[1..].iter().map(String::as_str).eq(parts.iter().copied())
    }

    fn captures_text(stack: &[String]) -> bool {
        ends_with(stack, &["response", "href"])
            || ends_with(stack, &["response", "status"])
            || ends_with(stack, &["response", "propstat", "status"])
            || ["getcontentlength", "getlastmodified", "getetag"].iter().any(|tag|
                ends_with(stack, &["response", "propstat", "prop", tag]))
    }

    let mut reader = Reader::from_reader(body);
    let mut buffer = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut current: Option<DavEntry> = None;
    let mut properties = Properties::default();
    let mut response_status = None;
    let mut value = String::new();
    let mut entries = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "response" && stack.last().is_some_and(|tag| tag == "multistatus") {
                    current = Some(DavEntry {
                        path: String::new(),
                        size: 0,
                        modified_at: 0,
                        etag: None,
                        is_collection: false,
                    });
                    response_status = None;
                }
                if name == "propstat" && ends_with(&stack, &["response"]) {
                    properties = Properties::default();
                }
                if name == "resourcetype" && ends_with(&stack, &["response", "propstat", "prop"]) {
                    properties.is_collection = Some(false);
                }
                if name == "collection" && ends_with(&stack, &["response", "propstat", "prop", "resourcetype"]) {
                    properties.is_collection = Some(true);
                }
                stack.push(name);
                if captures_text(&stack) { value.clear(); }
            }
            Ok(Event::Empty(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "resourcetype" && ends_with(&stack, &["response", "propstat", "prop"]) {
                    properties.is_collection = Some(false);
                } else if name == "collection" && ends_with(&stack, &["response", "propstat", "prop", "resourcetype"]) {
                    properties.is_collection = Some(true);
                }
            }
            Ok(Event::Text(event)) => {
                if captures_text(&stack) {
                    value.push_str(&event.unescape().map_err(|e|
                        AppError::new("DAV_INVALID_RESPONSE", format!("PROPFIND XML 解码失败：{e}")))?);
                }
            }
            Ok(Event::CData(event)) => {
                if captures_text(&stack) {
                    value.push_str(&reader.decoder().decode(event.as_ref()).map_err(|e|
                        AppError::new("DAV_INVALID_RESPONSE", format!("PROPFIND XML 解码失败：{e}")))?);
                }
            }
            Ok(Event::End(event)) => {
                let name = local_name(event.name().as_ref());
                let text = value.trim();
                if ends_with(&stack, &["response", "href"]) {
                    if let Some(entry) = current.as_mut() {
                        entry.path = normalize_href(text);
                    }
                } else if ends_with(&stack, &["response", "status"]) {
                    response_status = text.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok());
                } else if ends_with(&stack, &["response", "propstat", "status"]) {
                    properties.status = text.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok());
                } else if ends_with(&stack, &["response", "propstat", "prop", "getcontentlength"]) {
                    properties.size = text.parse().ok();
                } else if ends_with(&stack, &["response", "propstat", "prop", "getlastmodified"]) {
                    properties.modified_at = chrono::DateTime::parse_from_rfc2822(text).ok().map(|d| d.timestamp_millis());
                } else if ends_with(&stack, &["response", "propstat", "prop", "getetag"]) && !text.is_empty() {
                    properties.etag = Some(text.to_owned());
                }
                if ends_with(&stack, &["response", "propstat"]) {
                    if properties.status.is_some_and(|status| (200..300).contains(&status)) {
                        if let Some(entry) = current.as_mut() {
                            if let Some(size) = properties.size { entry.size = size; }
                            if let Some(modified_at) = properties.modified_at { entry.modified_at = modified_at; }
                            if let Some(etag) = properties.etag.take() { entry.etag = Some(etag); }
                            if let Some(is_collection) = properties.is_collection { entry.is_collection = is_collection; }
                        }
                    }
                }
                if name == "response" && ends_with(&stack, &["response"]) {
                    if let Some(entry) = current.take() {
                        if !entry.path.is_empty() && response_status.is_none_or(|status| (200..300).contains(&status)) {
                            entries.push(entry);
                        }
                    }
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::new(
                    "DAV_INVALID_RESPONSE",
                    format!("PROPFIND XML 解析失败：{e}"),
                ))
            }
            _ => {}
        }
        buffer.clear();
    }
    for entry in &mut entries {
        let parsed = if entry.path.starts_with("http://") || entry.path.starts_with("https://") {
            Url::parse(&entry.path)
                .map_err(|_| AppError::new("DAV_INVALID_RESPONSE", "PROPFIND href URL 无效"))?
        } else {
            request_url
                .join(&entry.path)
                .map_err(|_| AppError::new("DAV_INVALID_RESPONSE", "PROPFIND href 路径无效"))?
        };
        let href = parsed.as_str().to_owned();
        entry.path = href;
    }
    let _ = base_url;
    Ok(entries)
}

fn normalize_href(value: &str) -> String {
    value.trim().to_owned()
}

fn local_name(value: &[u8]) -> String {
    let name = std::str::from_utf8(value).unwrap_or_default();
    name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase()
}

#[cfg(test)]
mod browse_parser_tests {
    use super::*;

    #[test]
    fn hacdias_multistatus_lists_decoded_children_and_both_collection_forms() {
        let client =
            WebDavClient::new("https://example.test/dav/", "user", "password".into(), true)
                .unwrap();
        let request = client.url_for("/").unwrap();
        let xml = br#"<?xml version="1.0" encoding="utf-8"?>
        <D:multistatus xmlns:D="DAV:">
          <D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
          <D:response><D:href>/dav/projects/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
          <D:response><D:href>/dav/%E6%96%87%E6%A1%A3%20files/</D:href><D:propstat><D:prop><D:resourcetype><D:collection></D:collection></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
          <D:response><D:href>/dav/readme.txt</D:href><D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
        </D:multistatus>"#;
        let entries = parse_multistatus(xml, &client.base_url, &request).unwrap();
        let paths = entries
            .iter()
            .map(|entry| {
                (
                    href_to_dav_path(&client, &entry.path, "/").unwrap(),
                    entry.is_collection,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            paths,
            [
                ("/".into(), true),
                ("/projects".into(), true),
                ("/文档 files".into(), true),
                ("/readme.txt".into(), false)
            ]
        );
    }

    #[test]
    fn preserves_split_text_and_ignores_failed_properties_and_nested_hrefs() {
        let client = WebDavClient::new("https://example.test/dav/", "u", "p".into(), true).unwrap();
        let request = client.url_for("/").unwrap();
        let xml = br#"<D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>/dav/a&amp;<![CDATA[b]]>.txt</D:href>
            <D:error><D:href>/dav/wrong.txt</D:href><D:collection/></D:error>
            <D:propstat><D:prop><D:getetag>"bad"</D:getetag><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
            <D:propstat><D:prop><D:getetag>"a&amp;<![CDATA[b]]>"</D:getetag><D:getcontentlength>12</D:getcontentlength><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
          </D:response>
          <D:response><D:href>/dav/gone</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>
        </D:multistatus>"#;
        let rows = parse_multistatus(xml, &client.base_url, &request).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(href_to_dav_path(&client, &rows[0].path, "/").unwrap(), "/a&b.txt");
        assert_eq!(rows[0].etag.as_deref(), Some("\"a&b\""));
        assert_eq!(rows[0].size, 12);
        assert!(!rows[0].is_collection);
    }
}
