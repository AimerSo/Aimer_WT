from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import platform
import subprocess
import tempfile
import wave
from pathlib import Path


class BankPreviewService:
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)
        self.cache_dir = self.base_dir / "cache" / "preview_audio"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._streams_cache: dict[str, list[dict]] = {}

    def create_preview_data_url(self, bank_path: Path, max_seconds: int = 12) -> str:
        bank_path = Path(bank_path)
        bank_bytes = bank_path.read_bytes()
        fsb_chunks = self._extract_fsb_chunks(bank_bytes)
        if not fsb_chunks:
            raise ValueError("文件不正确")

        stat = bank_path.stat()
        cache_key = hashlib.sha1(
            f"{bank_path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{max_seconds}".encode("utf-8")
        ).hexdigest()
        cached_wav = self.cache_dir / f"{cache_key}.wav"
        if cached_wav.exists():
            return self._wav_to_data_url(cached_wav.read_bytes())

        fsb_bytes = fsb_chunks[0]
        wav_bytes = self._decode_fsb_to_wav(fsb_bytes)
        trimmed = self._trim_wav_bytes(wav_bytes, max_seconds=max_seconds)
        cached_wav.write_bytes(trimmed)
        return self._wav_to_data_url(trimmed)

    def create_preview_data_url_for_stream(
        self, bank_path: Path, chunk_index: int, stream_index: int, max_seconds: int = 12
    ) -> str:
        bank_path = Path(bank_path)
        bank_bytes = bank_path.read_bytes()
        fsb_chunks = self._extract_fsb_chunks(bank_bytes)
        if not fsb_chunks:
            raise ValueError("文件不正确")
        if chunk_index < 0 or chunk_index >= len(fsb_chunks):
            raise ValueError("文件不正确")
        if stream_index <= 0:
            raise ValueError("文件不正确")

        stat = bank_path.stat()
        cache_key = hashlib.sha1(
            f"{bank_path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{chunk_index}|{stream_index}|{max_seconds}".encode(
                "utf-8"
            )
        ).hexdigest()
        cached_wav = self.cache_dir / f"{cache_key}.wav"
        if cached_wav.exists():
            return self._wav_to_data_url(cached_wav.read_bytes())

        fsb_bytes = fsb_chunks[chunk_index]
        wav_bytes = self._decode_fsb_to_wav(fsb_bytes, stream_index=stream_index)
        trimmed = self._trim_wav_bytes(wav_bytes, max_seconds=max_seconds)
        cached_wav.write_bytes(trimmed)
        return self._wav_to_data_url(trimmed)

    def list_streams(self, bank_path: Path) -> list[dict]:
        bank_path = Path(bank_path)
        bank_bytes = bank_path.read_bytes()
        fsb_chunks = self._extract_fsb_chunks(bank_bytes)
        if not fsb_chunks:
            raise ValueError("文件不正确")

        stat = bank_path.stat()
        cache_key = hashlib.sha1(
            f"{bank_path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}".encode("utf-8")
        ).hexdigest()
        if cache_key in self._streams_cache:
            return self._streams_cache[cache_key]

        items: list[dict] = []
        for chunk_idx, fsb_bytes in enumerate(fsb_chunks):
            lines = self._probe_fsb_streams(fsb_bytes)
            for line in lines:
                try:
                    data = json.loads(line)
                except Exception:
                    continue
                stream_info = data.get("streamInfo") or {}
                idx = int(stream_info.get("index") or 0)
                total = int(stream_info.get("total") or 0)
                name = str(stream_info.get("name") or "")
                sample_rate = int(data.get("sampleRate") or 0)
                channels = int(data.get("channels") or 0)
                play_samples = int(data.get("playSamples") or data.get("numberOfSamples") or 0)
                duration_sec = (play_samples / sample_rate) if sample_rate > 0 else 0.0
                items.append(
                    {
                        "chunk_index": chunk_idx,
                        "stream_index": idx,
                        "stream_total": total,
                        "name": name,
                        "sample_rate": sample_rate,
                        "channels": channels,
                        "duration_sec": round(duration_sec, 3),
                    }
                )

        self._streams_cache[cache_key] = items
        return items

    @staticmethod
    def is_supported_bank(bank_path: Path) -> bool:
        bank_path = Path(bank_path)
        if not bank_path.exists() or not bank_path.is_file():
            return False
        try:
            with bank_path.open("rb") as f:
                head = f.read(12)
            return len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"FEV "
        except Exception:
            return False

    @staticmethod
    def _extract_fsb_chunks(bank_bytes: bytes) -> list[bytes]:
        if len(bank_bytes) < 12 or bank_bytes[:4] != b"RIFF" or bank_bytes[8:12] != b"FEV ":
            return []

        out: list[bytes] = []
        cursor = 0
        while True:
            idx = bank_bytes.find(b"SNDH", cursor)
            if idx < 0:
                break
            cursor = idx + 4
            if idx + 12 > len(bank_bytes):
                continue

            chunk_size = int.from_bytes(bank_bytes[idx + 4 : idx + 8], "little", signed=False)
            if chunk_size < 12:
                continue

            fsb_count = (chunk_size - 4) // 8
            if fsb_count <= 0:
                continue

            table_pos = idx + 12
            for i in range(fsb_count):
                entry_pos = table_pos + i * 8
                if entry_pos + 8 > len(bank_bytes):
                    break
                fsb_offset = int.from_bytes(bank_bytes[entry_pos : entry_pos + 4], "little", signed=False)
                fsb_size = int.from_bytes(bank_bytes[entry_pos + 4 : entry_pos + 8], "little", signed=False)
                if fsb_offset <= 0 or fsb_size <= 0:
                    continue
                end = fsb_offset + fsb_size
                if end > len(bank_bytes):
                    continue
                fsb_data = bank_bytes[fsb_offset:end]
                if len(fsb_data) >= 4 and fsb_data[:4] == b"FSB5":
                    out.append(fsb_data)
            if out:
                return out
        return out

    def _decode_fsb_to_wav(self, fsb_bytes: bytes, stream_index: int | None = None) -> bytes:
        vgmstream = self._find_vgmstream_cli()
        if not vgmstream:
            raise RuntimeError("缺少 vgmstream-cli，无法试听")

        with tempfile.TemporaryDirectory(prefix="aimer_preview_") as td:
            td_path = Path(td)
            fsb_file = td_path / "preview.fsb"
            wav_file = td_path / "preview.wav"
            fsb_file.write_bytes(fsb_bytes)

            cmd = [str(vgmstream)]
            if stream_index and stream_index > 0:
                cmd.extend(["-s", str(int(stream_index))])
            cmd.extend(["-o", str(wav_file), str(fsb_file)])
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if proc.returncode != 0 or not wav_file.exists():
                stderr = (proc.stderr or "").strip()
                raise RuntimeError(stderr or "bank 解析失败，文件不正确")

            return wav_file.read_bytes()

    def _probe_fsb_streams(self, fsb_bytes: bytes) -> list[str]:
        vgmstream = self._find_vgmstream_cli()
        if not vgmstream:
            raise RuntimeError("缺少 vgmstream-cli，无法试听")

        with tempfile.TemporaryDirectory(prefix="aimer_probe_") as td:
            td_path = Path(td)
            fsb_file = td_path / "probe.fsb"
            fsb_file.write_bytes(fsb_bytes)
            cmd = [str(vgmstream), "-I", "-S", "0", str(fsb_file)]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if proc.returncode != 0:
                stderr = (proc.stderr or "").strip()
                raise RuntimeError(stderr or "bank 解析失败，文件不正确")
            lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
            return [ln for ln in lines if ln.startswith("{") and ln.endswith("}")]

    @staticmethod
    def _trim_wav_bytes(wav_bytes: bytes, max_seconds: int) -> bytes:
        with wave.open(io.BytesIO(wav_bytes), "rb") as src:
            channels = src.getnchannels()
            sample_width = src.getsampwidth()
            frame_rate = src.getframerate()
            total_frames = src.getnframes()
            limit_frames = min(total_frames, frame_rate * max(1, int(max_seconds)))
            frames = src.readframes(limit_frames)

        out_buf = io.BytesIO()
        with wave.open(out_buf, "wb") as dst:
            dst.setnchannels(channels)
            dst.setsampwidth(sample_width)
            dst.setframerate(frame_rate)
            dst.writeframes(frames)
        return out_buf.getvalue()

    @staticmethod
    def _wav_to_data_url(wav_bytes: bytes) -> str:
        b64 = base64.b64encode(wav_bytes).decode("utf-8")
        return f"data:audio/wav;base64,{b64}"

    def _find_vgmstream_cli(self) -> Path | None:
        system_name = platform.system().lower()
        platform_dirs = {
            "windows": "windows",
            "linux": "linux",
            "darwin": "macos",
        }
        pdir = platform_dirs.get(system_name, "")

        candidates = []
        if pdir:
            candidates.extend(
                [
                    self.base_dir / "tools" / pdir / "vgmstream-cli.exe",
                    self.base_dir / "tools" / pdir / "vgmstream-cli",
                    self.base_dir / "tools" / "vgmstream" / pdir / "vgmstream-cli.exe",
                    self.base_dir / "tools" / "vgmstream" / pdir / "vgmstream-cli",
                ]
            )

        for p in candidates:
            if p.exists() and p.is_file():
                if os.name != "nt" and not os.access(p, os.X_OK):
                    continue
                return p
        return None

    def clear_cache(self) -> int:
        removed = 0
        try:
            for p in self.cache_dir.glob("*.wav"):
                try:
                    p.unlink(missing_ok=True)
                    removed += 1
                except Exception:
                    continue
        except Exception:
            pass
        return removed
