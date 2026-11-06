-- Execute este script uma vez, dentro do banco "conecta_servicos", para criar as tabelas.
-- No VS Code, use a extensão "PostgreSQL" ou "SQLTools" para rodar direto,
-- ou pelo terminal: psql -U postgres -d conecta_servicos -f schema.sql

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    telefone VARCHAR(30),
    cidade VARCHAR(100),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('cliente', 'prestador')),
    criado_em TIMESTAMP DEFAULT NOW()
);

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
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS avaliacoes (
    id SERIAL PRIMARY KEY,
    prestador_id INTEGER REFERENCES prestadores(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario TEXT,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historico (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
    prestador_id INTEGER REFERENCES prestadores(id) ON DELETE CASCADE,
    servico VARCHAR(100),
    status VARCHAR(20) DEFAULT 'andamento' CHECK (status IN ('andamento', 'concluido', 'avaliado')),
    data_solicitacao TIMESTAMP DEFAULT NOW()
);

-- Alguns dados de exemplo (opcional, para não começar com o site vazio)
INSERT INTO usuarios (nome, email, senha_hash, telefone, cidade, tipo)
VALUES ('João Pereira', 'joao@exemplo.com', '$2a$10$abcdefghijklmnopqrstuv', '(51) 90000-0001', 'Tapes', 'prestador')
ON CONFLICT (email) DO NOTHING;
