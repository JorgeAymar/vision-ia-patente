import os
import psycopg2
import psycopg2.extras


def get_connection():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def get_pending_job(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select aj.id as job_id, v.path as video_path "
            "from analysis_jobs aj join videos v on v.id = aj.video_id "
            "where aj.status = 'pending' order by aj.created_at asc limit 1"
        )
        return cur.fetchone()


def mark_job_processing(conn, job_id):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'processing', started_at = now() where id = %s",
            (job_id,),
        )
    conn.commit()


def mark_job_completed(conn, job_id, annotated_path=None):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'completed', finished_at = now() where id = %s",
            (job_id,),
        )
        if annotated_path:
            cur.execute(
                "update videos set annotated_path = %s "
                "where id = (select video_id from analysis_jobs where id = %s)",
                (annotated_path, job_id),
            )
    conn.commit()


def mark_job_failed(conn, job_id, error_message):
    with conn.cursor() as cur:
        cur.execute(
            "update analysis_jobs set status = 'failed', finished_at = now(), error_message = %s "
            "where id = %s",
            (error_message, job_id),
        )
    conn.commit()


def insert_frame_person(conn, job_id, frame_number, time_s, bbox, has_helmet, has_glove):
    x1, y1, x2, y2 = bbox
    with conn.cursor() as cur:
        cur.execute(
            "insert into frame_detections "
            "(job_id, frame_number, time_s, bbox_x1, bbox_y1, bbox_x2, bbox_y2, has_helmet, has_glove) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (job_id, frame_number, time_s, x1, y1, x2, y2, has_helmet, has_glove),
        )
    conn.commit()
