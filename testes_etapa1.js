// testes_etapa1.js — Bateria de testes automatizados para a Etapa 1
const http = require('http');
const path = require('path');

// Importa a aplicação Express configurada no server.js (sem subir na porta 3000 pública)
// Criaremos um servidor de teste temporário em porta aleatória
const pool = require('./db');
const express = require('express');

// Para testar via HTTP real, vamos carregar o app Express
// Vamos criar um script runner que sobe o server.js em porta de teste
async function runTests() {
  console.log('====================================================');
  console.log('INICIANDO BATERIA DE TESTES — ETAPA 1');
  console.log('====================================================\n');

  // Sobe o servidor em porta dedicada de teste (ex: 3099)
  process.env.PORT = '3099';
  process.env.SESSION_SECRET = 'segredo-de-teste-etapa1';

  // Inicia o servidor
  require('./server.js');

  // Aguarda 1.5s para o pool e servidor estarem prontos
  await new Promise((r) => setTimeout(r, 1500));

  const BASE_URL = 'http://localhost:3099';
  let cookieSessao = '';

  // Helper HTTP com suporte a cookies
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
    // ---------------------------------------------------------------
    console.log('1. Verificando: Cadastro público não concede perfil administrativo');
    const resRegAdmin = await request('POST', '/api/auth/register', {
      nome: 'Tentativa Admin',
      email: `admin_tentativa_${Date.now()}@teste.com`,
      senha: 'senha-segura-123',
      tipo: 'admin',
      cidade: 'Camaquã',
      telefone: '(51) 99999-0001',
    });
    assert(resRegAdmin.status === 403, 'Bloqueio de cadastro direto como admin (HTTP 403 esperado, recebeu ' + resRegAdmin.status + ')');
    assert(resRegAdmin.data.erro && resRegAdmin.data.erro.includes('administrador'), 'Mensagem explícita de erro retornada');

    // ---------------------------------------------------------------
    console.log('\n2. Verificando: Usuário comum não consegue elevar suas permissões');
    const emailCliente = `cliente_teste_${Date.now()}@teste.com`;
    const resRegCliente = await request('POST', '/api/auth/register', {
      nome: 'Cliente Normal',
      email: emailCliente,
      senha: 'senha-segura-123',
      tipo: 'cliente',
      cidade: 'Camaquã',
      telefone: '(51) 99999-0002',
    });
    assert(resRegCliente.status === 201, 'Cliente cadastrado com sucesso');
    const cookieCliente = resRegCliente.cookie;

    // Tentativa de elevação de privilégio via PUT /api/perfil
    const resElevacao = await request('PUT', '/api/perfil', {
      nome: 'Cliente Querendo Ser Admin',
      tipo: 'admin',
    }, cookieCliente);
    assert(resElevacao.status === 403, 'Bloqueio de alteração de tipo de conta (HTTP 403 esperado, recebeu ' + resElevacao.status + ')');

    // Checagem no banco
    const checkUserDb = await pool.query('SELECT tipo FROM usuarios WHERE email = $1', [emailCliente]);
    assert(checkUserDb.rows[0].tipo === 'cliente', 'Tipo no banco de dados permaneceu intacto como cliente');

    // ---------------------------------------------------------------
    console.log('\n3. Verificando: Cliente não cadastra anúncio, inclusive por chamada direta à API');
    const resAdCliente = await request('POST', '/api/anuncios', {
      titulo: 'Tentativa Anúncio por Cliente',
      categoria: 'Elétrica',
      regiao: 'Camaquã',
      descricao: 'Tentando burlar permissões de anúncio',
    }, cookieCliente);
    assert(resAdCliente.status === 403, 'Cliente bloqueado de criar anúncio (HTTP 403 esperado, recebeu ' + resAdCliente.status + ')');

    const resPrestCliente = await request('POST', '/api/prestadores', {
      profissao: 'Eletricista',
      cidade: 'Camaquã',
      contato: '(51) 99999-0002',
    }, cookieCliente);
    assert(resPrestCliente.status === 403, 'Cliente bloqueado de criar perfil em prestadores (HTTP 403 esperado, recebeu ' + resPrestCliente.status + ')');

    // ---------------------------------------------------------------
    console.log('\n4. Verificando: Prestador e vínculo de anúncio com a sessão do servidor (sem impersonação)');
    const emailPrestadorA = `prestador_a_${Date.now()}@teste.com`;
    const resRegPrestA = await request('POST', '/api/auth/register', {
      nome: 'Carlos Eletricista',
      email: emailPrestadorA,
      senha: 'senha-segura-123',
      tipo: 'prestador',
      cidade: 'Camaquã',
      telefone: '(51) 98888-0001',
    });
    assert(resRegPrestA.status === 201, 'Prestador A cadastrado com sucesso');
    const cookiePrestadorA = resRegPrestA.cookie;

    const emailPrestadorB = `prestador_b_${Date.now()}@teste.com`;
    const resRegPrestB = await request('POST', '/api/auth/register', {
      nome: 'Marcos Mecânico',
      email: emailPrestadorB,
      senha: 'senha-segura-123',
      tipo: 'prestador',
      cidade: 'Tapes',
      telefone: '(51) 98888-0002',
    });
    assert(resRegPrestB.status === 201, 'Prestador B cadastrado com sucesso');
    const cookiePrestadorB = resRegPrestB.cookie;

    // Prestador A tenta criar anúncio passando prestador_id de B no corpo
    const prestBInfo = await pool.query('SELECT id FROM prestadores WHERE usuario_id = $1', [resRegPrestB.data.id]);
    const idPrestadorB = prestBInfo.rows[0].id;

    const prestAInfo = await pool.query('SELECT id FROM prestadores WHERE usuario_id = $1', [resRegPrestA.data.id]);
    const idPrestadorA = prestAInfo.rows[0].id;

    const resCriarAdA = await request('POST', '/api/anuncios', {
      prestador_id: idPrestadorB, // Tentativa de impersonação
      titulo: 'Instalação de Tomadas e Quadros',
      categoria: 'Elétrica',
      regiao: 'Camaquã',
      preco: 120,
      descricao: 'Serviço profissional de eletricista com garantia.',
    }, cookiePrestadorA);

    assert(resCriarAdA.status === 201, 'Anúncio criado com sucesso');
    assert(resCriarAdA.data.prestador_id === idPrestadorA, 'Servidor ignorou prestador_id enviado no body e vinculou à sessão do prestador A');
    const adA1Id = resCriarAdA.data.id;

    // ---------------------------------------------------------------
    console.log('\n5. Verificando: Prestador não edita perfil ou anúncio de outro profissional');
    // Prestador B tenta editar anúncio de A
    const resEditAdAlheio = await request('PUT', `/api/anuncios/${adA1Id}`, {
      titulo: 'Tentativa de Hijack por Prestador B',
      categoria: 'Golpe',
      regiao: 'Tapes',
      descricao: 'Modificado indevidamente',
    }, cookiePrestadorB);
    assert(resEditAdAlheio.status === 403, 'Bloqueio de edição de anúncio de outro profissional (HTTP 403 esperado, recebeu ' + resEditAdAlheio.status + ')');

    // Prestador B tenta editar perfil de prestador de A
    const resEditPerfilAlheio = await request('PUT', `/api/prestadores/${idPrestadorA}`, {
      profissao: 'Enganador',
      cidade: 'Tapes',
    }, cookiePrestadorB);
    assert(resEditPerfilAlheio.status === 403, 'Bloqueio de edição de perfil de outro profissional (HTTP 403 esperado, recebeu ' + resEditPerfilAlheio.status + ')');

    // ---------------------------------------------------------------
    console.log('\n6. Verificando: Prestador pode atuar em múltiplas especialidades / categorias');
    const resCriarAdA2 = await request('POST', '/api/anuncios', {
      titulo: 'Conserto de Bombas e Motores',
      categoria: 'Mecânica',
      regiao: 'Camaquã e interior',
      preco: 250,
      descricao: 'Manutenção mecânica e preventiva de motores.',
    }, cookiePrestadorA);
    assert(resCriarAdA2.status === 201, 'Prestador A criou com sucesso segundo anúncio em categoria diferente (Mecânica)');
    const adA2Id = resCriarAdA2.data.id;

    // ---------------------------------------------------------------
    console.log('\n7. Verificando: Anúncio oculto não aparece nas consultas públicas');
    // Prestador A oculta o anúncio 2 (Mecânica)
    const resOcultar = await request('PUT', `/api/anuncios/${adA2Id}/visibilidade`, {
      visivel: false,
    }, cookiePrestadorA);
    assert(resOcultar.status === 200 && resOcultar.data.visivel === false, 'Anúncio 2 marcado como oculto com sucesso');

    // Consulta pública de anúncios
    const resPublicAds = await request('GET', '/api/anuncios');
    const idsPublicos = resPublicAds.data.map((a) => a.id);
    assert(idsPublicos.includes(adA1Id), 'Anúncio 1 (Elétrica - Visível) aparece na consulta pública');
    assert(!idsPublicos.includes(adA2Id), 'Anúncio 2 (Mecânica - Ocultado) NÃO aparece na consulta pública');

    // Consulta própria autenticada
    const resMeusAds = await request('GET', '/api/anuncios/meus', null, cookiePrestadorA);
    const idsMeus = resMeusAds.data.map((a) => a.id);
    assert(idsMeus.includes(adA2Id), 'Anúncio ocultado continua visível para seu próprio dono em /api/anuncios/meus');

    // ---------------------------------------------------------------
    console.log('\n8. Verificando: Anúncio de prestador desativado não fica disponível publicamente');
    // Desativa a conta do prestador A
    await pool.query('UPDATE usuarios SET ativo = FALSE WHERE id = $1', [resRegPrestA.data.id]);

    const resPublicAdsAposDesativar = await request('GET', '/api/anuncios');
    const idsPublicos2 = resPublicAdsAposDesativar.data.map((a) => a.id);
    assert(!idsPublicos2.includes(adA1Id), 'Anúncio de prestador desativado foi removido das buscas públicas imediatamente');

    // ---------------------------------------------------------------
    console.log('\n9. Verificando: Conta desativada não executa ações protegidas (inclusive com sessão existente)');
    const resAcaoComSessaoAberta = await request('POST', '/api/anuncios', {
      titulo: 'Tentando postar com conta inativa',
      categoria: 'Elétrica',
      regiao: 'Camaquã',
      descricao: 'Deveria ser bloqueado',
    }, cookiePrestadorA);
    assert(resAcaoComSessaoAberta.status === 403, 'Ação com sessão aberta bloqueada para conta desativada (HTTP 403 esperado, recebeu ' + resAcaoComSessaoAberta.status + ')');

    // Tentativa de novo login
    const resLoginDesativado = await request('POST', '/api/auth/login', {
      email: emailPrestadorA,
      senha: 'senha-segura-123',
    });
    assert(resLoginDesativado.status === 403, 'Login bloqueado para conta desativada (HTTP 403 esperado, recebeu ' + resLoginDesativado.status + ')');

    // ---------------------------------------------------------------
    console.log('\n10. Verificando: Preservação de registros e soft delete');
    // Reativa prestador A para testar exclusão lógica
    await pool.query('UPDATE usuarios SET ativo = TRUE WHERE id = $1', [resRegPrestA.data.id]);
    const resReLoginA = await request('POST', '/api/auth/login', {
      email: emailPrestadorA,
      senha: 'senha-segura-123',
    });
    const cookieReA = resReLoginA.cookie;

    // Executa remoção lógica de anúncio
    const resDeleteAd = await request('DELETE', `/api/anuncios/${adA1Id}`, null, cookieReA);
    assert(resDeleteAd.status === 200, 'Endpoint DELETE respondeu com sucesso');

    // Confere que no banco o registro NÃO foi apagado fisicamente
    const checkDbAd = await pool.query('SELECT id, ativo, visivel FROM anuncios WHERE id = $1', [adA1Id]);
    assert(checkDbAd.rows.length === 1, 'Registro permanece preservado fisicamente no banco de dados');
    assert(checkDbAd.rows[0].ativo === false, 'Coluna ativo marcada como FALSE (exclusão lógica confirmada)');

    // ---------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`RESULTADO FINAL DOS TESTES: ${totalPassados} PASSARAM | ${totalFalhados} FALHARAM`);
    console.log('====================================================');

    process.exit(totalFalhados === 0 ? 0 : 1);
  } catch (err) {
    console.error('ERRO INESPERADO NA EXECUÇÃO DOS TESTES:', err);
    process.exit(1);
  }
}

runTests();
