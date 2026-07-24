import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from detector import box_center_inside, head_region, classify_persons


def test_box_center_inside_true_when_center_within_outer():
    inner = (10, 10, 20, 20)  # centro (15, 15)
    outer = (0, 0, 30, 30)
    assert box_center_inside(inner, outer) is True


def test_box_center_inside_false_when_center_outside():
    inner = (100, 100, 120, 120)
    outer = (0, 0, 30, 30)
    assert box_center_inside(inner, outer) is False


def test_head_region_is_top_35_percent_of_person_box():
    person = (0, 0, 100, 200)  # altura 200
    assert head_region(person) == (0, 0, 100, 70.0)


def test_classify_persons_detects_helmet_in_head_region():
    persons = [(0, 0, 100, 200)]
    helmets = [(10, 5, 90, 40)]  # centro (50, 22.5) -> dentro de cabeza (0,0,100,70)
    gloves = []
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": True, "has_glove": False}]


def test_classify_persons_ignores_helmet_outside_head_region():
    persons = [(0, 0, 100, 200)]
    helmets = [(10, 150, 90, 190)]  # centro (50, 170) -> fuera de cabeza
    gloves = []
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": False, "has_glove": False}]


def test_classify_persons_detects_glove_anywhere_in_person_box():
    persons = [(0, 0, 100, 200)]
    helmets = []
    gloves = [(40, 160, 60, 190)]  # centro (50, 175) -> dentro de la persona
    result = classify_persons(persons, helmets, gloves)
    assert result == [{"bbox": (0, 0, 100, 200), "has_helmet": False, "has_glove": True}]


def test_classify_persons_handles_multiple_people_independently():
    persons = [(0, 0, 100, 200), (200, 0, 300, 200)]
    helmets = [(10, 5, 90, 40)]       # solo cae en la primera persona
    gloves = [(240, 160, 260, 190)]   # solo cae en la segunda persona
    result = classify_persons(persons, helmets, gloves)
    assert result[0] == {"bbox": (0, 0, 100, 200), "has_helmet": True, "has_glove": False}
    assert result[1] == {"bbox": (200, 0, 300, 200), "has_helmet": False, "has_glove": True}
