"""Start Finish Together: python3 run.py, then open http://localhost:8000"""
import argparse

import uvicorn

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--reset", action="store_true", help="start over with the demo clubs")
    ap.add_argument("--host", default="127.0.0.1",
                    help="use 0.0.0.0 to open it from a phone on the same Wi-Fi")
    a = ap.parse_args()
    if a.reset:
        from app import db
        db.init(reset=True)
    from app import config
    print(f"\nFinish Together | mode: {config.MODE} | .env: {config.ENV_FILE or 'none found (demo mode)'}")
    print(f"Open http://localhost:{a.port}\n")
    if a.host != "127.0.0.1":
        print("On your phone, open http://<this computer's local IP>:%d (same Wi-Fi)\n" % a.port)
    uvicorn.run("app.main:app", host=a.host, port=a.port)
