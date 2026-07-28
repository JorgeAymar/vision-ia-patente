# worker/detect_plate.py
import base64
import contextlib
import json
import sys

import cv2
from ultralytics import YOLOE

from plate_geometry import expand_bbox_with_margin, select_best_detection

CLASSES = ["license plate"]
# yoloe-11s-seg.pt vs yoloe-26s-seg.pt para la clase "license plate" (NO es el
# mismo resultado que para "safety helmet" en la app de EPP, donde YOLO26 salió
# peor — son clases de texto distintas en un modelo zero-shot, cada una se mide
# por separado). Comparado en 2 fotos reales:
#   auto original (primer plano):  yolo11 0.176  vs  yolo26 0.234
#   foto de auto difícil (chica, no primer plano): yolo11 0.023  vs  yolo26 0.031
# YOLO26 ganó confianza en ambos casos y además devolvió muchísimo menos ruido
# (1-2 candidatos totales vs 5+ de YOLO11 en la misma imagen), así que se usa
# YOLO26 acá.
CONF_THRESHOLD = 0.02
MARGIN_PCT = 0.15


def get_model():
    model = YOLOE("yoloe-26s-seg.pt")
    model.set_classes(CLASSES, model.get_text_pe(CLASSES))
    return model


def detect_plate(image_path):
    image = cv2.imread(image_path)
    if image is None:
        return {"error": "no_se_pudo_leer_la_imagen"}

    # ultralytics escribe su banner/progreso a stdout. Next.js parsea el stdout
    # de este script como JSON puro, así que redirigimos ese ruido a stderr
    # mientras carga el modelo y corre la inferencia.
    with contextlib.redirect_stdout(sys.stderr):
        model = get_model()
        results = model.predict(image, conf=CONF_THRESHOLD, verbose=False)[0]

    boxes = results.boxes.xyxy.tolist()
    confidences = results.boxes.conf.tolist()

    best = select_best_detection(boxes, confidences)
    if best is None:
        return {"error": "no_plate_detected"}

    bbox, confidence = best
    height, width = image.shape[:2]
    x1, y1, x2, y2 = expand_bbox_with_margin(bbox, width, height, MARGIN_PCT)
    cropped = image[int(y1):int(y2), int(x1):int(x2)]

    ok, buffer = cv2.imencode(".png", cropped)
    if not ok:
        return {"error": "no_se_pudo_recortar_la_imagen"}

    cropped_base64 = base64.b64encode(buffer).decode("ascii")
    return {
        "bbox": [x1, y1, x2, y2],
        "confidence": confidence,
        "croppedImageBase64": cropped_base64,
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "uso: detect_plate.py <ruta_imagen>"}))
        sys.exit(1)

    print(json.dumps(detect_plate(sys.argv[1])))


if __name__ == "__main__":
    main()
