# DOCUMENTO DE ACOMPANHAMENTO E GOVERNANÇA DO PROJETO — SERVIÇOFÁCIL
**Projeto de Extensão Universitária — IFSUL**
**Data de Atualização:** 06/11/2026
**Status Atual:** ETAPA 3 IMPLEMENTADA E VALIDADA LOCALMENTE — limites e configurações na seção 9

---

## 1. Arquitetura Geral do Sistema
- **Backend:** Node.js com Express 4.
- **Banco de Dados:** PostgreSQL (pool via driver nativo `pg`).
- **Autenticação:** Sessão persistente no servidor (`express-session` com store `connect-pg-simple` em tabela `"session"` no PostgreSQL). Cookies seguros HTTP-Only (`connect.sid`).
- **Controle de Acesso (RBAC):** Middlewares no servidor `requireAuth` (com checagem de conta ativa a cada requisição) e `requireRole` (cliente, prestador, admin).
- **Frontend:** Single-page style com páginas servidas pelo Express (`public/index.html`, `busca.html`, `perfil.html`, `historico.html`, `login.html`, `cadastro.html`), CSS puro com tokens de design (`global.css`, `perfil.css`, `historico.css`) e JavaScript modularizado (`public/js/main.js`).

---

## 2. Modelos e Tabelas no Banco de Dados

### Tabelas Consolidadas
1. `usuarios`:
   - `id SERIAL PRIMARY KEY`
   - `nome VARCHAR(150) NOT NULL`
   - `email VARCHAR(150) UNIQUE NOT NULL`
   - `senha_hash TEXT NOT NULL`
   - `telefone VARCHAR(30)`
   - `cidade VARCHAR(100)`
   - `tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('cliente', 'prestador', 'admin'))`
   - `ativo BOOLEAN NOT NULL DEFAULT TRUE` *(Exclusão lógica e suspensão)*
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
   - `ativo BOOLEAN NOT NULL DEFAULT TRUE`
   - `visivel BOOLEAN NOT NULL DEFAULT TRUE`
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

5. `ordens_servico` *(Adicionada na Migração 002 — Etapa 2)*:
   - Registro unificado de necessidades dos clientes.
   - `id SERIAL PRIMARY KEY`
   - `cliente_id INTEGER NOT NULL REFERENCES usuarios(id)`
   - `tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('aberta', 'direcionada'))`
   - `titulo VARCHAR(200) NOT NULL`
   - `descricao TEXT NOT NULL`
   - `categoria VARCHAR(100) NOT NULL`
   - `cidade VARCHAR(100) NOT NULL`
   - `bairro VARCHAR(100) NOT NULL`
   - `periodo_desejado VARCHAR(100)`
   - `anuncio_origem_id INTEGER REFERENCES anuncios(id) ON DELETE SET NULL`
   - `anuncio_titulo_snapshot VARCHAR(200)` *(Preserva cópia histórica do anúncio no momento do pedido)*
   - `anuncio_preco_snapshot NUMERIC(10,2)`
   - `prestador_destinatario_id INTEGER REFERENCES prestadores(id)` *(Preenchido apenas em ordens direcionadas)*
   - `prestador_responsavel_id INTEGER REFERENCES prestadores(id)` *(Definido atomicamente no Aceite)*
   - `status VARCHAR(30) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'aguardando_resposta', 'aceita', 'em_andamento', 'concluida', 'cancelada', 'recusada'))`
   - `motivo_recusa TEXT`
   - `motivo_cancelamento TEXT`
   - `cancelado_por_usuario_id INTEGER REFERENCES usuarios(id)`
   - `criado_em TIMESTAMP DEFAULT NOW()`
   - `atualizado_em TIMESTAMP DEFAULT NOW()`

6. `ordem_historico_eventos` *(Adicionada na Migração 002 — Etapa 2)*:
   - Auditoria completa e linha do tempo de alterações de estado de cada ordem.
   - `id SERIAL PRIMARY KEY`
   - `ordem_id INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE`
   - `usuario_id INTEGER REFERENCES usuarios(id)`
   - `status_anterior VARCHAR(30)`
   - `status_novo VARCHAR(30) NOT NULL`
   - `descricao TEXT NOT NULL`
   - `criado_em TIMESTAMP DEFAULT NOW()`

