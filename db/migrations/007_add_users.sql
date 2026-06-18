-- 007_add_users.sql
-- Comptes multi-utilisateurs (SP2) : table users + appartenance des keywords.
-- Usage : psql -v chat_id="'<valeur de TELEGRAM_CHAT_ID>'" -f 007_add_users.sql vinbot
-- Si -v chat_id n'est pas fourni, le user par défaut est créé avec un chat_id vide.

\if :{?chat_id}
\else
  \set chat_id ''''''
\endif

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  telegram_chat_id  VARCHAR(50) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO users (name, telegram_chat_id)
SELECT 'Principal', :chat_id
WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = 'Principal');

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

UPDATE keywords SET user_id = (SELECT id FROM users WHERE name = 'Principal' LIMIT 1)
WHERE user_id IS NULL;

ALTER TABLE keywords ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON keywords(user_id);
