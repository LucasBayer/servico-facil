// testes_etapa2.js — Bateria de testes automatizados para a Etapa 2
// Cobre os 22 critérios de aceitação do documento de regras

const http = require('http');
const path = require('path');
const pool = require('./db');

async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO BATERIA DE TESTES — ETAPA 2');
  console.log('ORDENS, OPORTUNIDADES, ATENDIMENTOS E AVALIAÇÕES');
  console.log('====================================================\n');

  // Define porta dedicada para os testes da etapa 2
  process.env.PORT = '3098';
  process.env.SESSION_SECRET = 'segredo-de-teste-etapa2';

  // Inicia servidor
  require('./server.js');

  // Aguarda 1.5s para inicialização
  await new Promise((r) => setTimeout(r, 1500));

  const BASE_URL = 'http://localhost:3098';

  // Helper de requisições HTTP com suporte a Cookies e sessões
  async function request(method, path, body = null, cookie = '') {
    const url = new URL(BASE_URL + path);
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;

    const res = await fetch(url.href, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const setCookie = res.headers.get('set-cookie');
    const newCookie = setCookie ? setCookie.split(';')[0] : cookie;

    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, cookie: newCookie };
  }

  let totalPassados = 0;
  let totalFalhados = 0;

  function assert(condicao, descricao) {
    if (condicao) {
      console.log(`  ✅ PASSOU: ${descricao}`);
      totalPassados++;
    } else {
      console.error(`  ❌ FALHOU: ${descricao}`);
      totalFalhados++;
    }
  }

  try {
    const timestamp = Date.now();

    // 0. Preparação de usuários e perfis para os testes
    // Cliente 1 (ativo)
    const emailC1 = `c1_${timestamp}@teste.com`;
    const resRegC1 = await request('POST', '/api/auth/register', {
      nome: 'Cliente Um Silva',
      email: emailC1,
      senha: 'senha-segura-123',
      tipo: 'cliente',
      cidade: 'Camaquã',
      telefone: '(51) 98888-1111'
    });
    const cookieC1 = resRegC1.cookie;
    const c1Id = resRegC1.data.id;

    // Cliente 2 (será desativado no critério 9)
    const emailC2 = `c2_${timestamp}@teste.com`;
    const resRegC2 = await request('POST', '/api/auth/register', {
      nome: 'Cliente Dois Santos',
      email: emailC2,
      senha: 'senha-segura-123',
      tipo: 'cliente',
      cidade: 'Camaquã',
      telefone: '(51) 98888-2222'
    });
    const cookieC2 = resRegC2.cookie;
    const c2Id = resRegC2.data.id;

    // Prestador 1 (com perfil configurado)
    const emailP1 = `p1_${timestamp}@teste.com`;
    const resRegP1 = await request('POST', '/api/auth/register', {
      nome: 'Prestador Um Eletricista',
      email: emailP1,
      senha: 'senha-segura-123',
      tipo: 'prestador',
      cidade: 'Camaquã',
      telefone: '(51) 97777-1111'
    });
    const cookieP1 = resRegP1.cookie;
    const p1UsuarioId = resRegP1.data.id;

    // Obtém perfil do Prestador 1
    const resPerfilP1 = await request('GET', '/api/perfil', null, cookieP1);
    const p1PrestadorId = resPerfilP1.data.perfilPrestador.id;

    // Atualiza perfil profissional do Prestador 1
    await request('PUT', '/api/perfil', {
      nome: 'Prestador Um Eletricista',
      cidade: 'Camaquã',
      telefone: '(51) 97777-1111',
      profissao: 'Eletricista Residencial e Comercial',
      descricao: 'Profissional com 10 anos de experiência em instalações elétricas.'
    }, cookieP1);

    // Prestador 2 (com perfil configurado)
    const emailP2 = `p2_${timestamp}@teste.com`;
    const resRegP2 = await request('POST', '/api/auth/register', {
      nome: 'Prestador Dois Mecânico',
      email: emailP2,
      senha: 'senha-segura-123',
      tipo: 'prestador',
      cidade: 'Camaquã',
      telefone: '(51) 97777-2222'
    });
    const cookieP2 = resRegP2.cookie;
    const p2UsuarioId = resRegP2.data.id;

    // Obtém perfil do Prestador 2
    const resPerfilP2 = await request('GET', '/api/perfil', null, cookieP2);
    const p2PrestadorId = resPerfilP2.data.perfilPrestador.id;

    // Atualiza perfil profissional do Prestador 2
    await request('PUT', '/api/perfil', {
      nome: 'Prestador Dois Mecânico',
      cidade: 'Camaquã',
      telefone: '(51) 97777-2222',
      profissao: 'Mecânico e Encanador',
      descricao: 'Especialista em manutenção preventiva e encanamento predial.'
    }, cookieP2);

    // ------------------------------------------------------------------------
    console.log('1. Verificando: Ordem aberta pode existir sem anúncio e sem prestador vinculado');
    const resC1 = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Troca de fiação do chuveiro',
      descricao: 'Preciso trocar a fiação antiga de 4mm por 6mm no banheiro principal.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro',
      periodo_desejado: 'Tarde'
    }, cookieC1);

    assert(resC1.status === 201, 'Ordem aberta criada com sucesso (HTTP 201)');
    assert(resC1.data.status === 'aberta', 'Status inicial é "aberta"');
    assert(resC1.data.tipo === 'aberta', 'Tipo registrado é "aberta"');
    assert(resC1.data.prestador_destinatario_id === null, 'prestador_destinatario_id é nulo');
    assert(resC1.data.prestador_responsavel_id === null, 'prestador_responsavel_id é nulo antes do aceite');
    assert(resC1.data.anuncio_origem_id === null, 'anuncio_origem_id é nulo');
    const ordemAbertaId = resC1.data.id;

    // ------------------------------------------------------------------------
    console.log('\n2. Verificando: Somente clientes autenticados e ativos criam ordens');
    const resCriarSemAuth = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Tentativa sem login',
      descricao: 'Descricao teste',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    });
    assert(resCriarSemAuth.status === 401, 'Requisição sem autenticação bloqueada (HTTP 401)');

    const resCriarPorPrestador = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Tentativa por prestador',
      descricao: 'Descricao teste',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieP1);
    assert(resCriarPorPrestador.status === 403, 'Tentativa de criar ordem por prestador bloqueada (HTTP 403)');

    // ------------------------------------------------------------------------
    console.log('\n3. Verificando: Somente prestadores autenticados e ativos aceitam ordens');
    const resAceitarSemAuth = await request('PUT', `/api/ordens/${ordemAbertaId}/aceitar`);
    assert(resAceitarSemAuth.status === 401, 'Aceite sem login bloqueado (HTTP 401)');

    const resAceitarPorCliente = await request('PUT', `/api/ordens/${ordemAbertaId}/aceitar`, null, cookieC1);
    assert(resAceitarPorCliente.status === 403, 'Aceite de ordem por cliente bloqueado (HTTP 403)');

    // ------------------------------------------------------------------------
    console.log('\n4. Verificando: Tentativa concorrente de aceite de ordem aberta resulta em exatamente um responsável');
    // Cria uma ordem aberta específica para o teste de concorrência
    const resOrdemConc = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Ordem para teste de concorrência atômica',
      descricao: 'Dois prestadores tentarão aceitar no mesmo milissegundo.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Olaria'
    }, cookieC1);
    const ordemConcId = resOrdemConc.data.id;

    // Dispara dois aceites concorrentes simultâneos
    const [tentativaP1, tentativaP2] = await Promise.all([
      request('PUT', `/api/ordens/${ordemConcId}/aceitar`, null, cookieP1),
      request('PUT', `/api/ordens/${ordemConcId}/aceitar`, null, cookieP2)
    ]);

    const umAceitou = (tentativaP1.status === 200 && (tentativaP2.status === 409 || tentativaP2.status === 400)) ||
                     (tentativaP2.status === 200 && (tentativaP1.status === 409 || tentativaP1.status === 400));
    assert(umAceitou, 'Exatamente uma das requisições concorrentes obteve sucesso (200) e a outra foi rejeitada (409/400)');

    // Confere no banco que há exatamente um responsável
    const checkDbConc = await pool.query('SELECT status, prestador_responsavel_id FROM ordens_servico WHERE id = $1', [ordemConcId]);
    assert(checkDbConc.rows[0].status === 'aceita', 'Status no banco atualizado para "aceita"');
    assert(checkDbConc.rows[0].prestador_responsavel_id !== null, 'Exatamente um prestador responsável gravado no banco');

    // ------------------------------------------------------------------------
    console.log('\n5. Verificando: Ordem aceita deixa de aparecer como oportunidade disponível');
    const resOportunidades = await request('GET', '/api/ordens/oportunidades', null, cookieP2);
    assert(resOportunidades.status === 200, 'Mural de oportunidades acessado com sucesso pelo prestador');
    const estaNaLista = resOportunidades.data.some(op => op.id === ordemConcId);
    assert(!estaNaLista, 'Ordem aceita não aparece na lista de oportunidades disponíveis');

    // ------------------------------------------------------------------------
    console.log('\n6. Verificando: Ignorar oportunidade não altera status nem remove para outros prestadores');
    const resOrdemIgnorada = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Ordem para teste de ignorar',
      descricao: 'Esta ordem será visualizada mas nenhum prestador responderá.',
      categoria: 'Mecânica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieC1);
    const ordemIgnoradaId = resOrdemIgnorada.data.id;

    // Prestador 1 visualiza mural
    await request('GET', '/api/ordens/oportunidades', null, cookieP1);
    // Confere se status mudou no banco
    const checkDbIgnorada = await pool.query('SELECT status FROM ordens_servico WHERE id = $1', [ordemIgnoradaId]);
    assert(checkDbIgnorada.rows[0].status === 'aberta', 'Status permaneceu intacto como "aberta"');

    // Prestador 2 visualiza e ainda vê a oportunidade
    const resOpP2 = await request('GET', '/api/ordens/oportunidades', null, cookieP2);
    const p2AindaVe = resOpP2.data.some(op => op.id === ordemIgnoradaId);
    assert(p2AindaVe, 'Outro prestador continua visualizando a oportunidade normalmente');

    // ------------------------------------------------------------------------
    console.log('\n7. Verificando: Prestador diferente do destinatário não pode aceitar ordem direcionada');
    // Prestador 1 cria anúncio
    const resAdP1 = await request('POST', '/api/anuncios', {
      titulo: 'Instalação de Tomadas e Disjuntores',
      descricao: 'Serviço profissional de instalação elétrica rápida e segura.',
      categoria: 'Elétrica',
      cidade: 'Camaquã'
    }, cookieP1);
    const adP1Id = resAdP1.data.id;

    // Cliente 1 faz pedido direcionado a partir do anúncio do Prestador 1
    const resOrdemDir = await request('POST', '/api/ordens', {
      tipo: 'direcionada',
      anuncio_id: adP1Id,
      prestador_destinatario_id: p1PrestadorId,
      titulo: 'Instalação de 4 tomadas 20A',
      descricao: 'Gostaria de agendar conforme seu anúncio de tomadas.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Viégas'
    }, cookieC1);
    const ordemDirId = resOrdemDir.data.id;

    // Prestador 2 (que NÃO é o destinatário) tenta aceitar
    const resAceiteP2Indevido = await request('PUT', `/api/ordens/${ordemDirId}/aceitar`, null, cookieP2);
    assert(resAceiteP2Indevido.status === 403, 'Aceite por prestador diferente do destinatário bloqueado (HTTP 403 esperado, recebeu ' + resAceiteP2Indevido.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n8. Verificando: Ordem direcionada não aparece na listagem pública de oportunidades');
    const resOpPublica = await request('GET', '/api/ordens/oportunidades', null, cookieP2);
    const ordemDirNaPublica = resOpPublica.data.some(op => op.id === ordemDirId);
    assert(!ordemDirNaPublica, 'Ordem direcionada NÃO aparece no mural de oportunidades abertas');

    // Confere se aparece na caixa de entrada recebida do Prestador 1
    const resRecebidasP1 = await request('GET', '/api/ordens/recebidas', null, cookieP1);
    const ordemDirEmRecebidas = resRecebidasP1.data.some(op => op.id === ordemDirId);
    assert(ordemDirEmRecebidas, 'Ordem direcionada aparece corretamente nos pedidos recebidos do destinatário');

    // ------------------------------------------------------------------------
    console.log('\n9. Verificando: Ordem de cliente desativado não pode receber novo aceite');
    // Cliente 2 cria ordem aberta
    const resOrdemC2 = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Instalação em casa do cliente 2',
      descricao: 'Descricao da instalacao do cliente 2',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieC2);
    const ordemC2Id = resOrdemC2.data.id;

    // Desativa conta do cliente 2
    await pool.query('UPDATE usuarios SET ativo = FALSE WHERE id = $1', [c2Id]);

    // Prestador 1 tenta aceitar a ordem do cliente desativado
    const resAceiteCliDesativado = await request('PUT', `/api/ordens/${ordemC2Id}/aceitar`, null, cookieP1);
    assert(resAceiteCliDesativado.status === 400 || resAceiteCliDesativado.status === 403, 'Aceite de ordem de cliente desativado bloqueado (HTTP 400/403 esperado, recebeu ' + resAceiteCliDesativado.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n10. Verificando: Anúncio oculto bloqueia novo aceite de pedido direcionado pendente');
    // Prestador 1 cria anúncio para este teste
    const resAdOculto = await request('POST', '/api/anuncios', {
      titulo: 'Anúncio que será ocultado',
      descricao: 'Teste de consistência de anúncio oculto.',
      categoria: 'Elétrica',
      cidade: 'Camaquã'
    }, cookieP1);
    const adOcultoId = resAdOculto.data.id;

    // Cliente 1 faz pedido direcionado
    const resOrdemAdOculto = await request('POST', '/api/ordens', {
      tipo: 'direcionada',
      anuncio_id: adOcultoId,
      prestador_destinatario_id: p1PrestadorId,
      titulo: 'Pedido direcionado teste anúncio oculto',
      descricao: 'Pedido enviado antes de ocultar o anúncio.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieC1);
    const ordemAdOcultoId = resOrdemAdOculto.data.id;

    // Prestador 1 oculta seu anúncio
    await request('PUT', `/api/anuncios/${adOcultoId}/visibilidade`, { visivel: false }, cookieP1);

    // Prestador 1 tenta aceitar a ordem direcionada com anúncio oculto
    const resAceiteAdOculto = await request('PUT', `/api/ordens/${ordemAdOcultoId}/aceitar`, null, cookieP1);
    assert(resAceiteAdOculto.status === 400 || resAceiteAdOculto.status === 403, 'Aceite bloqueado por anúncio de origem estar oculto (HTTP 400/403 esperado, recebeu ' + resAceiteAdOculto.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n11. Verificando: Recusa de ordem direcionada não publica ordem aberta automaticamente');
    // Cria pedido direcionado para recusa
    const resOrdemParaRecusa = await request('POST', '/api/ordens', {
      tipo: 'direcionada',
      anuncio_id: adP1Id,
      prestador_destinatario_id: p1PrestadorId,
      titulo: 'Pedido que será recusado',
      descricao: 'Preciso do serviço para amanhã bem cedo.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Banhado'
    }, cookieC1);
    const ordemRecusaId = resOrdemParaRecusa.data.id;

    // Prestador 1 recusa o pedido
    const resRecusa = await request('PUT', `/api/ordens/${ordemRecusaId}/recusar`, {
      motivo: 'Infelizmente estou com a agenda lotada para este dia.'
    }, cookieP1);
    assert(resRecusa.status === 200, 'Pedido recusado com sucesso pelo destinatário');
    assert(resRecusa.data.status === 'recusada', 'Status atualizado para "recusada"');
    assert(resRecusa.data.motivo_recusa.includes('agenda lotada'), 'Motivo da recusa registrado com sucesso');

    // Confere se NÃO foi para oportunidades abertas
    const resOpAposRecusa = await request('GET', '/api/ordens/oportunidades', null, cookieP2);
    const recusaFoiPublicada = resOpAposRecusa.data.some(op => op.id === ordemRecusaId);
    assert(!recusaFoiPublicada, 'Ordem recusada NÃO foi publicada no mural de oportunidades abertas');

    // ------------------------------------------------------------------------
    console.log('\n12. Verificando: Publicação de nova ordem aberta após recusa preserva a ordem anterior e cria novo registro');
    // Cliente publica nova ordem aberta a partir da necessidade não atendida
    const resNovaAposRecusa = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Pedido que será recusado (Aberto ao público)',
      descricao: 'Preciso do serviço para amanhã bem cedo. Aberto a outros profissionais.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Banhado'
    }, cookieC1);
    const novaOrdemId = resNovaAposRecusa.data.id;

    assert(novaOrdemId !== ordemRecusaId, 'Novo registro criado com ID distinto');
    const checkDbAnterior = await pool.query('SELECT status, motivo_recusa FROM ordens_servico WHERE id = $1', [ordemRecusaId]);
    assert(checkDbAnterior.rows[0].status === 'recusada', 'Ordem anterior permanece preservada com status "recusada"');

    // ------------------------------------------------------------------------
    console.log('\n13. Verificando: Dados de contato do cliente não são expostos na consulta pública de oportunidades');
    const resOportunidadesPrivacidade = await request('GET', '/api/ordens/oportunidades', null, cookieP1);
    let dadosVazados = false;
    for (const op of resOportunidadesPrivacidade.data) {
      if (op.telefone || op.cliente_telefone || op.email || op.cliente_email || op.endereco_completo) {
        dadosVazados = true;
        break;
      }
    }
    assert(!dadosVazados, 'Nenhum registro no mural de oportunidades expõe telefone, e-mail ou endereço completo');

    // ------------------------------------------------------------------------
    console.log('\n14. Verificando: Transições de status fora do fluxo permitido são rejeitadas pelo servidor');
    // Tenta concluir ordem que está aberta diretamente
    const resPuloInvalidoConcluir = await request('PUT', `/api/ordens/${novaOrdemId}/concluir`, null, cookieP1);
    assert(resPuloInvalidoConcluir.status === 400 || resPuloInvalidoConcluir.status === 403, 'Transição direta aberta -> concluída rejeitada');

    // Tenta iniciar ordem que está aberta diretamente
    const resPuloInvalidoIniciar = await request('PUT', `/api/ordens/${novaOrdemId}/iniciar`, null, cookieP1);
    assert(resPuloInvalidoIniciar.status === 400 || resPuloInvalidoIniciar.status === 403, 'Transição direta aberta -> em_andamento rejeitada');

    // Tenta aceitar ordem recusada
    const resAceiteRecusada = await request('PUT', `/api/ordens/${ordemRecusaId}/aceitar`, null, cookieP1);
    assert(resAceiteRecusada.status === 400, 'Tentativa de aceitar ordem já recusada rejeitada');

    // ------------------------------------------------------------------------
    console.log('\n15. Verificando: Escopo da necessidade não pode ser alterado pelo cliente após o aceite');
    // Prestador 1 aceita a nova ordem aberta
    await request('PUT', `/api/ordens/${novaOrdemId}/aceitar`, null, cookieP1);

    // Cliente 1 tenta editar o escopo
    const resEdicaoAposAceite = await request('PUT', `/api/ordens/${novaOrdemId}`, {
      titulo: 'Tentativa de alterar o título após aceite',
      descricao: 'Alterando escopo indevidamente'
    }, cookieC1);
    assert(resEdicaoAposAceite.status === 403 || resEdicaoAposAceite.status === 400, 'Alteração de escopo pelo cliente após o aceite bloqueada (HTTP 403/400 esperado, recebeu ' + resEdicaoAposAceite.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n16. Verificando: Somente o prestador responsável pode marcar início e conclusão');
    // Prestador 2 (não responsável) tenta iniciar
    const resIniciarNaoResp = await request('PUT', `/api/ordens/${novaOrdemId}/iniciar`, null, cookieP2);
    assert(resIniciarNaoResp.status === 403, 'Prestador não responsável bloqueado de iniciar (HTTP 403)');

    // Prestador 1 (responsável) inicia
    const resIniciarResp = await request('PUT', `/api/ordens/${novaOrdemId}/iniciar`, null, cookieP1);
    assert(resIniciarResp.status === 200, 'Prestador responsável iniciou o atendimento com sucesso');
    assert(resIniciarResp.data.status === 'em_andamento', 'Status atualizado para "em_andamento"');

    // Prestador 2 tenta concluir
    const resConcluirNaoResp = await request('PUT', `/api/ordens/${novaOrdemId}/concluir`, null, cookieP2);
    assert(resConcluirNaoResp.status === 403, 'Prestador não responsável bloqueado de concluir (HTTP 403)');

    // Prestador 1 (responsável) conclui
    const resConcluirResp = await request('PUT', `/api/ordens/${novaOrdemId}/concluir`, null, cookieP1);
    assert(resConcluirResp.status === 200, 'Prestador responsável concluiu o atendimento com sucesso');
    assert(resConcluirResp.data.status === 'concluida', 'Status atualizado para "concluida"');

    // ------------------------------------------------------------------------
    console.log('\n17. Verificando: Ordem não concluída não permite avaliação');
    // Cria ordem e deixa em andamento
    const resOrdemEmAndamento = await request('POST', '/api/ordens', {
      tipo: 'aberta',
      titulo: 'Ordem para teste de avaliação precoce',
      descricao: 'Descricao da ordem precoce',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieC1);
    const ordemEmAndamentoId = resOrdemEmAndamento.data.id;
    await request('PUT', `/api/ordens/${ordemEmAndamentoId}/aceitar`, null, cookieP1);
    await request('PUT', `/api/ordens/${ordemEmAndamentoId}/iniciar`, null, cookieP1);

    // Cliente tenta avaliar antes da conclusão
    const resAvalPrecoce = await request('POST', '/api/avaliacoes', {
      ordem_id: ordemEmAndamentoId,
      nota: 5,
      comentario: 'Tentando avaliar antes de concluir'
    }, cookieC1);
    assert(resAvalPrecoce.status === 400, 'Avaliação de ordem não concluída rejeitada (HTTP 400 esperado, recebeu ' + resAvalPrecoce.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n18. Verificando: Nota fora do intervalo permitido (1 a 5) é rejeitada');
    const resNotaZero = await request('POST', '/api/avaliacoes', {
      ordem_id: novaOrdemId,
      nota: 0,
      comentario: 'Nota zero'
    }, cookieC1);
    assert(resNotaZero.status === 400, 'Nota 0 rejeitada pelo servidor');

    const resNotaSeis = await request('POST', '/api/avaliacoes', {
      ordem_id: novaOrdemId,
      nota: 6,
      comentario: 'Nota seis'
    }, cookieC1);
    assert(resNotaSeis.status === 400, 'Nota 6 rejeitada pelo servidor');

    // ------------------------------------------------------------------------
    console.log('\n19. Verificando: Tentativa de avaliar duas vezes a mesma ordem é impedida pelo servidor');
    // Primeira avaliação com sucesso
    const resAval1 = await request('POST', '/api/avaliacoes', {
      ordem_id: novaOrdemId,
      nota: 5,
      comentario: 'Excelente eletricista, resolveu rápido e com qualidade.'
    }, cookieC1);
    assert(resAval1.status === 201, 'Primeira avaliação cadastrada com sucesso (HTTP 201)');

    // Segunda avaliação na mesma ordem
    const resAval2 = await request('POST', '/api/avaliacoes', {
      ordem_id: novaOrdemId,
      nota: 4,
      comentario: 'Tentativa de avaliar novamente a mesma ordem'
    }, cookieC1);
    assert(resAval2.status === 409 || resAval2.status === 400, 'Segunda avaliação na mesma ordem impedida (HTTP 409/400 esperado, recebeu ' + resAval2.status + ')');

    // ------------------------------------------------------------------------
    console.log('\n20. Verificando: Ordem sem anúncio de origem pode ser avaliada normalmente após concluída');
    // A ordem 'novaOrdemId' foi criada como aberta (sem anúncio de origem)
    const checkDbAval = await pool.query('SELECT id, ordem_id, prestador_id, nota FROM avaliacoes WHERE ordem_id = $1', [novaOrdemId]);
    assert(checkDbAval.rows.length === 1, 'Avaliação da ordem sem anúncio registrada com sucesso no banco');
    assert(checkDbAval.rows[0].nota === 5, 'Nota 5 confirmada no registro');

    // ------------------------------------------------------------------------
    console.log('\n21. Verificando: Conclusão da ordem não altera a visibilidade nem a disponibilidade do anúncio');
    // Criamos anúncio A21 e ordem direcionada C21
    const resAd21 = await request('POST', '/api/anuncios', {
      titulo: 'Anúncio de Teste Conclusão',
      descricao: 'Descrição do anúncio que não deve ser alterado pela conclusão de ordens.',
      categoria: 'Elétrica',
      cidade: 'Camaquã'
    }, cookieP1);
    const ad21Id = resAd21.data.id;

    const resC21 = await request('POST', '/api/ordens', {
      tipo: 'direcionada',
      anuncio_id: ad21Id,
      prestador_destinatario_id: p1PrestadorId,
      titulo: 'Atendimento do Anúncio A21',
      descricao: 'Solicitação de teste.',
      categoria: 'Elétrica',
      cidade: 'Camaquã',
      bairro: 'Centro'
    }, cookieC1);
    const c21Id = resC21.data.id;

    // Prestador aceita, inicia e conclui
    await request('PUT', `/api/ordens/${c21Id}/aceitar`, null, cookieP1);
    await request('PUT', `/api/ordens/${c21Id}/iniciar`, null, cookieP1);
    await request('PUT', `/api/ordens/${c21Id}/concluir`, null, cookieP1);

    // Confere estado do anúncio no banco
    const checkAd21 = await pool.query('SELECT ativo, visivel FROM anuncios WHERE id = $1', [ad21Id]);
    assert(checkAd21.rows[0].ativo === true, 'Anúncio permanece ATIVO no banco após conclusão do serviço');
    assert(checkAd21.rows[0].visivel === true, 'Anúncio permanece VISÍVEL no banco após conclusão do serviço');

    // ------------------------------------------------------------------------
    console.log('\n22. Verificando: Migração preserva solicitações, anúncios e avaliações anteriores');
    const checkOrdensMigradas = await pool.query('SELECT id, tipo, status, descricao FROM ordens_servico WHERE id IN (1, 2) ORDER BY id');
    assert(checkOrdensMigradas.rows.length === 2, 'Dois registros históricos migrados existem na tabela ordens_servico');
    assert(checkOrdensMigradas.rows[0].tipo === 'direcionada' && checkOrdensMigradas.rows[1].tipo === 'direcionada', 'Registros antigos preservados como ordens direcionadas (sem vazar para oportunidades)');
    assert(checkOrdensMigradas.rows[0].status === 'em_andamento' && checkOrdensMigradas.rows[1].status === 'concluida', 'Status originais (em_andamento e concluida) mantidos fielmente');

    // ------------------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`RESULTADO FINAL DOS TESTES ETAPA 2: ${totalPassados} PASSARAM | ${totalFalhados} FALHARAM`);
    console.log('====================================================');

    process.exit(totalFalhados === 0 ? 0 : 1);
  } catch (err) {
    console.error('ERRO INESPERADO NA EXECUÇÃO DOS TESTES ETAPA 2:', err);
    process.exit(1);
  }
}

runTests();