7. `avaliacoes` *(Evoluída na Migração 002 — Etapa 2)*:
   - `id SERIAL PRIMARY KEY`
   - `ordem_id INTEGER UNIQUE REFERENCES ordens_servico(id) ON DELETE CASCADE` *(Garante estritamente 1 avaliação por ordem)*
   - `prestador_id INTEGER NOT NULL REFERENCES prestadores(id) ON DELETE CASCADE`
   - `usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE`
   - `nota INTEGER NOT NULL CHECK (nota >= 1 AND nota <= 5)`
   - `comentario TEXT`
   - `criado_em TIMESTAMP DEFAULT NOW()`

8. `log_admin`:
   - Auditoria de ações administrativas (desativação, cancelamento forçado, alteração de visibilidade).
   - `id SERIAL PRIMARY KEY`, `admin_id`, `acao`, `entidade`, `entidade_id`, `motivo`, `dados_anteriores`, `criado_em`.

9. `historico` *(Tabela legada)*:
   - Preservada intacta no banco de dados. Os 2 registros originais foram migrados para `ordens_servico` como ordens `tipo = 'direcionada'` preservando os IDs 1 e 2, mantendo status original e sem vazar para o mural público de oportunidades.

---

## 3. Matriz de Estados e Transições de Ordens de Serviço (Etapa 2)

| Estado Atual | Ação | Ator Permitido | Próximo Estado | Regras e Bloqueios |
| :--- | :--- | :--- | :--- | :--- |
| *(Novo)* | Publicar Ordem Aberta | Cliente ativo | `aberta` | Sem anúncio e sem prestador vinculado. Visível no mural de oportunidades. |
| *(Novo)* | Solicitar via Anúncio | Cliente ativo | `aguardando_resposta` | Direcionada ao prestador dono do anúncio. Snapshot de título e preço gravados. |
| `aberta` | Aceitar Oportunidade | Prestador ativo | `aceita` | Aceite atômico com `SELECT FOR UPDATE`. Ordem sai imediatamente das oportunidades. |
| `aberta` | Editar Escopo | Cliente criador | `aberta` | Permitido somente antes do aceite. |
| `aberta` | Cancelar Ordem | Cliente criador | `cancelada` | Não gera penalidade. |
| `aguardando_resposta` | Aceitar Pedido | Prestador destinatário | `aceita` | Revalida se anúncio de origem ainda está ativo e visível. Outro prestador é bloqueado (403). |
| `aguardando_resposta` | Recusar Pedido | Prestador destinatário | `recusada` | Registra justificativa. **Não publica** ordem aberta automaticamente. Cliente pode criar nova ordem separada. |
| `aguardando_resposta` | Cancelar Pedido | Cliente criador | `cancelada` | Cliente desiste do pedido direcionado. |
| `aceita` | Iniciar Atendimento | Prestador responsável | `em_andamento` | Apenas o prestador que aceitou pode executar. Cliente e terceiros bloqueados (403). |
| `aceita` / `em_andamento` | Cancelar Ordem | Somente Admin | `cancelada` | Cliente e prestador não cancelam diretamente; exige motivo obrigatório registrado em `log_admin`. |
| `em_andamento` | Concluir Atendimento | Prestador responsável | `concluida` | Incrementa requisições concluídas do prestador. **Não altera** o anúncio de origem. |
| `concluida` | Avaliar Atendimento | Cliente criador | *(Mantém concluída)* | Nota 1 a 5, comentário opcional. Exclusiva do cliente. Constraint `UNIQUE(ordem_id)` impede duplicidade. |

---

## 4. Rotas da API da Etapa 2

### Ordens de Serviço
- `POST /api/ordens` — Cria ordem aberta ou direcionada (validação de tipos, snapshot de anúncio e verificação de perfil).
- `GET /api/ordens/oportunidades` — Mural de oportunidades para prestadores ativos (filtros por categoria, cidade e busca textual). **Privacidade garantida:** omite telefone, e-mail e endereço completo do cliente.
- `GET /api/ordens/minhas` — Histórico de solicitações e ordens do cliente autenticado (com indicador de recusa e botão para publicar como ordem aberta).
- `GET /api/ordens/recebidas` — Pedidos direcionados pendentes de resposta recebidos pelo prestador destinatário.
- `GET /api/ordens/atendimentos` — Ordens aceitas, em andamento e concluídas sob responsabilidade do prestador autenticado.
- `GET /api/ordens/:id` — Detalhes completos da ordem (acessível apenas pelas partes envolvidas: cliente, destinatário, responsável ou admin). Exibe dados de contato do cliente após o aceite.
- `PUT /api/ordens/:id` — Edição de escopo pelo cliente (bloqueada imediatamente caso a ordem já tenha sido aceita).
- `PUT /api/ordens/:id/aceitar` — Aceite atômico concorrente com trava transacional (`SELECT FOR UPDATE`).
- `PUT /api/ordens/:id/recusar` — Recusa motivada por prestador destinatário.
- `PUT /api/ordens/:id/iniciar` — Transição para `em_andamento` (restrita ao responsável).
- `PUT /api/ordens/:id/concluir` — Transição para `concluida` (restrita ao responsável).
- `PUT /api/ordens/:id/cancelar` — Cancelamento pelo cliente (apenas antes do aceite) ou administrativo (pós-aceite, com motivo).

