# DOCUMENTO DE ACOMPANHAMENTO E GOVERNANÇA DO PROJETO — SERVIÇOFÁCIL
**Projeto de Extensão Universitária — IFSUL**
**Data de Atualização:** 04/11/2026

---

## 1. Arquitetura Identificada
- **Backend:** Node.js com Express 4.
- **Banco de Dados:** PostgreSQL (pool via driver nativo `pg`).
- **Autenticação:** Sessão persistente no servidor (`express-session` com store `connect-pg-simple` em tabela `"session"` no PostgreSQL). Cookies seguros HTTP-Only (`connect.sid`).
- **Controle de Acesso (RBAC):** Middlewares no servidor `requireAuth` (com checagem de conta ativa a cada requisição) e `requireRole` (cliente, prestador, admin).
- **Frontend:** Single-page style com páginas estáticas servidas pelo Express (`public/index.html`, `busca.html`, `perfil.html`, `historico.html`, `login.html`, `cadastro.html`), CSS puro com tokens globais (`global.css`, `perfil.css`, etc.) e JavaScript cliente único (`public/js/main.js`).

---

## 2. Modelos, Tabelas e Rotas Envolvidos

### Tabelas no Banco de Dados
1. `usuarios`:
   - `id SERIAL PRIMARY KEY`
   - `nome VARCHAR(150) NOT NULL`
   - `email VARCHAR(150) UNIQUE NOT NULL`
   - `senha_hash TEXT NOT NULL`
   - `telefone VARCHAR(30)`
   - `cidade VARCHAR(100)`
   - `tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('cliente', 'prestador', 'admin'))`
   - `ativo BOOLEAN NOT NULL DEFAULT TRUE` *(Adicionado na Migração 001 — Exclusão lógica)*
   - `criado_em TIMESTAMP DEFAULT NOW()`

2. `session`:
   - Armazenamento de sessões express gerenciadas por `connect-pg-simple`.

3. `prestadores`:
   - Perfil profissional do prestador.
   - `id SERIAL PRIMARY KEY`
   - `usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE`
   - `nome VARCHAR(150) NOT NULL`
   - `profissao VARCHAR(100) NOT NULL` *(Especialidades do profissional)*
   - `cidade VARCHAR(100) NOT NULL`
   - `preco NUMERIC(10,2) NOT NULL`
   - `contato VARCHAR(30) NOT NULL`
   - `descricao TEXT`
   - `foto_url TEXT`
   - `requisicoes INTEGER DEFAULT 0`
   - `ativo BOOLEAN NOT NULL DEFAULT TRUE` *(Adicionado na Migração 001)*
   - `visivel BOOLEAN NOT NULL DEFAULT TRUE` *(Adicionado na Migração 001)*
   - `criado_em TIMESTAMP DEFAULT NOW()`

4. `anuncios`:
   - Ofertas de serviços criadas por prestadores.
   - `id SERIAL PRIMARY KEY`
   - `prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE`
   - `titulo VARCHAR(200) NOT NULL`
   - `descricao TEXT NOT NULL`
   - `categoria VARCHAR(100) NOT NULL`
   - `regiao VARCHAR(100) NOT NULL`
   - `preco NUMERIC(10,2)`
   - `foto_url TEXT`
   - `ativo BOOLEAN NOT NULL DEFAULT TRUE` *(Exclusão lógica)*
   - `visivel BOOLEAN NOT NULL DEFAULT TRUE` *(Ocultação pelo prestador ou admin)*
   - `criado_em TIMESTAMP DEFAULT NOW()`
   - `atualizado_em TIMESTAMP DEFAULT NOW()`

5. `log_admin`:
   - Trilhas de auditoria para ações administrativas (desativação, restauração, ocultação).
   - `id SERIAL PRIMARY KEY`
   - `admin_id INTEGER NOT NULL REFERENCES usuarios(id)`
   - `acao VARCHAR(100) NOT NULL`
   - `entidade VARCHAR(50) NOT NULL`
   - `entidade_id INTEGER NOT NULL`
   - `motivo TEXT`
   - `dados_anteriores JSONB`
   - `criado_em TIMESTAMP DEFAULT NOW()`

6. `historico` & `avaliacoes`:
   - Preservados para a transição para a Etapa 2.

### Rotas da API (Implementadas e Protegidas)
- **Autenticação:**
  - `POST /api/auth/register` — Cadastro público (rejeita `tipo: 'admin'`; inicia sessão)
  - `POST /api/auth/login` — Autenticação com sessão (bloqueia contas com `ativo = FALSE`)
  - `POST /api/auth/logout` — Destruição da sessão no servidor e limpeza de cookie
  - `GET /api/auth/me` — Validação contínua do estado da sessão autenticada
