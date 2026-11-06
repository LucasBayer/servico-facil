-- Estrutura consolidada do ServiçoFácil (etapas 1, 2 e 3).
-- Instalação nova: psql -v ON_ERROR_STOP=1 -U postgres -d conecta_servicos -f schema.sql
-- Cria somente a estrutura, sem contas ou dados de exemplo.
-- Bancos já atualizados dispensam execução. Este arquivo não atualiza estruturas antigas.
-- Migrações anteriores e schema original estão arquivados em migrations/legacy/.

BEGIN;

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    telefone VARCHAR(30),
    cidade VARCHAR(100),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('cliente', 'prestador', 'admin')),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

CREATE TABLE IF NOT EXISTS prestadores (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    profissao VARCHAR(100) NOT NULL,
    cidade VARCHAR(100) NOT NULL,
    preco NUMERIC(10,2) NOT NULL,
    contato VARCHAR(30) NOT NULL,
    descricao TEXT,
    foto_url TEXT,
    requisicoes INTEGER DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    visivel BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT NOW()
);

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
  oculto_admin BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ordens_servico (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('aberta', 'direcionada')),
    titulo VARCHAR(200) NOT NULL,
    descricao TEXT NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    cidade VARCHAR(100) NOT NULL,
    bairro VARCHAR(100) NOT NULL,
    periodo_desejado VARCHAR(100),
    anuncio_origem_id INTEGER REFERENCES anuncios(id) ON DELETE SET NULL,
    anuncio_titulo_snapshot VARCHAR(200),
    anuncio_preco_snapshot NUMERIC(10,2),
    prestador_destinatario_id INTEGER REFERENCES prestadores(id) ON DELETE SET NULL,
    prestador_responsavel_id INTEGER REFERENCES prestadores(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL CHECK (
        status IN ('aberta', 'aguardando_resposta', 'aceita', 'recusada', 'em_andamento', 'concluida', 'cancelada')
    ),
    motivo_cancelamento TEXT,
    cancelado_por_usuario_id INTEGER REFERENCES usuarios(id),
    motivo_recusa TEXT,
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ordens_oportunidades ON ordens_servico (status, tipo, cidade, categoria) WHERE status = 'aberta' AND tipo = 'aberta';

CREATE TABLE IF NOT EXISTS ordem_historico_eventos (
    id SERIAL PRIMARY KEY,
    ordem_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    status_anterior VARCHAR(30),
    status_novo VARCHAR(30) NOT NULL,
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS avaliacoes (
    id SERIAL PRIMARY KEY,
    prestador_id INTEGER REFERENCES prestadores(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario TEXT,
    ordem_id INTEGER UNIQUE REFERENCES ordens_servico(id) ON DELETE CASCADE,
    criado_em TIMESTAMP DEFAULT NOW()
);

-- Tabela legada preservada por compatibilidade; novos atendimentos usam ordens_servico.
CREATE TABLE IF NOT EXISTS historico (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    prestador_id INTEGER REFERENCES prestadores(id) ON DELETE CASCADE,
    servico VARCHAR(100),
    status VARCHAR(20) DEFAULT 'andamento' CHECK (status IN ('andamento', 'concluido', 'avaliado')),
    data_solicitacao TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS log_admin (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES usuarios(id),
  acao VARCHAR(100) NOT NULL,
  entidade VARCHAR(50) NOT NULL,
  entidade_id INTEGER NOT NULL,
  motivo TEXT,
  dados_anteriores JSONB,
  dados_posteriores JSONB,
  criado_em TIMESTAMP DEFAULT NOW()
);

COMMIT;
