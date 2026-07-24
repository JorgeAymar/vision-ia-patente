import os
import sys
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from model import get_model, CLASSES


def test_model_loads_and_predicts_without_error():
    model = get_model()
    frame = (np.random.rand(480, 640, 3) * 255).astype("uint8")
    results = model.predict(frame, conf=0.1, verbose=False)[0]
    assert set(results.names.values()) == set(CLASSES)
