"""用 CDP 连上真实运行的 Chrome，在页面里执行一段 JS 并取回结果。

用途：调试那些"看截图看不出来"的问题（贴图有没有加载、变量是什么值）。

用法：
    python tools/cdp_eval.py <url> "<要执行的JS表达式>" [等待秒数]
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

CHROME = [
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
]


def find_browser():
    for p in CHROME:
        if p and os.path.exists(p):
            return p
    raise SystemExit('找不到 Chrome')


class WS:
    def __init__(self, url):
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
        self.sock.sendall(bytes(head) + b'\x00\x00\x00\x00' + data)

    def recv_text(self):
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
            if (b1 & 0x0F) == 0x1:
                return payload.decode('utf-8', 'replace')
            if (b1 & 0x0F) == 0x8:
                raise SystemExit('websocket closed')


def main():
    url, expr = sys.argv[1], sys.argv[2]
    wait = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
    port = 9334
    profile = tempfile.mkdtemp(prefix='cdpeval_')
    proc = subprocess.Popen([
        find_browser(), '--headless=new', '--disable-gpu', '--no-first-run',
        '--no-default-browser-check', '--remote-debugging-port=%d' % port,
        '--user-data-dir=' + profile, 'about:blank',
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(60):
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=5) as r:
                    tabs = json.load(r)
                target = next((t for t in tabs if t.get('type') == 'page'), None)
                if target:
                    break
            except Exception:
                pass
            time.sleep(0.25)
        ws = WS(target['webSocketDebuggerUrl'])
        seq = [0]

        def cmd(method, params=None):
            seq[0] += 1
            ws.send({'id': seq[0], 'method': method, 'params': params or {}})
            while True:
                m = json.loads(ws.recv_text())
                if m.get('id') == seq[0]:
                    return m

        cmd('Page.enable')
        cmd('Page.navigate', {'url': url})
        time.sleep(wait)
        res = cmd('Runtime.evaluate',
                  {'expression': expr, 'returnByValue': True, 'awaitPromise': False})
        r = res.get('result', {})
        if 'exceptionDetails' in r:
            print('JS 异常:', json.dumps(r['exceptionDetails'], ensure_ascii=False))
        print(json.dumps(r.get('result', {}).get('value', r), ensure_ascii=False, indent=2))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == '__main__':
    main()