- **Perfil do Usuário:**
  - `GET /api/perfil` — Retorna dados da conta e perfil profissional vinculado
  - `PUT /api/perfil` — Atualiza dados pessoais (bloqueia estritamente alteração de `tipo` para `admin`)
- **Anúncios de Serviços:**
  - `GET /api/anuncios` — Listagem pública (filtra: anúncio ativo/visível + prestador ativo/visível + usuário ativo)
  - `GET /api/anuncios/meus` — Anúncios do prestador autenticado (incluindo seus anúncios ocultos)
  - `GET /api/anuncios/:id` — Detalhes do anúncio com validação de visibilidade
  - `POST /api/anuncios` — Cadastro exclusivo por prestador autenticado (responsável determinado pela sessão)
  - `PUT /api/anuncios/:id` — Edição exclusiva pelo prestador proprietário
  - `PUT /api/anuncios/:id/visibilidade` — Ocultar/Reexibir anúncio (proprietário ou admin)
  - `DELETE /api/anuncios/:id` — Exclusão lógica (`ativo = FALSE`, dados preservados)
  - `GET /api/categorias-anuncios` — Lista de categorias com ofertas ativas
- **Prestadores (Compatibilidade e Perfis Públicos):**
  - `GET /api/prestadores` — Busca com filtros e ratings
  - `GET /api/prestadores/:id` — Perfil público com histórico concluído, avaliações e anúncios vinculados
  - `POST /api/prestadores` — Cadastro restrito a prestadores logados
  - `PUT /api/prestadores/:id` — Edição restrita ao próprio prestador
- **Administração (Base da Etapa 1 para Etapa 3):**
  - `PUT /api/admin/usuarios/:id/status` — Desativação/Reativação lógica com registro de motivo em `log_admin`
  - `PUT /api/admin/prestadores/:id/visibilidade` — Ocultação/Exibição com auditoria em `log_admin`

---

## 3. Regras Consolidadas da Etapa 1
1. **Perfis de Acesso:** Três perfis (`cliente`, `prestador`, `admin`). O cadastro público nunca permite criar conta administrativa.
2. **Sessão Real no Servidor:** Sessões armazenadas via `connect-pg-simple`. A identidade do usuário e suas permissões são checadas em tempo de execução no servidor, impedindo manipulação de IDs via payload ou query.
3. **Contas Desativadas:** Bloqueio imediato no login e em qualquer rota protegida a cada requisição, inclusive invalidando sessões que já estavam abertas.
4. **Perfil e Anúncios:**
   - Prestador gerencia seu próprio perfil profissional.
   - Suporte a múltiplas especialidades e anúncios em categorias distintas.
   - Formulário de anúncio preenche dados de identificação a partir da sessão como somente leitura.
   - Prestador só pode editar seus próprios anúncios.
5. **Exclusão Lógica e Governança:**
   - Remoção de anúncio marca `ativo = FALSE`, preservando histórico, relacionamentos e avaliações.
   - Prestador pode ocultar (`visivel = FALSE`) anúncios sem apagá-los. Anúncios ocultos saem imediatamente das buscas públicas.
   - Anúncios de prestadores ou contas desativadas são omitidos das consultas públicas.

---

## 4. Decisões de Implementação
- **Sessão com PostgreSQL:** Escolhido `express-session` com `connect-pg-simple` por manter coerência com o banco já existente, persistência transparente e invalidação imediata em caso de inativação de conta.
- **Compatibilidade Retroativa:** Manteve-se suporte às consultas de `prestadores` enquanto se introduziu a tabela formal `anuncios`. O modal público agora exibe tanto a biografia quanto as ofertas ativas e o histórico concluído do profissional.
- **Cabeçalho:** A saudação `Olá, [Nome]` e o botão `Sair` foram agrupados no container `.auth-user-group` com alinhamento vertical e horizontal centralizado, adaptando-se em telas mobile sem sobreposição.

---

