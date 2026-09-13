"""
啟動「寶可夢 PTCG 全圖鑑收藏」本機伺服器，並自動開啟瀏覽器。

用法：
  直接雙擊同資料夾的「啟動圖鑑.bat」，或在這個資料夾執行：
      python start_app.py

為什麼需要伺服器：這個 App 會用 fetch() 讀取 data/*.json，
直接用 file:// 開 index.html 瀏覽器會擋下來，所以要透過 http:// 開啟。
關掉這個視窗（或按 Ctrl+C）就會停止伺服器。

重要：一定要固定用同一個連接埠（預設 8811）。瀏覽器的 IndexedDB 是「依網址
（含連接埠）分開存放」的，localhost:8811 與 localhost:8812 對瀏覽器來說是兩個
不同的網站，收藏紀錄與手動上傳的圖片不會互通。所以這支程式在 8811 已被占用時
會先確認「占用的是不是同一個圖鑑伺服器」，是的話就直接沿用它、不另外開一個，
避免使用者這次在 8811 存資料、下次跑到 8812 看起來像資料全部不見。
"""
import http.server
import os
import socket
import socketserver
import threading
import urllib.error
import urllib.request
import webbrowser

import setup_images

PREFERRED_PORT = 8811
PORT_RANGE = 20  # 8811 被占用又不是我們自己的伺服器時，往後找，最多試 20 個

# 放在 data/app_id.txt 的辨識字串：用來確認「占住 8811 的是不是同一個圖鑑」。
# 第二行會寫入這份專案的絕對路徑，這樣同一台機器上放了兩份（例如又從 GitHub
# clone 了一份來測），兩邊才不會互相認親 —— 不然在 B 資料夾按啟動，卻打開了
# A 資料夾正在跑的那個 App，而且兩邊的收藏資料還會混在同一個網址底下。
APP_ID = "pokecard-dex-local-server"
APP_ID_PATH = "/data/app_id.txt"


def local_marker():
    return APP_ID + chr(10) + os.path.dirname(os.path.abspath(__file__))


