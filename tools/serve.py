"""本地开发服务器（零依赖）。

为什么不能直接双击 web/index.html：
  浏览器对 file:// 下的多文件加载、音频、localStorage 有一堆限制，
  跑个本地服务最省事，也最接近真实环境。

用法：
    python tools/serve.py                # 只听 127.0.0.1:8080，仅本机可访问
    python tools/serve.py 8080 --lan     # 监听所有网卡，手机可以用局域网 IP 访问
    python tools/serve.py 8080 --lan --ip 192.168.1.10   # 手动指定要打印的 IP
然后：
    电脑上打开   http://127.0.0.1:8080/web/
    手机上打开   http://<你的局域网IP>:8080/web/     （同一 Wi-Fi 下）
"""
import http.server
import os
import socket
import socketserver
import sys


def lan_ips():
    """列出本机所有非回环 IPv4 地址（不依赖第三方库）"""
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    # 再加一个"连出去看到的本机地址"，这个通常就是 Wi-Fi 网卡
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        if ip not in ips and not ip.startswith('127.'):
            ips.insert(0, ip)
        s.close()
    except Exception:
        pass
    return ips


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".webp": "image/webp",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    })

    def end_headers(self):
        # 开发期禁用缓存，改完刷新就能看到
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    args = [a for a in sys.argv[1:]]
    lan = '--lan' in args
    forced_ip = None
    if '--ip' in args:
        i = args.index('--ip')
        if i + 1 < len(args):
            forced_ip = args[i + 1]
            del args[i:i + 2]
    args = [a for a in args if not a.startswith('--')]
    port = int(args[0]) if args else 8080

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    host = '0.0.0.0' if lan else '127.0.0.1'

    try:
        httpd = Server((host, port), Handler)
    except OSError as e:
        print("启动失败：%s" % e)
        print("端口 %d 可能已被占用（是不是已经开着一个了？）" % port)
        return 1

    print("服务已启动，目录：%s" % root)
    print("  本机：      http://127.0.0.1:%d/web/" % port)
    if lan:
        ips = [forced_ip] if forced_ip else lan_ips()
        if ips:
            for ip in ips:
                print("  手机访问：  http://%s:%d/web/" % (ip, port))
        else:
            print("  没找到局域网 IP，用 ipconfig 查一下再用 --ip 指定")
        print()
        print("  手机连不上的话按顺序查：")
        print("   1) 手机和电脑必须在**同一个 Wi-Fi**（不是手机流量、不是访客网络）")
        print("   2) 当前网络是「公用网络」时 Windows 防火墙会拦入站：")
        print("      设置 → 网络和 Internet → 属性 → 改成「专用网络」")
        print("   3) 部分路由器开了「AP 隔离」，同一 Wi-Fi 也互相不通，关掉它")
    else:
        print("  （只监听 127.0.0.1，手机访问不了；要手机测试请加 --lan）")
    print("按 Ctrl+C 停止")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
