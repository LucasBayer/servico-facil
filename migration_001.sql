-- ============================================================
-- MIGRACAO 001 -- Etapa 1: Autenticacao, Perfis e Anuncios
-- Aplique com: psql -U postgres -d conecta_servicos -f migration_001.sql
-- Esta migracao eh IDEMPOTENTE (pode ser executada multiplas vezes).
-- ============================================================

-- 1. Tabela de sessoes (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- 2. Adicionar admin como tipo valido e coluna ativo em usuarios
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check
  CHECK (tipo IN ('cliente', 'prestador', 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'ativo'
  ) THEN
    ALTER TABLE usuarios ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 3. Adicionar colunas de exclusao logica em prestadores
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prestadores' AND column_name = 'ativo'
  ) THEN
    ALTER TABLE prestadores ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prestadores' AND column_name = 'visivel'
  ) THEN
    ALTER TABLE prestadores ADD COLUMN visivel BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 4. Criar tabela de anuncios
CREATE TABLE IF NOT EXISTS anuncios (
  id SERIAL PRIMARY KEY,
  prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE,
  titulo VARCHAR(200) NOT NULL,
  descricao TEXT NOT NULL,
  categoria VARCHAR(100) NOT NULL,
  regiao VARCHAR(100) NOT NULL,
  preco NUMERIC(10,2),
  foto_url TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  visivel BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- 5. Tabela de log administrativo (base para etapa 3)
CREATE TABLE IF NOT EXISTS log_admin (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES usuarios(id),
  acao VARCHAR(100) NOT NULL,
  entidade VARCHAR(50) NOT NULL,
  entidade_id INTEGER NOT NULL,
  motivo TEXT,
  dados_anteriores JSONB,
  criado_em TIMESTAMP DEFAULT NOW()
);