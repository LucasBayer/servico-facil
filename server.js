// server.js — API Express que liga o front-end ao PostgreSQL
const path = require('path');
const pool = require('./db'); // carrega o .env e valida as variáveis antes de tudo
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   CONSTANTES E HELPERS
========================================================= */
const CIDADES = ['Camaquã', 'Sentinela do Sul', 'Tapes', 'Sertão Santana'];
const TIPOS = ['cliente', 'prestador'];
const STATUS_EDITAVEIS = ['andamento', 'concluido']; // "avaliado" só é definido ao avaliar
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ORDENACAO = new Map([
  ['preco-asc', 'p.preco ASC'],
  ['preco-desc', 'p.preco DESC'],
  ['avaliacao', 'rating DESC, avaliacoes DESC'],
]);
const ORDENACAO_PADRAO = 'p.requisicoes DESC';

class HttpError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// Express 4 não captura erros de handlers async sozinho: este wrapper encaminha ao tratador global.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const texto = (valor, max) => (typeof valor === 'string' ? valor.trim().slice(0, max) : '');

const inteiroPositivo = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function urlHttpValida(valor) {
  if (!valor) return null;
  try {
    const u = new URL(valor);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}

async function comTransacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignora */ }
    throw err;
  } finally {
    client.release();
  }
}

/* =========================================================
   MIDDLEWARES
========================================================= */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'https:', 'http:'], // fotos dos prestadores vêm de URLs externas
        'upgrade-insecure-requests': null, // permite acessar por http://IP-local na rede Wi-Fi
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limita tentativas de login/cadastro (proteção básica contra força bruta)
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.use('/api/auth', limiteAuth);

/* =========================================================
   AUTENTICAÇÃO (simplificada, sem token/sessão — protótipo)
========================================================= */
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const nome = texto(req.body.nome, 150);
  const email = texto(req.body.email, 150).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const telefone = texto(req.body.telefone, 30);
  const cidade = texto(req.body.cidade, 100);
  const tipo = req.body.tipo;

  if (!nome || !email || !senha || !tipo) throw new HttpError(400, 'Campos obrigatórios faltando.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail inválido.');
  if (senha.length < 6 || senha.length > 72) throw new HttpError(400, 'A senha deve ter de 6 a 72 caracteres.');
  if (!TIPOS.includes(tipo)) throw new HttpError(400, 'Tipo de conta inválido.');
  if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');

  const senhaHash = await bcrypt.hash(senha, 10);
  try {
    const result = await pool.query(
      `INSERT INTO usuarios (nome, email, senha_hash, telefone, cidade, tipo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nome, email, telefone, cidade, tipo`,
      [nome, email, senhaHash, telefone, cidade || null, tipo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'E-mail já cadastrado.');
    throw err;
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = texto(req.body.email, 150).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  if (!email || !senha) throw new HttpError(400, 'Informe e-mail e senha.');

  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const usuario = result.rows[0];
  const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senha_hash) : false;
  if (!senhaOk) throw new HttpError(401, 'E-mail ou senha inválidos.');

  res.json({
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    cidade: usuario.cidade,
    tipo: usuario.tipo,
  });
}));

/* =========================================================
   PRESTADORES / BUSCA COM FILTROS
========================================================= */
app.get('/api/prestadores', asyncHandler(async (req, res) => {
  const busca = texto(req.query.busca, 100);
  const cidade = texto(req.query.cidade, 100);
  const profissao = texto(req.query.profissao, 100);
  const precoMax =
    typeof req.query.precoMax === 'string' && req.query.precoMax !== '' ? Number(req.query.precoMax) : null;
  const ordem = ORDENACAO.get(req.query.ordenar) || ORDENACAO_PADRAO;

  let sql = `
    SELECT p.*,
           COALESCE(AVG(a.nota), 0)::numeric(3,1) AS rating,
           COUNT(a.id)::int AS avaliacoes
    FROM prestadores p
    LEFT JOIN avaliacoes a ON a.prestador_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (busca) {
    params.push(`%${busca.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    sql += ` AND (LOWER(p.nome) LIKE $${params.length} OR LOWER(p.profissao) LIKE $${params.length})`;
  }
  if (cidade) {
    params.push(cidade);
    sql += ` AND p.cidade = $${params.length}`;
  }
  if (profissao) {
    params.push(profissao);
    sql += ` AND p.profissao = $${params.length}`;
  }
  if (precoMax !== null && Number.isFinite(precoMax)) {
    params.push(precoMax);
    sql += ` AND p.preco <= $${params.length}`;
  }

  sql += ` GROUP BY p.id ORDER BY ${ordem}, p.id`; // "ordem" vem de uma lista fixa, nunca direto do cliente

  const result = await pool.query(sql, params);
  res.json(result.rows);
}));

