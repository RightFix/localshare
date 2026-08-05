/// LAN-usable IPv4 addresses, default-route address listed first.
///
/// Excludes IPv6 (not usable as a plain http://<ip>:<port> target), loopback
/// (127.*), and link-local (169.254.*) addresses.
pub fn get_all_local_ips() -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in list {
            let s = ip.to_string();
            if is_lan_usable(&s) && !ips.contains(&s) {
                ips.push(s);
            }
        }
    }
    if let Ok(ip) = local_ip_address::local_ip() {
        let s = ip.to_string();
        if is_lan_usable(&s) {
            if let Some(pos) = ips.iter().position(|x| x == &s) {
                ips.remove(pos);
            }
            ips.insert(0, s);
        }
    }
    ips
}

fn is_lan_usable(ip: &str) -> bool {
    !ip.contains(':') && !ip.starts_with("127.") && !ip.starts_with("169.254.")
}