### Avaliações
- `POST /api/avaliacoes` — Avaliação com nota de 1 a 5 e comentário opcional. Valida:
  - Cliente criador da ordem.
  - Ordem com status `concluida`.
  - Impedimento de autoavaliação por prestador.
  - Bloqueio físico de duplicidade (`UNIQUE(ordem_id)`).
  - Suporte completo a ordens concluídas que não possuem anúncio de origem.

---

## 5. Interface do Usuário Implementada

### Área do Cliente (`public/historico.html`)
- **Filtros por Status:** Todas, Abertas / Aguardando, Em Andamento, Concluídas, Recusadas / Canceladas.
- **Botão e Modal de Nova Ordem Aberta:** Formulário com título, categoria, descrição, cidade, bairro e período desejado.
- **Tratamento de Pedidos Recusados:** Alerta destacado em vermelho informando o motivo da recusa apresentado pelo prestador, com botão direto para "Publicar como Ordem Aberta" (preservando o pedido recusado intacto no histórico).
- **Modal de Avaliação com Estrelas:** Modal interativo de 1 a 5 estrelas acionado diretamente ao clicar em "Avaliar Serviço" nos cards concluídos.
- **Edição e Cancelamento de Escopo:** Botões contextuais ativos apenas enquanto a ordem está aberta.

### Painel do Prestador (`public/perfil.html`)
- **Navegação Modular por Abas:**
  1. *Mural de Oportunidades:* Grid de cards de ordens abertas com filtros de categoria e cidade. Cada card exibe apenas dados seguros (primeiro nome do cliente, bairro, cidade, categoria, período e descrição da necessidade). Botão de aceite com feedback instantâneo.
  2. *Pedidos Direcionados:* Exibição de solicitações recebidas diretamente a partir dos anúncios do prestador. Botões de "Aceitar Atendimento" e "Recusar Pedido" (com modal obrigatório de justificativa).
  3. *Meus Atendimentos:* Acompanhamento dos serviços em execução com dados completos de contato do cliente (liberados após o aceite), e botões sequenciais de "Iniciar Atendimento" e "Concluir Atendimento".
  4. *Meus Anúncios & Perfil:* Gestão de ofertas, visibilidade e edição profissional mantidos da Etapa 1.

---

## 6. Situação das Migrações de Banco de Dados

1. **Migração 001 (`Main/migration_001.sql`):**
   - **Status:** Aplicada com sucesso.
   - Tabelas `session`, `anuncios`, `log_admin` e colunas `ativo`/`visivel` em `usuarios` e `prestadores`.

2. **Migração 002 (`Main/migration_002.sql`):**
   - **Status:** Aplicada com sucesso no PostgreSQL local (`conecta_servicos`).
   - Criou as tabelas `ordens_servico` e `ordem_historico_eventos` com chaves estrangeiras, índices e constraints de integridade.
   - Adicionou `ordem_id UNIQUE` em `avaliacoes`.
   - Migrou dados legados de `historico` preservando IDs 1 e 2 com `tipo = 'direcionada'`, status corretos e sincronizou as sequences do PostgreSQL (`setval`).

---

## 7. Testes Automatizados Executados e Resultados

Comando de execução: `npm test` (`node testes_etapa1.js && node testes_etapa2.js`).
- **Total Geral: 75 asserções automatizadas executadas — 100% de aprovação (0 falhas).**