## 5. Alterações Realizadas e Arquivos Modificados
- `Main/package.json`: Adicionadas dependências `express-session` e `connect-pg-simple`, e script `"test": "node testes_etapa1.js"`.
- `Main/.env`: Adicionado `SESSION_SECRET`.
- `Main/migration_001.sql`: Script idempotente com tabela `session`, suporte a `admin`, campos `ativo` e `visivel`, tabela `anuncios` e `log_admin`.
- `Main/server.js`: Reescrito com sessão completa, middlewares RBAC, proteção de rotas, endpoints de anúncios e soft delete.
- `Main/public/js/main.js`: Adaptado para autenticação por cookies de sessão (`credentials: 'same-origin'`), sincronização com `/api/auth/me`, área de anúncios e visibilidade no painel do prestador.
- `Main/public/perfil.html`: Reestruturado com seções dedicadas: "Meu Perfil Profissional", "Publicar Novo Anúncio de Serviço" (com dados somente-leitura herdados) e "Meus Anúncios Publicados" (com badges e ações de ocultação/edição).
- `Main/public/css/global.css`: Estilização do grupo de saudação `.auth-user-group`, badges de status e responsividade.
- `Main/public/css/perfil.css`: Layout moderno em grid para a Área do Prestador e cards de anúncios.
- `Main/testes_etapa1.js`: Bateria automatizada cobrindo os 10 cenários de testes solicitados.

---

## 6. Situação das Migrações
- **Migração 001 (`Main/migration_001.sql`):**
  - **Status:** Criada e **efetivamente aplicada** com sucesso no banco de dados PostgreSQL local de desenvolvimento `conecta_servicos`.
  - Todas as tabelas (`session`, `anuncios`, `log_admin`) e colunas (`usuarios.ativo`, `prestadores.ativo`, `prestadores.visivel`) estão ativas e validadas.

---

## 7. Testes Executados e Resultados
Executados via `npm test` (`Main/testes_etapa1.js`):
- Total de testes: **24 asserções executadas**
- **Resultado: 24 PASSARAM / 0 FALHARAM (100% de sucesso)**
  1. Cadastro público com `tipo: 'admin'` rejeitado com HTTP 403.
  2. Tentativa de elevação de privilégio via `PUT /api/perfil` rejeitada com HTTP 403.
  3. Cliente tentando criar anúncios ou perfis bloqueado com HTTP 403.
  4. Prestador cadastrando anúncio tem responsabilidade determinada pela sessão do servidor (impersonação ignorada).
  5. Prestador tentando editar anúncio ou perfil de terceiro bloqueado com HTTP 403.
  6. Prestador cadastrando com sucesso anúncios em múltiplas especialidades (Elétrica e Mecânica).
  7. Anúncio marcado como oculto sai das buscas públicas e permanece visível apenas no painel do próprio prestador.
  8. Prestador desativado tem todos os seus anúncios removidos imediatamente das buscas públicas.
  9. Conta desativada é bloqueada imediatamente para novas ações protegidas (mesmo com sessão aberta) e para novos logins.
  10. Exclusão de anúncio comprovadamente lógica (registro mantido no banco com `ativo = FALSE`).

---

## 8. Mapeamento e Preparação para a Etapa 2 (Ordens de Serviço e Avaliações)

### Análise dos Dados Existentes
- Na tabela `historico` original:
  - Campos: `id`, `usuario_id`, `prestador_id`, `servico`, `status` (`andamento`, `concluido`, `avaliado`), `data_solicitacao`.
  - Limitações identificadas:
    1. Não permite ordem aberta (pois `prestador_id` é obrigatório no modelo antigo).
    2. Não diferencia destinatário (prestador que recebeu proposta direcionada) de responsável (prestador que aceitou).
    3. Não registra localização do atendimento nem período desejado para execução.
    4. Não há concorrência protegida para múltiplos prestadores disputando a mesma ordem.

### Mudanças Estruturais Mapeadas para a Etapa 2
Para implementar as ordens de serviço e avaliações completas na Etapa 2, será necessário:
1. **Nova Tabela ou Evolução de `ordens_servico`:**
   - `cliente_id` (FK usuarios — obrigatório)
   - `prestador_destinatario_id` (FK prestadores — opcional, usado em ordens direcionadas via anúncio)
   - `prestador_responsavel_id` (FK prestadores — NULL enquanto Aberta; preenchido atomicamente no Aceite)
   - `anuncio_origem_id` (FK anuncios — opcional; NULL em ordens abertas diretas)
   - `titulo`, `descricao`, `categoria`, `localizacao` (cidade/bairro), `periodo_desejado` (opcional)
   - `status`: `aberta` (ou `aguardando_resposta`), `aceita`, `em_andamento`, `concluida`, `cancelada`
   - Controle transacional com `SELECT FOR UPDATE` ou `UPDATE ... WHERE status = 'aberta' RETURNING id` para impedir aceites simultâneos por dois prestadores.
2. **Preservação de Registros Antigos:**
   - Os registros existentes na tabela `historico` devem ser mantidos como histórico legado e não convertidos em oportunidades públicas abertas sem consentimento explícito.
3. **Avaliações:**
   - Vinculadas à ordem concluída, permitidas exclusivamente ao cliente solicitante, nota 1 a 5 e comentário opcional.
