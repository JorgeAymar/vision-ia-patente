import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from plate_geometry import select_best_detection, expand_bbox_with_margin


def test_select_best_detection_returns_none_when_no_boxes():
    assert select_best_detection([], []) is None


def test_select_best_detection_returns_highest_confidence_box():
    boxes = [(0, 0, 10, 10), (20, 20, 40, 40)]
    confidences = [0.3, 0.8]
    bbox, confidence = select_best_detection(boxes, confidences)
    assert bbox == (20, 20, 40, 40)
    assert confidence == 0.8


def test_expand_bbox_with_margin_adds_15_percent_each_side():
    bbox = (100, 100, 200, 140)  # ancho 100, alto 40
    result = expand_bbox_with_margin(bbox, image_width=1000, image_height=1000, margin_pct=0.15)
    assert result == (85.0, 94.0, 215.0, 146.0)


def test_expand_bbox_with_margin_clamps_to_image_bounds():
    bbox = (0, 0, 20, 20)
    result = expand_bbox_with_margin(bbox, image_width=1000, image_height=1000, margin_pct=0.5)
    assert result == (0, 0, 30.0, 30.0)