// Definida antes de "/:id" para deixar clara a precedência das rotas.
app.get('/api/prestadores/usuario/:usuarioId', asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.params.usuarioId);
  if (!usuarioId) throw new HttpError(400, 'Usuário inválido.');
  const result = await pool.query(
    'SELECT * FROM prestadores WHERE usuario_id = $1 ORDER BY criado_em DESC',
    [usuarioId]
  );
  res.json(result.rows);
}));

app.get('/api/prestadores/:id', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Prestador inválido.');

  const prestador = await pool.query(
    `SELECT p.*, COALESCE(AVG(a.nota),0)::numeric(3,1) AS rating, COUNT(a.id)::int AS avaliacoes
     FROM prestadores p LEFT JOIN avaliacoes a ON a.prestador_id = p.id
     WHERE p.id = $1 GROUP BY p.id`,
    [id]
  );
  if (!prestador.rows[0]) throw new HttpError(404, 'Prestador não encontrado.');

  const comentarios = await pool.query(
    `SELECT a.nota, a.comentario, a.criado_em, COALESCE(u.nome, 'Usuário removido') AS autor
     FROM avaliacoes a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.prestador_id = $1 ORDER BY a.criado_em DESC`,
    [id]
  );
  res.json({ ...prestador.rows[0], comentarios: comentarios.rows });
}));

app.get('/api/profissoes', asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT DISTINCT profissao FROM prestadores ORDER BY profissao');
  res.json(result.rows.map((r) => r.profissao));
}));

