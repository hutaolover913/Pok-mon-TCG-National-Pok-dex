"""在桌機或手機預覽 App 版，不需要 Android 工具鏈。

    python android-app/preview.py

電腦上會自動開瀏覽器；手機只要連同一個 Wi-Fi，開畫面上印出來的內網網址即可。

-- 為什麼要有這支，不直接用 python -m http.server ---------------------------
三個原因：

1. 程式碼不快取。http.server 只送 Last-Modified，改完 js/ 重新組裝之後，
   瀏覽器常常還是拿舊的 ES module，看到的行為跟實際程式碼對不上。
   這裡對 .js/.json/.html/.css 一律送 no-store（跟 start_app.py 同樣做法），
   圖片才給快取。

2. 埠固定在 8899，跟電腦版的 8811 分開。IndexedDB 是依網址（含連接埠）
   分開存放的，所以在這裡怎麼點收藏、怎麼測清除，都碰不到你 8811 底下
   真正在用的收藏資料。

3. 綁 0.0.0.0 而不是 127.0.0.1，讓同一個區域網路的手機也連得到，
   在還沒安裝 Android 工具鏈之前就能先在真的手機上試用。

-- 安全性 -------------------------------------------------------------------
綁 0.0.0.0 代表同一個區域網路的人都連得到這個網址。裡面只有卡片圖鑑資料，
沒有帳號密碼也沒有個人資料，但它終究是對外開著的 —— 用完請按 Ctrl+C 關掉。
"""

import http.server
import os
import socket
import socketserver
import sys
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, "www")
PORT = 8899

NO_CACHE_EXT = (".js", ".json", ".css", ".html", ".txt")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW, **kwargs)

    def log_message(self, fmt, *args):
        # 一頁會請求幾十張圖，全印出來只會洗版
        pass

    def end_headers(self):
        path = self.path.split("?")[0].lower()
        if path.endswith(NO_CACHE_EXT) or path.endswith("/"):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()


def lan_ip():
    """這台機器在區域網路上的位址。

    用「開一個往外的 UDP socket 再問它自己綁到哪個位址」這個做法，
    而不是 gethostbyname(gethostname()) —— 後者在有多張網卡（VPN、
    虛擬機橋接、藍牙）的機器上經常回傳錯的那一張。UDP 不會真的送出封包。
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def other_ipv4():
    """這台機器上其他的 IPv4 位址，當作備選印出來。

    有 VPN 的時候，lan_ip() 可能回傳 VPN 介面的位址，手機是連不上的。
    把其他候選一起列出來，連不上時可以換一個試。
    """
    out = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("127.") or ip in out:
                continue
            out.append(ip)
    except OSError:
        pass
    return out


def main():
    if not os.path.isdir(WWW):
        raise SystemExit("還沒有 www/，先跑：python android-app/build_www.py")

    primary = lan_ip()
    others = [ip for ip in other_ipv4() if ip != primary]

    socketserver.TCPServer.allow_reuse_address = True
    # 綁 0.0.0.0：本機與同網段的手機都連得到
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print("App 版預覽")
        print("=" * 46)
        print("  這台電腦： http://localhost:%d" % PORT)
        if primary:
            print("  手機請開： http://%s:%d" % (primary, PORT))
        if others:
            print("  連不上的話換這些試： %s"
                  % "、".join("http://%s:%d" % (ip, PORT) for ip in others))
        print("=" * 46)
        print()
        print("目錄：%s" % WWW)
        print()
        print("這是 App 模式（index.html 帶著 ptcg-app-mode 標記），")
        print("介面與鎖定行為跟裝進手機之後一樣。")
        print("收藏資料存在 8899 這個網址底下，與你平常用的 8811 完全分開。")
        print()
        print("手機連不上的時候依序檢查：")
        print("  1. 手機與電腦是不是同一個 Wi-Fi（不要用手機的行動網路）")
        print("  2. 第一次執行時 Windows 防火牆的詢問有沒有按「允許」（要勾私人網路）")
        print("  3. 電腦上的 VPN 有沒有開著 —— 開著的話先關掉再試")
        print()
        print("這個網址同網段的人都連得到，用完請按 Ctrl+C 關掉。")
        if "--no-browser" not in sys.argv:
            webbrowser.open("http://localhost:%d" % PORT)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已結束。")


if __name__ == "__main__":
    main()
