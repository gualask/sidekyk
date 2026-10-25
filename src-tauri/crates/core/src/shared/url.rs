//! Parts of URLs, as the frontend and the files it shows write them.

/// `%XX` escapes decoded; anything not UTF-8 after them is read lossily.
pub fn percent_decoded(text: &str) -> String {
    if !text.contains('%') {
        return text.to_string();
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escaped = (bytes[index] == b'%')
            .then(|| text.get(index + 1..index + 3))
            .flatten()
            .filter(|hex| hex.bytes().all(|b| b.is_ascii_hexdigit()))
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                out.push(byte);
                index += 3;
            }
            None => {
                out.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_are_decoded_and_broken_ones_kept() {
        assert_eq!(percent_decoded("my%20file%2Fx.md"), "my file/x.md");
        assert_eq!(percent_decoded("caff%C3%A8"), "caffè");
        assert_eq!(percent_decoded("100%"), "100%");
        assert_eq!(percent_decoded("%zz"), "%zz");
        assert_eq!(percent_decoded("%+1"), "%+1");
    }
}
