ALTER TABLE materials
    ADD COLUMN display_name text,
    ADD CONSTRAINT materials_display_name_length CHECK (
        display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 200
    );
