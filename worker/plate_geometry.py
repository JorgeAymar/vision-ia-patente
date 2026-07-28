"""Heurística pura para elegir la mejor detección de patente y calcular su recorte
con margen. No depende de YOLO ni de I/O — testeable sin correr el modelo real."""


def select_best_detection(boxes, confidences):
    """Devuelve (bbox, confidence) de la detección con mayor confianza, o None si
    no hay ninguna detección."""
    if not boxes:
        return None
    best_index = confidences.index(max(confidences))
    return boxes[best_index], confidences[best_index]


def expand_bbox_with_margin(bbox, image_width, image_height, margin_pct):
    """Expande un bbox (x1, y1, x2, y2) un margin_pct de su ancho/alto en cada lado,
    recortado a los límites de la imagen."""
    x1, y1, x2, y2 = bbox
    margin_x = (x2 - x1) * margin_pct
    margin_y = (y2 - y1) * margin_pct
    return (
        max(0, x1 - margin_x),
        max(0, y1 - margin_y),
        min(image_width, x2 + margin_x),
        min(image_height, y2 + margin_y),
    )