### Bateria Etapa 1 (`testes_etapa1.js`): 24 PASSARAM / 0 FALHARAM
1. Cadastro direto como admin bloqueado (403).
2. Elevação de privilégio de cliente bloqueada (403).
3. Cliente criando anúncio/perfil bloqueado (403).
4. Vínculo de anúncio à sessão do prestador sem impersonação (201).
5. Prestador tentando editar anúncio de terceiro bloqueado (403).
6. Prestador com anúncios em múltiplas especialidades permitido (201).
7. Anúncio oculto omitido das buscas públicas.
8. Prestador desativado tem anúncios removidos imediatamente das buscas públicas.
9. Conta desativada bloqueada no login e em ações com sessão aberta (403).
10. Exclusão de anúncio comprovadamente lógica (`ativo = FALSE` mantido no banco).

### Bateria Etapa 2 (`testes_etapa2.js`): 51 PASSARAM / 0 FALHARAM
1. Ordem aberta criada sem anúncio e sem prestador (`prestador_responsavel_id = NULL`).
2. Apenas clientes ativos criam ordens (prestadores e anônimos bloqueados).
3. Apenas prestadores ativos aceitam ordens (clientes e anônimos bloqueados).
4. **Concorrência atômica:** dois prestadores tentando aceitar no mesmo instante com `Promise.all` -> exatamente um obtém 200, outro obtém 409, e banco registra exatamente um responsável.
5. Ordem aceita sai imediatamente do mural de oportunidades.
6. Ignorar oportunidade não altera status (`aberta`) nem remove para outros profissionais.
7. Prestador diferente do destinatário bloqueado de aceitar ordem direcionada (403).
8. Ordem direcionada não aparece em oportunidades abertas e aparece na caixa de recebidas do destinatário.
9. Ordem de cliente desativado bloqueada para novos aceites (400).
10. Anúncio original ocultado bloqueia aceite de pedido direcionado pendente (400).
11. Recusa de ordem direcionada não publica ordem aberta automaticamente.
12. Publicação de nova ordem aberta após recusa preserva a ordem anterior no banco e gera novo registro com novo ID.
13. Consulta de oportunidades públicas não expõe telefone, e-mail ou endereço completo.
14. Transições ilegais bloqueadas (`aberta` -> `concluida` ou `recusada` -> `aceita`).
15. Escopo da ordem bloqueado de edição pelo cliente após o aceite (403).
16. Apenas prestador responsável pode marcar início (`em_andamento`) e conclusão (`concluida`).
17. Ordem não concluída não permite envio de avaliação (400).
18. Notas fora do intervalo 1..5 rejeitadas (400).
19. Tentativa de avaliar duas vezes a mesma ordem impedida com 409 e protegida por `UNIQUE(ordem_id)`.
20. Ordem sem anúncio de origem avaliada com sucesso após concluída.
21. Conclusão da ordem não altera visibilidade nem disponibilidade do anúncio no banco.
22. Migração preserva integralmente solicitações, anúncios e avaliações legadas.

---

## 8. Planejamento e Pendências para a Etapa 3 (Finalização Administrativa e Visual)
- Painel Administrativo unificado com listagem completa de usuários, prestadores, anúncios e ordens.
- Ações administrativas: desativação/reativação com motivo em log, ocultação forçada e cancelamento de ordens em andamento com justificativa.
- Painel de métricas e relatórios de moderação.
- Polimento visual final de componentes (modais, acessibilidade, responsividade mobile).

---

## 9. Relatório final da etapa 3 — 06/11/2026

Implementação na pasta **Documents/ServicoFacil/Main**. O acompanhamento fornecido em **ingles/CopiaServicoFacil** serviu de referência às etapas anteriores. O código entregue está na pasta de trabalho.

- **Etapa 1:** autenticação por sessão, separação de papéis, perfis e anúncios com exclusão lógica.
- **Etapa 2:** ordens abertas e direcionadas na mesma tabela, aceite concorrente, recusa, início, conclusão, cancelamento e avaliação única por atendimento.
- **Etapa 3:** página administrativa protegida e API que consultam contas, perfis, anúncios, ordens, pendências e auditoria. Toda alteração administrativa exige justificativa. A gravação da alteração e a auditoria ocorrem na mesma transação. Ajustes de escopo usam uma lista de campos permitidos e preservam valores anteriores e posteriores.
- **Visibilidade:** conta, perfil, decisão do prestador e bloqueio administrativo do anúncio têm efeitos independentes. Restaurar um deles não altera os outros. Um bloqueio retira ofertas da busca, do detalhe e de novos pedidos. O aceite direcionado revalida a disponibilidade. As ordens existentes, seus estados e suas avaliações são preservados.
- **Interface:** a aba Prestadores reúne perfis públicos, especialidades, anúncios, avaliações e atendimentos concluídos. O resumo público de cada atendimento só contém cidade e data. O cliente pode solicitar pelo anúncio, consultar e filtrar suas ordens. O painel do prestador separa oportunidades, pedidos, atendimentos e anúncios. Os botões agora funcionam com a política de segurança que bloqueia JavaScript inline. A navegação depende do papel autenticado.
- **Cabeçalho e rodapé:** saudação e saída centralizadas, encerramento de sessão no servidor e contato institucional lido de CONTATO_ADMIN_EMAIL. Sem configuração válida, o rodapé informa a indisponibilidade.

