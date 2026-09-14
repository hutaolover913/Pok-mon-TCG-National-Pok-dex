"""在桌機預覽 App 版，不需要 Android 工具鏈。

    python android-app/preview.py

然後開 http://localhost:8899

-- 為什麼要有這支，不直接用 python -m http.server ---------------------------
兩個原因：

1. 程式碼不快取。http.server 只送 Last-Modified，改完 js/ 重新組裝之後，
   瀏覽器常常還是拿舊的 ES module，看到的行為跟實際程式碼對不上。
   這裡對 .js/.json/.html/.css 一律送 no-store（跟 start_app.py 同樣做法），
   圖片才給快取。

2. 埠固定在 8899，跟電腦版的 8811 分開。IndexedDB 是依網址（含連接埠）
   分開存放的，所以在這裡怎麼點收藏、怎麼測清除，都碰不到你 8811 底下
   真正在用的收藏資料。
"""

import http.server
import os
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


def main():
    if not os.path.isdir(WWW):
        raise SystemExit("還沒有 www/，先跑：python android-app/build_www.py")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = "http://localhost:%d" % PORT
        print("App 版預覽：%s" % url)
        print("目錄：%s" % WWW)
        print()
        print("這是 App 模式（index.html 帶著 ptcg-app-mode 標記），")
        print("看到的介面與鎖定行為跟裝進手機之後一樣。")
        print("收藏資料存在 8899 這個網址底下，與你平常用的 8811 完全分開。")
        print()
        print("按 Ctrl+C 結束。")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已結束。")


if __name__ == "__main__":
    main()
