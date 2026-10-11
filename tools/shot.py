"""用 CDP 在**真实时钟**下给网页截图。

为什么不用 chrome --screenshot：
  无头 Chrome 的 --virtual-time-budget 会把 performance.now() 冻住，
  requestAnimationFrame 也不按正常节奏派发，截出来的画面停在第一帧。
  用 DevTools 协议连上一个真实运行的 Chrome，等几秒再截图才靠谱。

用法：
    python tools/shot.py <url> <输出png> [等待秒数] [宽] [高]
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

CHROME_CANDIDATES = [
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
]


def find_browser():
    for p in CHROME_CANDIDATES:
        if p and os.path.exists(p):
            return p
    raise SystemExit("找不到 Chrome/Edge")


def cdp(port, path):
    with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=10) as r:
        return json.load(r)


class WS:
    """极简 WebSocket 客户端：只够发一条命令、收一条结果。"""

    def __init__(self, url):
        import socket
        from urllib.parse import urlparse
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(b'0123456789abcdef').decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n" % (u.path, u.hostname, u.port, key))
        self.sock.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]

    def send(self, obj):
        import struct
        data = json.dumps(obj).encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack('>H', n)
        else:
            head.append(0x80 | 127)
            head += struct.pack('>Q', n)
        mask = b'\x00\x00\x00\x00'
        self.sock.sendall(bytes(head) + mask + data)

    def recv_text(self):
        import struct
        while True:
            data = self.buf
            while len(data) < 2:
                data += self.sock.recv(65536)
            b1, b2 = data[0], data[1]
            ln = b2 & 0x7F
            off = 2
            if ln == 126:
                while len(data) < 4:
                    data += self.sock.recv(65536)
                ln = struct.unpack('>H', data[2:4])[0]
                off = 4
            elif ln == 127:
                while len(data) < 10:
                    data += self.sock.recv(65536)
                ln = struct.unpack('>Q', data[2:10])[0]
                off = 10
            while len(data) < off + ln:
                data += self.sock.recv(65536)
            payload = data[off:off + ln]
            self.buf = data[off + ln:]
            op = b1 & 0x0F
            if op == 0x1:
                return payload.decode('utf-8', 'replace')
            if op == 0x8:
                raise SystemExit("websocket closed")


def main():
    url = sys.argv[1]
    out = sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 8.0
    w = int(sys.argv[4]) if len(sys.argv) > 4 else 520
    h = int(sys.argv[5]) if len(sys.argv) > 5 else 924
    port = 9333
    profile = tempfile.mkdtemp(prefix='cdpshot_')
    browser = find_browser()
    proc = subprocess.Popen([
        browser, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=%d' % port, '--user-data-dir=' + profile,
        '--window-size=%d,%d' % (w, h), 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(60):
            try:
                tabs = cdp(port, '/json/list')
                target = next((t for t in tabs if t.get('type') == 'page'), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        if not target:
            raise SystemExit('连不上 DevTools')

        ws = WS(target['webSocketDebuggerUrl'])
        seq = [0]

        def cmd(method, params=None):
            seq[0] += 1
            ws.send({'id': seq[0], 'method': method, 'params': params or {}})
            while True:
                msg = json.loads(ws.recv_text())
                if msg.get('id') == seq[0]:
                    return msg

        cmd('Page.enable')
        cmd('Emulation.setDeviceMetricsOverride',
            {'width': w, 'height': h, 'deviceScaleFactor': 2, 'mobile': True})
        cmd('Page.navigate', {'url': url})
        time.sleep(wait)
        res = cmd('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
        data = res.get('result', {}).get('data')
        if not data:
            raise SystemExit('截图失败: %s' % res)
        with open(out, 'wb') as f:
            f.write(base64.b64decode(data))
        print('已保存 %s (%.1f KB)' % (out, os.path.getsize(out) / 1024.0))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
