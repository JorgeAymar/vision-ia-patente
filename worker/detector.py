"""Heurística pura para asociar cascos/guantes detectados con cada persona en un frame.

No depende de YOLO ni de I/O — recibe listas de bounding boxes (x1, y1, x2, y2)
y devuelve la clasificación por persona. Esto es lo que hace testeable la lógica
sin necesitar correr el modelo real en cada test.
"""


def box_center_inside(inner_box, outer_box):
    x1, y1, x2, y2 = inner_box
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    ox1, oy1, ox2, oy2 = outer_box
    return ox1 <= cx <= ox2 and oy1 <= cy <= oy2


def head_region(person_box):
    """Región de cabeza = 35% superior del bounding box de la persona."""
    x1, y1, x2, y2 = person_box
    h = y2 - y1
    return (x1, y1, x2, y1 + h * 0.35)


def classify_persons(persons, helmets, gloves):
    """Para cada persona, determina si tiene casco (en zona de cabeza) y/o
    guantes (en cualquier parte de su bounding box)."""
    results = []
    for p_box in persons:
        hr = head_region(p_box)
        has_helmet = any(box_center_inside(h_box, hr) for h_box in helmets)
        has_glove = any(box_center_inside(g_box, p_box) for g_box in gloves)
        results.append({
            "bbox": p_box,
            "has_helmet": has_helmet,
            "has_glove": has_glove,
        })
    return results
