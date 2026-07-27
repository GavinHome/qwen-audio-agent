#!/usr/bin/env python3
"""Line-delimited JSON bridge for the minimal TUI's half-duplex audio mode."""

import argparse
import base64
import json
import queue
import sys
import threading

try:
    import sounddevice as sd
except ImportError:
    sys.stderr.write(
        "缺少 Python sounddevice；请运行 pip install sounddevice\n"
    )
    raise SystemExit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture-rate", type=int, default=16000)
    parser.add_argument("--playback-rate", type=int, default=24000)
    args = parser.parse_args()

    playback_lock = threading.Lock()
    capture_enabled = threading.Event()
    playback = bytearray()
    events = queue.SimpleQueue()

    def write_events():
        while True:
            event = events.get()
            if event is None:
                return
            sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    writer = threading.Thread(target=write_events, daemon=True)
    writer.start()

    def emit(event):
        events.put(event)

    def report_status(status):
        if status:
            emit({"type": "error", "message": str(status)})

    def capture_callback(indata, _frames, _time_info, status):
        report_status(status)
        if capture_enabled.is_set():
            emit({
                "type": "audio",
                "audio": base64.b64encode(bytes(indata)).decode("ascii"),
            })

    def playback_callback(outdata, _frames, _time_info, status):
        report_status(status)
        size = len(outdata)
        with playback_lock:
            available = min(size, len(playback))
            chunk = bytes(playback[:available])
            del playback[:available]
        outdata[:] = chunk + bytes(size - available)

    exit_code = 0
    try:
        with sd.RawInputStream(
            samplerate=args.capture_rate,
            channels=1,
            dtype="int16",
            blocksize=max(160, args.capture_rate // 50),
            callback=capture_callback,
        ), sd.RawOutputStream(
            samplerate=args.playback_rate,
            channels=1,
            dtype="int16",
            blocksize=max(240, args.playback_rate // 50),
            callback=playback_callback,
        ):
            emit({"type": "ready"})
            for line in sys.stdin:
                try:
                    event = json.loads(line)
                    event_type = event.get("type")
                    if event_type == "capture":
                        if event.get("enabled"):
                            capture_enabled.set()
                        else:
                            capture_enabled.clear()
                    elif event_type == "play":
                        audio = base64.b64decode(event.get("audio", ""))
                        with playback_lock:
                            playback.extend(audio)
                    elif event_type == "clear":
                        with playback_lock:
                            playback.clear()
                    elif event_type == "close":
                        break
                except Exception as error:
                    emit({"type": "error", "message": str(error)})
    except Exception as error:
        sys.stderr.write(f"PortAudio 初始化失败：{error}\n")
        exit_code = 1
    finally:
        events.put(None)
        writer.join(timeout=1)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