app.post('/api/prestadores', asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.body.usuario_id);
  const nome = texto(req.body.nome, 150);
  const profissao = texto(req.body.profissao, 100);
  const cidade = texto(req.body.cidade, 100);
  const preco = Number(req.body.preco);
  const contato = texto(req.body.contato, 30);
  const descricao = texto(req.body.descricao, 2000);
  const fotoUrl = urlHttpValida(texto(req.body.foto_url, 500));

  if (!usuarioId) throw new HttpError(401, 'Você precisa estar logado para publicar um serviço.');
  if (!nome || !profissao || !cidade || !contato) throw new HttpError(400, 'Campos obrigatórios faltando.');
  if (!CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');
  if (!Number.isFinite(preco) || preco < 0 || preco > 99999999) throw new HttpError(400, 'Preço inválido.');
  const digitos = contato.replace(/\D/g, '').length;
  if (digitos < 10 || digitos > 13) throw new HttpError(400, 'Contato inválido. Informe DDD + número.');

  const result = await pool.query(
    `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, foto_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [usuarioId, nome, profissao, cidade, preco, contato, descricao, fotoUrl]
  );
  res.status(201).json(result.rows[0]);
}));

/* =========================================================
   HISTÓRICO DE SERVIÇOS
========================================================= */
app.get('/api/historico/:usuarioId', asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.params.usuarioId);
  if (!usuarioId) throw new HttpError(400, 'Usuário inválido.');
  const result = await pool.query(
    `SELECT h.*, p.nome AS prestador_nome
     FROM historico h JOIN prestadores p ON p.id = h.prestador_id
     WHERE h.usuario_id = $1 ORDER BY h.data_solicitacao DESC`,
    [usuarioId]
  );
  res.json(result.rows);
}));

app.post('/api/historico', asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.body.usuario_id);
  const prestadorId = inteiroPositivo(req.body.prestador_id);
  const servico = texto(req.body.servico, 100);
  if (!usuarioId || !prestadorId) throw new HttpError(400, 'Usuário ou prestador inválido.');

  // Transação: o contador só aumenta se o registro do histórico também for gravado.
  const registro = await comTransacao(async (client) => {
    const ins = await client.query(
      'INSERT INTO historico (usuario_id, prestador_id, servico) VALUES ($1,$2,$3) RETURNING *',
      [usuarioId, prestadorId, servico]
    );
    await client.query('UPDATE prestadores SET requisicoes = requisicoes + 1 WHERE id = $1', [prestadorId]);
    return ins.rows[0];
  });
  res.status(201).json(registro);
}));

app.put('/api/historico/:id/status', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  const usuarioId = inteiroPositivo(req.body.usuario_id);
  const status = req.body.status;
  if (!id || !usuarioId) throw new HttpError(400, 'Dados inválidos.');
  if (!STATUS_EDITAVEIS.includes(status)) throw new HttpError(400, 'Status inválido.');

  const result = await pool.query(
    `UPDATE historico SET status = $1
     WHERE id = $2 AND usuario_id = $3 AND status <> 'avaliado'
     RETURNING *`,
    [status, id, usuarioId]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Solicitação não encontrada ou já avaliada.');
  res.json(result.rows[0]);
}));

/* =========================================================
   AVALIAÇÕES
========================================================= */
app.post('/api/avaliacoes', asyncHandler(async (req, res) => {
  const prestadorId = inteiroPositivo(req.body.prestador_id);
  const usuarioId = inteiroPositivo(req.body.usuario_id);
  const historicoId = inteiroPositivo(req.body.historico_id);
  const nota = Number(req.body.nota);
  const comentario = texto(req.body.comentario, 1000);

  if (!prestadorId || !usuarioId || !historicoId) throw new HttpError(400, 'Dados inválidos.');
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new HttpError(400, 'A nota deve ser de 1 a 5.');

  const avaliacao = await comTransacao(async (client) => {
    // Só avalia quem solicitou o serviço, que esteja concluído e ainda não avaliado.
    const marcado = await client.query(
      `UPDATE historico SET status = 'avaliado'
       WHERE id = $1 AND usuario_id = $2 AND prestador_id = $3 AND status = 'concluido'
       RETURNING id`,
      [historicoId, usuarioId, prestadorId]
    );
    if (!marcado.rows[0]) throw new HttpError(409, 'Este serviço não está disponível para avaliação.');

    const ins = await client.query(
      'INSERT INTO avaliacoes (prestador_id, usuario_id, nota, comentario) VALUES ($1,$2,$3,$4) RETURNING *',
      [prestadorId, usuarioId, nota, comentario]
    );
    return ins.rows[0];
  });
  res.status(201).json(avaliacao);
}));

/* =========================================================
   TRATAMENTO DE ERROS
========================================================= */
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisição grande demais.' });
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });

  const erroPg = {
    '23505': [409, 'Registro já existe.'],
    '23503': [400, 'Referência inválida (usuário ou prestador inexistente).'],
    '23514': [400, 'Valor inválido.'],
    '22P02': [400, 'Formato de dado inválido.'],
  }[err.code];
  if (erroPg) return res.status(erroPg[0]).json({ erro: erroPg[1] });

  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

process.on('unhandledRejection', (motivo) => {
  console.error('Rejeição não tratada:', motivo);
});

/* =========================================================
   INICIALIZAÇÃO
========================================================= */
async function iniciar() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('\n[ERRO] Não foi possível conectar ao PostgreSQL:', err.message || err.code || err);
    if (err.code === '28P01') console.error('→ Usuário ou senha incorretos no .env.');
    else if (err.code === '3D000') console.error('→ O banco "' + process.env.PGDATABASE + '" não existe. Crie-o e rode o schema.sql.');
    else if (err.code === 'ECONNREFUSED') console.error('→ O PostgreSQL parece desligado ou a porta/host do .env estão errados.');
    process.exit(1);
  }

  // "0.0.0.0" faz o servidor aceitar conexões de outros dispositivos na mesma rede Wi-Fi.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Para acessar de outro dispositivo na mesma rede, use o IP local da sua máquina.');
  });
}

iniciar();
