use super::*;

pub(super) fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8_lossy()
        .into_owned()
}

pub(super) fn parse_multistatus(body: &[u8], base_url: &Url, request_url: &Url) -> AppResult<Vec<DavEntry>> {
    let mut reader = Reader::from_reader(body);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut current: Option<DavEntry> = None;
    let mut entries = Vec::new();
    let mut propstat_ok = true;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "response" {
                    current = Some(DavEntry {
                        path: String::new(),
                        size: 0,
                        modified_at: 0,
                        etag: None,
                        is_collection: false,
                    });
                }
                if name == "propstat" {
                    propstat_ok = true;
                }
                if name == "collection" && stack.iter().any(|tag| tag == "resourcetype") {
                    if let Some(entry) = current.as_mut() {
                        entry.is_collection = true;
                    }
                }
                stack.push(name);
            }
            Ok(Event::Empty(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "collection" {
                    if let Some(entry) = current.as_mut() {
                        entry.is_collection = true;
                    }
                }
            }
            Ok(Event::Text(event)) => {
                let text = event.unescape().map_err(|e| {
                    AppError::new(
                        "DAV_INVALID_RESPONSE",
                        format!("PROPFIND XML 解码失败：{e}"),
                    )
                })?;
                let value = text.trim();
                let tag = stack.last().map(String::as_str).unwrap_or("");
                if tag == "status" && stack.iter().any(|v| v == "propstat") {
                    propstat_ok = value
                        .split_whitespace()
                        .nth(1)
                        .and_then(|s| s.parse::<u16>().ok())
                        .is_some_and(|s| (200..300).contains(&s));
                }
                if let Some(entry) = current.as_mut() {
                    if tag == "href" {
                        // href belongs to the response element, not a propstat. Servers may
                        // return it before a later 404 propstat for unsupported properties.
                        entry.path = normalize_href(value);
                    } else if propstat_ok {
                        match tag {
                            "getcontentlength" => entry.size = value.parse().unwrap_or(0),
                            "getlastmodified" => {
                                entry.modified_at = chrono::DateTime::parse_from_rfc2822(value)
                                    .map(|d| d.timestamp_millis())
                                    .unwrap_or_default()
                            }
                            "getetag" if !value.is_empty() => entry.etag = Some(value.to_owned()),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "response" {
                    if let Some(entry) = current.take() {
                        if !entry.path.is_empty() {
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
}
