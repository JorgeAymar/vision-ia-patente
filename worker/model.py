import cv2
from ultralytics import YOLOE

CLASSES = ["person", "safety helmet", "safety gloves"]
CLASS_MAP = {
    "person": "person",
    "safety helmet": "helmet",
    "safety gloves": "glove",
}
CONF_THRESHOLD = 0.12
SAMPLE_EVERY_N_FRAMES = 15  # ~2 fps a 30fps de origen

_model = None


def get_model():
    global _model
    if _model is None:
        # yoloe-26s-seg.pt (YOLO26) se probó y quedó descartado: con el mismo
        # umbral de confianza, "safety helmet" nunca cruza el piso (0.01) en
        # frames donde yoloe-11s-seg.pt sí lo detecta de forma consistente.
        # yoloe-11 sigue siendo la versión validada para este caso de uso.
        _model = YOLOE("yoloe-11s-seg.pt")
        _model.set_classes(CLASSES, _model.get_text_pe(CLASSES))
    return _model


def detect_sampled_frames(video_path, sample_every=SAMPLE_EVERY_N_FRAMES):
    """Recorre el video, corre YOLOE cada `sample_every` frames, y devuelve
    una lista de dicts: {frame_number, time_s, frame, persons, helmets, gloves}
    donde persons/helmets/gloves son listas de bboxes (x1, y1, x2, y2)."""
    model = get_model()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"No se pudo abrir el video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_idx = 0
    out = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_every == 0:
            results = model.predict(frame, conf=CONF_THRESHOLD, verbose=False)[0]
            persons, helmets, gloves = [], [], []
            for box, cls_id, conf in zip(
                results.boxes.xyxy.tolist(),
                results.boxes.cls.tolist(),
                results.boxes.conf.tolist(),
            ):
                raw_name = results.names[int(cls_id)]
                mapped = CLASS_MAP.get(raw_name)
                if mapped == "person":
                    persons.append(tuple(box))
                elif mapped == "helmet":
                    helmets.append(tuple(box))
                elif mapped == "glove":
                    gloves.append(tuple(box))

            out.append({
                "frame_number": frame_idx,
                "time_s": frame_idx / fps,
                "frame": frame,
                "persons": persons,
                "helmets": helmets,
                "gloves": gloves,
            })

        frame_idx += 1

    cap.release()
    return out
