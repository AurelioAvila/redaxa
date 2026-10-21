use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri_plugin_updater::{ReleaseManifestPlatform, RemoteReleaseInner};

// The plugin verifies both artifact bytes and this minisign trusted comment
// before installation. Bind the offered version to that authenticated filename;
// checking only the unsigned manifest version permits replay of old installers.
fn matches(platform: &ReleaseManifestPlatform, version: &str) -> bool {
    let Ok(decoded) = STANDARD.decode(&platform.signature) else { return false };
    let Ok(text) = std::str::from_utf8(&decoded) else { return false };
    let Some(comment) = text.lines().nth(2).and_then(|line| line.strip_prefix("trusted comment: timestamp:")) else {
        return false;
    };
    let Some((timestamp, filename)) = comment.split_once("\tfile:") else { return false };
    if timestamp.is_empty() || !timestamp.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let expected = [
        format!("Redaxa_{version}_x64-setup.exe"),
        format!("Redaxa_{version}_x64_en-US.msi"),
    ];
    expected.contains(&filename.to_string())
        && RELEASE_HOSTS
            .iter()
            .any(|base| platform.url.as_str() == format!("{base}/v{version}/{filename}"))
}

// Where a signed installer may be downloaded from: the GitHub release, or the
// same bytes on our own download domain. The minisign signature covers the
// bytes, so the host only has to be ours.
const RELEASE_HOSTS: [&str; 2] = [
    "https://github.com/AurelioAvila/redaxa/releases/download",
    "https://dl.pctweaker.app/redaxa",
];

pub fn release_matches(version: &str, data: &RemoteReleaseInner) -> bool {
    match data {
        RemoteReleaseInner::Dynamic(platform) => matches(platform, version),
        RemoteReleaseInner::Static { platforms } => {
            !platforms.is_empty() && platforms.values().all(|platform| matches(platform, version))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn platform(signed_version: &str, offered_version: &str) -> ReleaseManifestPlatform {
        let name = format!("Redaxa_{signed_version}_x64-setup.exe");
        ReleaseManifestPlatform {
            url: format!("https://github.com/AurelioAvila/redaxa/releases/download/v{offered_version}/Redaxa_{offered_version}_x64-setup.exe").parse().unwrap(),
            // Identity-gate fixture only; the updater must independently reject
            // this non-cryptographic signature before installing any artifact.
            signature: STANDARD.encode(format!("untrusted comment: fixture\nfixture\ntrusted comment: timestamp:123\tfile:{name}\nfixture\n")),
        }
    }

    #[test]
    fn old_signature_cannot_advertise_a_new_version() {
        assert!(matches(&platform("2.0.0", "2.0.0"), "2.0.0"));
        assert!(!matches(&platform("1.0.0", "2.0.0"), "2.0.0"));
        let mut malformed = platform("2.0.0", "2.0.0");
        malformed.signature = "invalid".into();
        assert!(!matches(&malformed, "2.0.0"));
        let mut wrong_host = platform("2.0.0", "2.0.0");
        wrong_host.url = "https://example.com/installer.exe".parse().unwrap();
        assert!(!matches(&wrong_host, "2.0.0"));
    }

    #[test]
    fn our_download_domain_serves_the_same_signed_file() {
        let mut ours = platform("2.0.0", "2.0.0");
        ours.url = "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe".parse().unwrap();
        assert!(matches(&ours, "2.0.0"));
        let mut msi = platform("2.0.0", "2.0.0");
        msi.signature = STANDARD.encode("untrusted comment: fixture
fixture
trusted comment: timestamp:123	file:Redaxa_2.0.0_x64_en-US.msi
fixture
");
        msi.url = "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64_en-US.msi".parse().unwrap();
        assert!(matches(&msi, "2.0.0"));
    }

    #[test]
    fn our_download_domain_is_matched_exactly() {
        for url in [
            // wrong version folder, product, file or signed name
            "https://dl.pctweaker.app/redaxa/v1.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app/redaxa/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64_en-US.msi",
            "https://dl.pctweaker.app/pc-tweaker/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app/redaxa/v2.0.0/sub/Redaxa_2.0.0_x64-setup.exe",
            // other scheme, port, credentials, query or fragment
            "http://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app:8443/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://user@dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe?x=1",
            "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe#x",
            // lookalike hosts
            "https://dl.pctweaker.app.example.com/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app@example.com/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.app./redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://evil.dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://dl.pctweaker.com/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
            "https://github.com/AurelioAvila/redaxa-fork/releases/download/v2.0.0/Redaxa_2.0.0_x64-setup.exe",
        ] {
            let mut offered = platform("2.0.0", "2.0.0");
            offered.url = url.parse().unwrap();
            assert!(!matches(&offered, "2.0.0"), "{url}");
        }
        // An old installer stays old on our domain too.
        let mut replay = platform("1.0.0", "2.0.0");
        replay.url = "https://dl.pctweaker.app/redaxa/v2.0.0/Redaxa_2.0.0_x64-setup.exe".parse().unwrap();
        assert!(!matches(&replay, "2.0.0"));
    }
}
