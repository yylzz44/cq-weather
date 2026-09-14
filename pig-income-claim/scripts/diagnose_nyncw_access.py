#!/usr/bin/env python3
"""仅在抓取失败时诊断公开农委入口，不改变网络配置、不输出凭据。"""
import socket
import subprocess


def main():
    host = "nyncw.cq.gov.cn"
    try:
        addresses = sorted({(item[0].name, item[4][0]) for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
        print("农委域名DNS解析：", addresses, flush=True)
    except OSError as exc:
        print("DNS解析失败：", exc, flush=True)
    for scheme in ("https", "http"):
        url = f"{scheme}://{host}/xxgk_161/sczx/index.html"
        # 与正常抓取相同的公开地址和UA；仅对比IPv4，不忽略TLS校验。
        command = ["curl", "--ipv4", "--head", "--silent", "--show-error",
                   "--connect-timeout", "5", "--max-time", "10",
                   "--user-agent", "pig-income-claim-price-updater/1.0 (+GitHub Actions)",
                   "--write-out", "\nHTTP_STATUS=%{http_code}\n", url]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=12)
            print(url, "IPv4返回码：", result.returncode, flush=True)
            print(result.stdout, result.stderr, flush=True)
        except (OSError, subprocess.TimeoutExpired) as exc:
            print(url, "IPv4诊断失败：", exc, flush=True)


if __name__ == "__main__":
    main()
