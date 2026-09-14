"""Local media analysis. Results go to --output; failures are safe JSON on stderr."""

import argparse
import json
import math
import os
from pathlib import Path
import sys


class MediaError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def vision_modules():
    try:
        import cv2
        from scenedetect import ContentDetector, SceneManager, open_video
    except (ImportError, OSError) as exc:
        raise MediaError("DEPENDENCIES_MISSING", "Установите Python-зависимости из server/ai/requirements.txt в окружение обработки видео.") from exc
    return cv2, ContentDetector, SceneManager, open_video


def read_video(input_path):
    cv2, _, _, _ = vision_modules()
    capture = cv2.VideoCapture(str(input_path))
    fps = capture.get(cv2.CAP_PROP_FPS)
    frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
    height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
    capture.release()
    if not all(math.isfinite(value) and value > 0 for value in (fps, frames, width, height)):
        raise MediaError("VIDEO_INVALID", "Не удалось прочитать видеодорожку. Проверьте файл и поддерживаемый формат.")
    return {"duration": round(frames / fps, 6), "fps": fps, "width": int(width), "height": int(height)}


def detect_scenes(input_path):
    _, ContentDetector, SceneManager, open_video = vision_modules()
    video = open_video(str(input_path))
    manager = SceneManager()
    manager.add_detector(ContentDetector(threshold=27.0, min_scene_len=max(1, round(video.frame_rate * 0.5))))
    manager.detect_scenes(video=video, show_progress=False)
    return [{"start": round(start.get_seconds(), 6), "end": round(end.get_seconds(), 6)}
            for start, end in manager.get_scene_list(start_in_scene=True)]


def track_faces(input_path, metadata, start=0.0, end=None, scenes=()):
    cv2, _, _, _ = vision_modules()
    end = metadata["duration"] if end is None else min(end, metadata["duration"])
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or start >= end:
        raise MediaError("INVALID_RANGE", "Начало фрагмента должно быть раньше его конца и находиться внутри видео.")
    # OpenCV's XML file loader cannot open Cyrillic Windows paths; Python can.
    cascade_xml = (Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml").read_text(encoding="utf-8")
    storage = cv2.FileStorage(cascade_xml, cv2.FILE_STORAGE_READ | cv2.FILE_STORAGE_MEMORY)
    cascade = cv2.CascadeClassifier()
    cascade.read(storage.getFirstTopLevelNode())
    storage.release()
    if cascade.empty():
        raise MediaError("FACE_MODEL_MISSING", "Модель поиска лиц OpenCV недоступна. Переустановите зависимости обработки видео.")
    capture = cv2.VideoCapture(str(input_path))
    # ponytail: sampled frontal faces guide cropping; this does not identify the active speaker.
    interval = max(0.5, (end - start) / 7200)
    cuts = iter(scene["start"] for scene in scenes if scene["start"] > start)
    next_cut = next(cuts, math.inf)
    center = 0.5
    previous_time = start
    result = []
    try:
        for index in range(min(7200, math.ceil((end - start) / interval))):
            time = start + index * interval
            reset = index == 0
            while time >= next_cut:
                reset = True
                next_cut = next(cuts, math.inf)
            capture.set(cv2.CAP_PROP_POS_MSEC, time * 1000)
            ok, frame = capture.read()
            if not ok:
                raise MediaError("VIDEO_DECODE_FAILED", "Не удалось прочитать кадр видео для автоматического кадрирования.")
            height, width = frame.shape[:2]
            scale = min(1.0, 640 / width)
            if scale < 1:
                frame = cv2.resize(frame, (round(width * scale), round(height * scale)))
            small_height, small_width = frame.shape[:2]
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            boxes = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
            faces = [{"x": round(float(x) / small_width, 6), "y": round(float(y) / small_height, 6),
                      "width": round(float(w) / small_width, 6), "height": round(float(h) / small_height, 6)}
                     for x, y, w, h in boxes]
            target = 0.5
            if faces:
                largest = max(face["width"] * face["height"] for face in faces)
                candidates = [face for face in faces if face["width"] * face["height"] >= largest * 0.5]
                face = max(candidates, key=lambda f: f["width"] * f["height"]) if reset else min(candidates, key=lambda f: abs(f["x"] + f["width"] / 2 - center))
                target = face["x"] + face["width"] / 2
            weight = 1 if reset else 1 - math.exp(-(time - previous_time) / 0.8)
            center = min(1.0, max(0.0, center + (target - center) * weight))
            result.append({"time": round(time, 6), "x": round(center, 6), "faces": faces})
            previous_time = time
    finally:
        capture.release()
    return result


def transcribe(input_path):
    cache = Path(__file__).resolve().parents[2] / ".scena"
    os.environ.setdefault("HF_HOME", str(cache / "huggingface"))
    try:
        from faster_whisper import WhisperModel
    except (ImportError, OSError) as exc:
        raise MediaError("DEPENDENCIES_MISSING", "Whisper недоступен. Установите Python-зависимости из server/ai/requirements.txt.") from exc
    try:
        model = WhisperModel(
            os.environ.get("SCENZA_WHISPER_MODEL", "small"),
            device=os.environ.get("SCENZA_WHISPER_DEVICE", "cpu"),
            compute_type=os.environ.get("SCENZA_WHISPER_COMPUTE_TYPE", "int8"),
            download_root=os.environ.get("SCENZA_WHISPER_CACHE") or str(cache / "models"),
        )
    except Exception as exc:
        raise MediaError("WHISPER_MODEL_UNAVAILABLE", "Не удалось загрузить модель Whisper. Проверьте соединение при первом запуске, свободное место и настройки модели.") from exc
    try:
        segments, info = model.transcribe(str(input_path), word_timestamps=True, vad_filter=True, beam_size=5)
        result = [{"start": round(segment.start, 6), "end": round(segment.end, 6), "text": segment.text.strip(),
                   "words": [{"start": round(word.start, 6), "end": round(word.end, 6), "word": word.word}
                             for word in segment.words or []]}
                  for segment in segments]
        return {"language": info.language, "segments": result}
    except Exception as exc:
        raise MediaError("TRANSCRIPTION_FAILED", "Не удалось распознать речь. Проверьте звуковую дорожку и настройки Whisper.") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("analyze", "inspect", "transcribe", "track"))
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float)
    args = parser.parse_args()
    try:
        if not args.input.is_file():
            raise MediaError("INPUT_NOT_FOUND", "Исходный видеофайл не найден.")
        if args.input.resolve() == args.output.resolve():
            raise MediaError("OUTPUT_INVALID", "Файл результата не должен совпадать с исходным видео.")
        result = {}
        if args.command in ("analyze", "inspect", "track"):
            metadata = read_video(args.input)
            scenes = detect_scenes(args.input) if args.command != "track" else []
            result.update(metadata)
            result["scenes"] = scenes
            result["tracking"] = track_faces(args.input, metadata, args.start, args.end, scenes)
        if args.command in ("analyze", "transcribe"):
            result.update(transcribe(args.input))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_name(args.output.name + ".tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        temporary.replace(args.output)
        print(json.dumps({"ok": True}))
        return 0
    except MediaError as exc:
        error = {"code": exc.code, "message": str(exc)}
    except Exception:
        error = {"code": "MEDIA_PROCESSING_FAILED", "message": "Обработка видео не завершена. Проверьте файл, доступ к каталогу результата и зависимости Python."}
    print(json.dumps({"error": error}, ensure_ascii=True), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
