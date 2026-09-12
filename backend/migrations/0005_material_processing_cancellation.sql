ALTER TABLE material_processing_runs ADD COLUMN cancel_requested_at timestamptz;

ALTER TABLE material_processing_runs DROP CONSTRAINT material_processing_runs_status_check;
ALTER TABLE material_processing_runs ADD CONSTRAINT material_processing_runs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled'));

ALTER TABLE material_processing_runs DROP CONSTRAINT material_processing_runs_check;
ALTER TABLE material_processing_runs ADD CONSTRAINT material_processing_runs_check CHECK (
    (status = 'pending' AND output_binding IS NULL AND error_code IS NULL
        AND completed_at IS NULL AND cancel_requested_at IS NULL AND progress_stage = 'queued')
    OR (status = 'running' AND output_binding IS NULL AND error_code IS NULL
        AND completed_at IS NULL AND progress_stage != 'completed'
        AND (cancel_requested_at IS NULL OR progress_stage IN ('queued', 'evidence', 'semantics')))
    OR (status IN ('succeeded', 'partial') AND output_binding IS NOT NULL AND error_code IS NULL
        AND completed_at IS NOT NULL AND cancel_requested_at IS NULL AND progress_stage = 'completed')
    OR (status = 'failed' AND output_binding IS NULL AND error_code IS NOT NULL
        AND completed_at IS NOT NULL AND cancel_requested_at IS NULL AND progress_stage != 'completed')
    OR (status = 'cancelled' AND output_binding IS NULL AND error_code IS NULL
        AND completed_at IS NOT NULL AND cancel_requested_at IS NOT NULL AND progress_stage != 'completed')
);
