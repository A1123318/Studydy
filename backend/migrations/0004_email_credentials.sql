-- 舊開發帳號依產品決定退役；保留 learner_id 與教材、學習資料的 owner。
-- 不推導假 Email，也不保留 username 登入或相容欄位。
ALTER TABLE learners DROP CONSTRAINT learners_credentials_pair;
ALTER TABLE learners RENAME COLUMN username TO email;
ALTER TABLE learners RENAME CONSTRAINT learners_username_key TO learners_email_key;

UPDATE learners SET email = NULL, password_hash = NULL
WHERE email IS NOT NULL OR password_hash IS NOT NULL;

UPDATE learner_sessions
SET revoked_at = statement_timestamp(), updated_at = statement_timestamp()
WHERE revoked_at IS NULL;

ALTER TABLE learners ADD CONSTRAINT learners_credentials_pair CHECK (
    (email IS NULL AND password_hash IS NULL)
    OR (email IS NOT NULL AND password_hash IS NOT NULL
        AND char_length(email) BETWEEN 3 AND 254 AND email = lower(email))
);