### Arquivos desta entrega

Backend e banco: server.js, migration_003.sql. Interface: admin.html, public/index.html, public/busca.html, public/historico.html, public/perfil.html, public/login.html, public/cadastro.html, public/js/main.js, public/js/admin.js, public/css/global.css e public/css/admin.css. Validação e operação: testes_etapa1.js (importação relativa), testes_etapa3.js, package.json, README.md e este acompanhamento.

### Migrações e configuração

Em banco novo, aplique schema.sql, migration_001.sql, migration_002.sql e migration_003.sql nessa ordem. O acompanhamento anterior registra 001 e 002 como aplicadas no desenvolvimento local. As tabelas de ordens e auditoria foram confirmadas nesta etapa. A migração 003, aditiva, foi aplicada no **conecta_servicos local** e suas duas colunas foram conferidas. As três migrações também foram executadas em um banco separado de QA. Nenhuma operação em produção.

Preencha CONTATO_ADMIN_EMAIL no Main/.env com o endereço institucional real e reinicie a aplicação. O endereço utilizado pelo teste só existe no ambiente de QA. Para acessar /admin.html, é necessária uma conta administrativa já provisionada por responsável autorizado.

### Evidências e limites

- Regressão HTTP com PostgreSQL de teste: 24 asserções da etapa 1 e 51 da etapa 2 passaram. Os dois registros legados usados pela regressão foram preparados no banco de teste antes da migração 002.
- Etapa 3: 53 respostas HTTP verificadas, além de comparações de estado, auditoria e campos públicos. Cobertura funcional inclui restrição de papéis, bloqueio de sessão existente, restauração sob bloqueios combinados, pendência durante suspensão, cancelamento justificado, ajustes com antes/depois, preservação de avaliação e logout.
- Chrome local: em viewport de 360 px, saudação e saída ficaram lado a lado, com diferença vertical de 0 px entre os centros e sem transbordamento horizontal. O contato configurado apareceu. Em 1280 px, o fluxo de perfil público → anúncio → envio de pedido → histórico → logout passou. O prestador aceitou uma oportunidade, iniciou e concluiu a ordem pelos botões do painel. No painel administrativo, uma ação com motivo apareceu no histórico.
- Validação de sintaxe JavaScript e revisão da diferença de arquivos. O projeto não define build, compilação de tipos ou lint. Percentual de cobertura de linhas não medido.
- Limites: as verificações visuais cobriram os fluxos descritos, mas nem todas as combinações de estados, navegadores e tamanhos de tela. Sem validação de dispositivo físico, implantação ou ambiente de produção. O endereço real de contato deve ser fornecido pela administração.

### Roteiro manual complementar

1. Como cliente, abra Prestadores, escolha um anúncio e envie um pedido. Confira o destinatário em Minhas ordens. Publique também uma necessidade aberta.
2. Como prestador, filtre o mural e aceite a necessidade. Abra Pedidos direcionados, aceite ou recuse o outro pedido e confira Meus atendimentos. Inicie e conclua o serviço. Volte como cliente para avaliar uma vez.
3. Como administrador, oculte um anúncio já oculto pelo dono, restaure-o e confira a busca pública. Desative a conta do prestador com uma ordem pendente, consulte a pendência e restaure a conta. Ajuste o escopo ou cancele uma ordem aceita, informe o motivo e confira a auditoria.

## Atualização posterior — SQL consolidado

A instalação nova passa a usar somente Main/schema.sql, que reúne a estrutura das etapas 1 a 3 sem inserir dados de exemplo. Os arquivos anteriores estão preservados em Main/migrations/legacy/ (schema original e migrações 001, 002 e 003). As instruções anteriores de instalação sequencial nesta documentação são registros históricos. O banco local já atualizado dispensa reinstalação. Mudanças futuras continuam por novas migrações.
