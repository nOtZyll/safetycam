"""Serve the website over HTTPS on the local network, so a phone can use its camera.

Browsers only allow camera access on https:// pages (or on localhost). This script makes a
self-signed certificate for this computer's LAN addresses and serves web/ with it.

    python serve_https.py              # https://<laptop-ip>:5443
    python serve_https.py --port 8443

On the phone (same Wi-Fi), open the printed address. The browser warns that the certificate
is not trusted because it is self-signed: choose "Advanced" -> "Proceed" once. The camera
then works; offline caching (service worker) does not, because that needs a trusted
certificate. Windows may ask to allow Python through the firewall: allow it on private networks.

Needs: pip install cryptography
"""

import argparse
import datetime as dt
import ipaddress
import socket
import ssl
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CERT_DIR = ROOT / ".cert"


def lan_ips():
    """IPv4 addresses of this machine other than loopback."""
    ips = set()
    try:
        # the address used to reach the outside; no packet is actually sent
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


def make_cert(ips, cert_path, key_path):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SafetyCam lokal")])
    alt = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    alt += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))


def cert_covers(cert_path, ips):
    """True if the saved certificate is still valid and lists every current LAN address."""
    from cryptography import x509

    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    except (OSError, ValueError):
        return False
    if cert.not_valid_after_utc < dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7):
        return False
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    have = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
    return set(ips) <= have


class Handler(SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain through the registry, which breaks module scripts.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".onnx": "application/octet-stream",
        ".woff2": "font/woff2",
        ".webp": "image/webp",
    }


def main():
    p = argparse.ArgumentParser(description="Serve web/ over HTTPS on the local network")
    p.add_argument("--port", type=int, default=5443)
    args = p.parse_args()

    try:
        import cryptography  # noqa: F401
    except ImportError:
        raise SystemExit("Paket 'cryptography' belum terpasang. Jalankan: pip install cryptography")

    ips = lan_ips()
    CERT_DIR.mkdir(exist_ok=True)
    cert_path, key_path = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
    if not cert_covers(cert_path, ips):
        make_cert(ips, cert_path, key_path)
        print(f"Sertifikat baru dibuat di {CERT_DIR}")

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), partial(Handler, directory=str(WEB)))
    server.socket = ctx.wrap_socket(server.socket, server_side=True)

    print("\nSafetyCam (HTTPS) berjalan. Buka di HP yang terhubung ke Wi-Fi yang sama:")
    for ip in ips or ["<alamat-IP-laptop>"]:
        print(f"  https://{ip}:{args.port}")
    print(f"Di laptop ini: https://localhost:{args.port}")
    print("Peringatan sertifikat di browser itu wajar: pilih 'Lanjutan' lalu 'Lanjutkan'.")
    print("Tekan Ctrl+C untuk berhenti.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
