import os
import time
import traceback

import cv2

import db
import model as model_module
from detector import classify_persons

POLL_INTERVAL_SECONDS = 5
# Absoluto y basado en la ubicación de este archivo, no en el cwd del proceso que lo lanza
# (evita que la ruta se rompa si algún día se invoca el worker desde otro directorio).
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(PROJECT_ROOT, "storage", "annotated")


def process_job(conn, job):
    job_id = job["job_id"]
    video_path = job["video_path"]

    db.mark_job_processing(conn, job_id)

    os.makedirs(STORAGE_DIR, exist_ok=True)
    annotated_path = os.path.join(STORAGE_DIR, f"{job_id}.mp4")

    sampled = model_module.detect_sampled_frames(video_path)

    writer = None
    for entry in sampled:
        frame = entry["frame"]
        people = classify_persons(entry["persons"], entry["helmets"], entry["gloves"])

        if writer is None:
            h, w = frame.shape[:2]
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(annotated_path, fourcc, 2, (w, h))

        for person in people:
            x1, y1, x2, y2 = map(int, person["bbox"])
            color = (0, 200, 0) if person["has_helmet"] else (0, 0, 255)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            db.insert_frame_person(
                conn, job_id,
                frame_number=entry["frame_number"],
                time_s=entry["time_s"],
                bbox=person["bbox"],
                has_helmet=person["has_helmet"],
                has_glove=person["has_glove"],
            )

        writer.write(frame)

    if writer is not None:
        writer.release()

    db.mark_job_completed(conn, job_id, annotated_path=annotated_path)
    print(f"[worker] job {job_id} completado ({len(sampled)} frames analizados)")


def main():
    conn = db.get_connection()
    print("[worker] esperando jobs...")
    while True:
        job = db.get_pending_job(conn)
        if job is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        try:
            process_job(conn, job)
        except Exception as exc:
            traceback.print_exc()
            db.mark_job_failed(conn, job["job_id"], str(exc))


if __name__ == "__main__":
    main()
