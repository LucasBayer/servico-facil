-- ============================================================
-- MIGRACAO 002 -- Etapa 2: Ordens de Servico, Oportunidades,
-- Atendimentos e Avaliacoes
-- Aplique com: psql -U postgres -d conecta_servicos -f migration_002.sql
-- Esta migracao eh IDEMPOTENTE (pode ser executada multiplas vezes).
-- ============================================================

-- 1. Criar tabela de ordens de servico unificada
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

-- Indice para busca rapida de oportunidades abertas
CREATE INDEX IF NOT EXISTS idx_ordens_oportunidades ON ordens_servico (status, tipo, cidade, categoria)
WHERE status = 'aberta' AND tipo = 'aberta';

-- 2. Tabela de historico de eventos da ordem
CREATE TABLE IF NOT EXISTS ordem_historico_eventos (
    id SERIAL PRIMARY KEY,
    ordem_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    status_anterior VARCHAR(30),
    status_novo VARCHAR(30) NOT NULL,
    descricao TEXT,
    criado_em TIMESTAMP DEFAULT NOW()
);

-- 3. Atualizar tabela de avaliacoes para se vincular a ordens_servico com unicidade
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'avaliacoes' AND column_name = 'ordem_id'
    ) THEN
        ALTER TABLE avaliacoes ADD COLUMN ordem_id INTEGER UNIQUE REFERENCES ordens_servico(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 4. Migracao e preservacao de dados legados da tabela historico (se ainda nao migrados)
DO $$
DECLARE
    reg RECORD;
    v_categoria VARCHAR(100);
    v_cidade VARCHAR(100);
    v_status_novo VARCHAR(30);
BEGIN
    FOR reg IN SELECT * FROM historico LOOP
        -- Verifica se ja existe ordem com o mesmo id ou vinculo
        IF NOT EXISTS (SELECT 1 FROM ordens_servico WHERE id = reg.id) THEN
            -- Busca cidade e profissao do prestador legado
            SELECT COALESCE(cidade, 'Camaquã'), COALESCE(profissao, 'Serviços Gerais')
            INTO v_cidade, v_categoria
            FROM prestadores WHERE id = reg.prestador_id;

            -- Mapeia status legado de forma estrita
            IF reg.status = 'andamento' THEN
                v_status_novo := 'em_andamento';
            ELSIF reg.status IN ('concluido', 'avaliado') THEN
                v_status_novo := 'concluida';
            ELSE
                v_status_novo := 'concluida';
            END IF;

            -- Insere como ordem DIRECIONADA com responsavel ja atribuido (NUNCA como oportunidade publica)
            INSERT INTO ordens_servico (
                id, cliente_id, tipo, titulo, descricao, categoria, cidade, bairro,
                prestador_destinatario_id, prestador_responsavel_id, status, criado_em, atualizado_em
            ) VALUES (
                reg.id,
                reg.usuario_id,
                'direcionada',
                COALESCE(reg.servico, 'Serviço Solicitado'),
                'Registro histórico legado migrado da solicitação #' || reg.id,
                COALESCE(v_categoria, 'Geral'),
                COALESCE(v_cidade, 'Camaquã'),
                'Centro',
                reg.prestador_id,
                reg.prestador_id,
                v_status_novo,
                reg.data_solicitacao,
                reg.data_solicitacao
            );

            -- Registra evento inicial no historico de eventos
            INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao, criado_em)
            VALUES (reg.id, reg.usuario_id, NULL, v_status_novo, 'Migração de histórico legado preservado', reg.data_solicitacao);
        END IF;
    END LOOP;

    -- Ajusta sequence da tabela ordens_servico para nao colidir com os ids legados
    PERFORM setval('ordens_servico_id_seq', COALESCE((SELECT MAX(id) FROM ordens_servico), 1));
END $$;
