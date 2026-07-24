import os
import sys
import uuid
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("DATABASE_URL", "postgresql://vision:vision@localhost:5441/vision_ia_security")

import db


@pytest.fixture
def conn():
    connection = db.get_connection()
    yield connection
    connection.close()


@pytest.fixture
def sample_video_and_job(conn):
    video_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            "insert into videos (id, filename, path) values (%s, %s, %s)",
            (video_id, "test.mp4", "/tmp/test.mp4"),
        )
        cur.execute(
            "insert into analysis_jobs (video_id, status) values (%s, 'pending') returning id",
            (video_id,),
        )
        job_id = cur.fetchone()[0]
    conn.commit()
    yield str(job_id)
    with conn.cursor() as cur:
        cur.execute("delete from videos where id = %s", (video_id,))  # cascada borra job + detections
    conn.commit()


def test_get_pending_job_returns_the_pending_job(conn, sample_video_and_job):
    job_id = sample_video_and_job
    result = db.get_pending_job(conn)
    assert str(result["job_id"]) == job_id


def test_mark_job_processing_updates_status(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_processing(conn, job_id)
    with conn.cursor() as cur:
        cur.execute("select status, started_at from analysis_jobs where id = %s", (job_id,))
        status, started_at = cur.fetchone()
    assert status == "processing"
    assert started_at is not None


def test_mark_job_completed_updates_status(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_completed(conn, job_id)
    with conn.cursor() as cur:
        cur.execute("select status, finished_at from analysis_jobs where id = %s", (job_id,))
        status, finished_at = cur.fetchone()
    assert status == "completed"
    assert finished_at is not None


def test_mark_job_failed_stores_error_message(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.mark_job_failed(conn, job_id, "boom")
    with conn.cursor() as cur:
        cur.execute("select status, error_message from analysis_jobs where id = %s", (job_id,))
        status, error_message = cur.fetchone()
    assert status == "failed"
    assert error_message == "boom"


def test_insert_frame_person_stores_bbox_and_flags(conn, sample_video_and_job):
    job_id = sample_video_and_job
    db.insert_frame_person(
        conn, job_id, frame_number=15, time_s=0.5,
        bbox=(1.0, 2.0, 3.0, 4.0), has_helmet=True, has_glove=False,
    )
    with conn.cursor() as cur:
        cur.execute(
            "select bbox_x1, bbox_y2, has_helmet, has_glove from frame_detections where job_id = %s",
            (job_id,),
        )
        bbox_x1, bbox_y2, has_helmet, has_glove = cur.fetchone()
    assert bbox_x1 == pytest.approx(1.0)
    assert bbox_y2 == pytest.approx(4.0)
    assert has_helmet is True
    assert has_glove is False