def write_marker():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "app_id.txt")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        # newline="" 避免 Windows 把 \n 自動換成 \r\n，
        # 那樣寫出去的內容就跟 local_marker() 對不起來了
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(local_marker())
    except OSError:
        pass  # 寫不進去頂多是失去「沿用既有伺服器」的能力，不該讓 App 開不起來


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 不要把每一張卡圖的請求都印出來洗版（上萬張圖片會刷爆視窗）
        pass

    def end_headers(self):
        # 程式碼與資料檔（js/json）不快取：更新卡表或重新產生圖片對照表後，
        # 瀏覽器常會繼續用舊的快取檔，看起來像「改了沒生效」。
        # 圖片則允許快取，不然每次切頁都要重抓上百張卡圖。
        path = self.path.split("?")[0].lower()
        if path.endswith((".js", ".json", ".css", ".html", "/")):
            self.send_header("Cache-Control", "no-store, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()


class DualStackServer(socketserver.ThreadingTCPServer):
    """同時聽 IPv4 與 IPv6，而且每個連線各自一個執行緒。

    一定要 threading：單執行緒的 TCPServer 一次只能處理一個連線，
    而這個 App 一頁會同時要求幾十張卡圖，瀏覽器的並行連線會把它卡住。
    （`python -m http.server` 內部用的也是 ThreadingHTTPServer。）

    只綁 IPv4 的話，瀏覽器／curl 把 localhost 解析成 ::1（IPv6）時會連不上，
    這也是 `python -m http.server` 內部的作法。

    allow_reuse_address 在 Windows 上刻意設 False：Windows 的 SO_REUSEADDR
    會允許「第二個程式綁同一個埠」，連線就會被兩個伺服器隨機瓜分而壞掉
    （重複雙擊啟動檔就會踩到）。設 False 讓第二次啟動直接綁失敗，
    交給下面的連接埠掃描換到 8812、8813…，兩個視窗各跑各的互不干擾。
    """
    allow_reuse_address = os.name != "nt"
    address_family = socket.AF_INET6 if socket.has_ipv6 else socket.AF_INET
    daemon_threads = True  # 關視窗／Ctrl+C 時不要被連線執行緒卡住不退出

    def server_bind(self):
        if self.address_family == socket.AF_INET6:
            try:
                self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                pass
        super().server_bind()


def start_image_backfill_if_needed():
    """本機缺卡圖時，自動在背景補下載。

    為什麼放在背景：`images/` 沒有進 git（約 957 MB），從 GitHub clone 下來
    是空的，要補齊得下載上萬張圖、花很久。如果卡在這裡等下載完才開 App，
    使用者只會看到一個不動的黑視窗。所以先把伺服器跑起來（缺圖的部分前端
    本來就會自動退回遠端網址或顯示替代畫面），下載在旁邊慢慢跑，
    抓好一張，重新整理頁面就會用本機那張。

    下載流程本身可續傳，關視窗中斷不會壞掉，下次啟動會接著補。
    不想要這個行為的話，建立一個空檔案 data/.no_auto_download 即可。
    """
    if setup_images.opted_out():
        return

    state = setup_images.survey()
    summary = setup_images.describe(state)
    if summary is None:
        return

    print("")
    print(f"  卡圖檢查：{summary}")

    deps = setup_images.missing_dependencies()
    if deps:
        print(f"  需要 {', '.join(deps)} 才能自動補圖，請先執行："
              f" pip install {' '.join(deps)}")
        print("  （不補也能用，缺圖的卡片會顯示替代畫面）")
        return

    print("  已在背景開始自動補下載，可以先正常使用 App。")
    print("  （中斷沒關係，下次啟動會接著補；不想自動下載就建立空檔案 data/.no_auto_download）")
    print("")

    def worker():
        try:
            setup_images.download_missing(echo=lambda line: print(f"[補圖] {line}", flush=True))
        except Exception as exc:  # 補圖失敗不該影響 App 本身
            print(f"[補圖] 中止：{exc}", flush=True)

    threading.Thread(target=worker, daemon=True).start()


def try_bind(port):
    """回傳可用的 server 物件；該連接埠被占用時回傳 None。"""
    try:
        return DualStackServer(("", port), QuietHandler)
    except OSError:
        return None


def is_our_server(port):
    """占用這個連接埠的，是不是另一個「同一份資料夾」的圖鑑伺服器？

    比對 data/app_id.txt 的內容。是的話就沿用它，讓網址（也就是瀏覽器存收藏
    資料的地方）永遠維持同一個，不會因為忘了關舊視窗就換到新的連接埠。
    """
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{APP_ID_PATH}", timeout=2) as resp:
            body = resp.read(4096).decode("utf-8", "ignore").strip()
    except (urllib.error.URLError, OSError, ValueError):
        return False
    # 要「同一支程式」而且「同一個資料夾」才算自己人。
    # 比對前把換行統一掉：這個檔案可能被不同工具用 CRLF 存過。
    def norm(text):
        return text.replace(chr(13) + chr(10), chr(10)).replace(chr(13), chr(10)).strip()

    return norm(body) == norm(local_marker())


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    write_marker()

    httpd = None
    port = None
    for candidate in range(PREFERRED_PORT, PREFERRED_PORT + PORT_RANGE):
        httpd = try_bind(candidate)
        if httpd is not None:
            port = candidate
            break
        # 綁不上：先確認是不是自己人。是的話就不要再開一個，直接用它的網址，
        # 這樣收藏紀錄與自訂圖片才會一直待在同一個 localhost:<port> 底下。
        if is_our_server(candidate):
            url = f"http://localhost:{candidate}"
            print("=" * 46)
            print("  已經有一個圖鑑伺服器在執行，直接開啟它。")
            print(f"  網址：{url}")
            print("")
            print("  （沒有另外開新的伺服器：收藏紀錄是依網址儲存的，")
            print("    換連接埠會看起來像資料不見，所以固定沿用同一個。）")
            print("=" * 46)
            webbrowser.open(url)
            input("按 Enter 關閉這個視窗...")
            return

    if httpd is None:
        print(f"找不到可用的連接埠（{PREFERRED_PORT}-{PREFERRED_PORT + PORT_RANGE - 1} 都被占用）。")
        input("按 Enter 關閉...")
        return

    url = f"http://localhost:{port}"
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    with httpd:
        print("=" * 46)
        print("  寶可夢 PTCG 全圖鑑收藏 執行中")
        print(f"  網址：{url}")
        print("  （瀏覽器會自動開啟；沒開的話請手動貼上網址）")
        if port != PREFERRED_PORT:
            print("")
            print(f"  ※ 注意：{PREFERRED_PORT} 被「其他程式」占用了，這次改用 {port}。")
            print("    瀏覽器的收藏資料是依網址分開存的，這個網址底下會是空的。")
            print(f"    想拿回原本的資料，請關掉占用 {PREFERRED_PORT} 的程式後重開。")
        print("")
        print("  關閉這個視窗或按 Ctrl+C 就會停止。")
        print("=" * 46)
        start_image_backfill_if_needed()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()
