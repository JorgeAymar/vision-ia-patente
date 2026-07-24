create table videos (
    id uuid primary key default gen_random_uuid(),
    filename text not null,
    path text not null,
    annotated_path text,
    uploaded_at timestamptz not null default now(),
    duration_s real,
    width int,
    height int,
    fps real
);

create table analysis_jobs (
    id uuid primary key default gen_random_uuid(),
    video_id uuid not null references videos(id) on delete cascade,
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'completed', 'failed')),
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,
    error_message text
);

create table frame_detections (
    id bigserial primary key,
    job_id uuid not null references analysis_jobs(id) on delete cascade,
    frame_number int not null,
    time_s real not null,
    bbox_x1 real not null,
    bbox_y1 real not null,
    bbox_x2 real not null,
    bbox_y2 real not null,
    has_helmet boolean not null,
    has_glove boolean not null
);

create index idx_frame_detections_job_id on frame_detections(job_id);
create index idx_analysis_jobs_status on analysis_jobs(status);
