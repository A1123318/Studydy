ALTER TABLE learners
    ADD COLUMN username text UNIQUE,
    ADD COLUMN password_hash text,
    ADD CONSTRAINT learners_credentials_pair CHECK (
        (username IS NULL AND password_hash IS NULL)
        OR (username IS NOT NULL AND password_hash IS NOT NULL
            AND username ~ '^[a-z0-9_]{3,32}$')
    );
