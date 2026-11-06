// server.js — API Express com sessao, RBAC, perfis, anuncios, ordens e avaliacoes
const path = require('path');
const pool = require('./db');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   CONSTANTES E HELPERS
========================================================= */
const CIDADES = ['Camaquã', 'Sentinela do Sul', 'Tapes', 'Sertão Santana'];
const TIPOS_CADASTRO = ['cliente', 'prestador']; // 'admin' NUNCA no cadastro público
const TIPOS_VALIDOS = ['cliente', 'prestador', 'admin'];
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
   MIDDLEWARES GLOBAIS
========================================================= */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'https:', 'http:'],
        'upgrade-insecure-requests': null,
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));


// Sessao via PostgreSQL
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: false,
    }),
    secret: process.env.SESSION_SECRET || 'servico-facil-segredo-sessao-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  })
);

// Rate limit para auth
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.get('/admin.html', requireAuth, requireRole('admin'), (req,res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'admin.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', limiteAuth);
app.get('/api/contato-administrativo', (req,res) => {
  const email = (process.env.CONTATO_ADMIN_EMAIL || '').trim();
  res.json({ email: EMAIL_RE.test(email) ? email : null });
});

/* =========================================================
   MIDDLEWARES DE AUTENTICACAO E AUTORIZACAO (RBAC)
========================================================= */

async function requireAuth(req, res, next) {
  try {
    if (!req.session || !req.session.usuario || !req.session.usuario.id) {
      return res.status(401).json({ erro: 'Acesso restrito. Faça login para continuar.' });
    }

    const result = await pool.query(
      'SELECT id, nome, email, telefone, cidade, tipo, ativo FROM usuarios WHERE id = $1',
      [req.session.usuario.id]
    );
    const usuarioBanco = result.rows[0];

    if (!usuarioBanco) {
      req.session.destroy(() => {});
      return res.status(401).json({ erro: 'Usuário não encontrado. Sessão encerrada.' });
    }

    if (usuarioBanco.ativo === false) {
      req.session.destroy(() => {});
      return res.status(403).json({ erro: 'Sua conta está desativada. Ações protegidas estão bloqueadas.' });
    }

    req.session.usuario = {
      id: usuarioBanco.id,
      nome: usuarioBanco.nome,
      email: usuarioBanco.email,
      telefone: usuarioBanco.telefone,
      cidade: usuarioBanco.cidade,
      tipo: usuarioBanco.tipo,
    };
    req.usuario = usuarioBanco;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...tiposPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Não autenticado.' });
    }
    if (!tiposPermitidos.includes(req.usuario.tipo)) {
      return res.status(403).json({
        erro: 'Acesso negado: seu perfil (' + req.usuario.tipo + ') não tem permissão para esta operação.'
      });
    }
    next();
  };
}

// Helper para obter prestador_id do usuario autenticado
async function obterPrestadorDoUsuario(usuarioId) {
  const res = await pool.query(
    'SELECT id, usuario_id, nome, cidade, contato, ativo, visivel FROM prestadores WHERE usuario_id = $1 AND ativo = TRUE LIMIT 1',
    [usuarioId]
  );
  return res.rows[0] || null;
}

/* =========================================================
   AUTENTICACAO
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

  if (tipo === 'admin') {
    throw new HttpError(403, 'O perfil de administrador não pode ser criado pelo cadastro público.');
  }
  if (!TIPOS_CADASTRO.includes(tipo)) {
    throw new HttpError(400, 'Tipo de conta inválido.');
  }
  if (cidade && !CIDADES.includes(cidade)) {
    throw new HttpError(400, 'Cidade inválida.');
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  try {
    const usuarioCriado = await comTransacao(async (client) => {
      const insUser = await client.query(
        `INSERT INTO usuarios (nome, email, senha_hash, telefone, cidade, tipo, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id, nome, email, telefone, cidade, tipo, ativo`,
        [nome, email, senhaHash, telefone, cidade || null, tipo]
      );
      const user = insUser.rows[0];

      if (tipo === 'prestador') {
        await client.query(
          `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, ativo, visivel)
           VALUES ($1, $2, 'Prestador de Serviços', $3, 0, $4, '', TRUE, TRUE)`,
          [user.id, user.nome, user.cidade || 'Camaquã', user.telefone || '']
        );
      }
      return user;
    });

    req.session.usuario = {
      id: usuarioCriado.id,
      nome: usuarioCriado.nome,
      email: usuarioCriado.email,
      telefone: usuarioCriado.telefone,
      cidade: usuarioCriado.cidade,
      tipo: usuarioCriado.tipo,
    };

    res.status(201).json(req.session.usuario);
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

  if (usuario.ativo === false) {
    throw new HttpError(403, 'Esta conta foi desativada. Entre em contato com a administração.');
  }

  req.session.usuario = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    cidade: usuario.cidade,
    tipo: usuario.tipo,
  };

  res.json(req.session.usuario);
}));

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ erro: 'Erro ao encerrar sessão.' });
      res.clearCookie('connect.sid');
      res.json({ mensagem: 'Sessão encerrada com sucesso.' });
    });
  } else {
    res.json({ mensagem: 'Sessão já encerrada.' });
  }
});

app.get('/api/auth/me', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.usuario || !req.session.usuario.id) {
    return res.json(null);
  }
  const result = await pool.query(
    'SELECT id, nome, email, telefone, cidade, tipo, ativo FROM usuarios WHERE id = $1',
    [req.session.usuario.id]
  );
  const u = result.rows[0];
  if (!u || u.ativo === false) {
    req.session.destroy(() => {});
    return res.json(null);
  }
  req.session.usuario = {
    id: u.id,
    nome: u.nome,
    email: u.email,
    telefone: u.telefone,
    cidade: u.cidade,
    tipo: u.tipo,
  };
  res.json(req.session.usuario);
}));

/* =========================================================
   PERFIL PESSOAL E PROFISSIONAL
========================================================= */

app.get('/api/perfil', requireAuth, asyncHandler(async (req, res) => {
  const user = req.usuario;
  let dadosPrestador = null;

  if (user.tipo === 'prestador') {
    const prestRes = await pool.query(
      'SELECT * FROM prestadores WHERE usuario_id = $1 ORDER BY id ASC LIMIT 1',
      [user.id]
    );
    dadosPrestador = prestRes.rows[0] || null;
  }

  res.json({
    id: user.id,
    nome: user.nome,
    email: user.email,
    telefone: user.telefone,
    cidade: user.cidade,
    tipo: user.tipo,
    perfilPrestador: dadosPrestador,
  });
}));

app.put('/api/perfil', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.usuario.id;
  const nome = texto(req.body.nome, 150);
  const telefone = texto(req.body.telefone, 30);
  const cidade = texto(req.body.cidade, 100);
  const descricao = typeof req.body.descricao === 'string' ? texto(req.body.descricao, 2000) : undefined;
  const profissao = typeof req.body.profissao === 'string' ? texto(req.body.profissao, 100) : undefined;

  if (!nome) throw new HttpError(400, 'Nome é obrigatório.');
  if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');

  if (req.body.tipo && req.body.tipo !== req.usuario.tipo) {
    throw new HttpError(403, 'Não é permitido alterar o perfil de acesso da conta.');
  }

  const result = await pool.query(
    `UPDATE usuarios SET nome = $1, telefone = $2, cidade = $3
     WHERE id = $4
     RETURNING id, nome, email, telefone, cidade, tipo`,
    [nome, telefone, cidade || null, userId]
  );
  const userAtualizado = result.rows[0];

  if (userAtualizado.tipo === 'prestador') {
    await pool.query(
      `UPDATE prestadores
       SET nome = $1,
           cidade = COALESCE($2, cidade),
           contato = COALESCE($3, contato),
           descricao = COALESCE($4, descricao),
           profissao = COALESCE($5, profissao)
       WHERE usuario_id = $6`,
      [
        userAtualizado.nome,
        userAtualizado.cidade,
        userAtualizado.telefone,
        descricao !== undefined ? descricao : null,
        profissao !== undefined ? profissao : null,
        userId,
      ]
    );
  }

  req.session.usuario = {
    id: userAtualizado.id,
    nome: userAtualizado.nome,
    email: userAtualizado.email,
    telefone: userAtualizado.telefone,
    cidade: userAtualizado.cidade,
    tipo: userAtualizado.tipo,
  };

  res.json(req.session.usuario);
}));

/* =========================================================
   ANUNCIOS (Ofertas do Prestador)
========================================================= */

app.get('/api/anuncios', asyncHandler(async (req, res) => {
  const busca = texto(req.query.busca, 100);
  const categoria = texto(req.query.categoria, 100);
  const regiao = texto(req.query.regiao, 100);
  const cidade = texto(req.query.cidade, 100);

  let sql = `
    SELECT an.id, an.titulo, an.descricao, an.categoria, an.regiao, an.preco, an.foto_url, an.criado_em,
           p.id AS prestador_id, p.nome AS prestador_nome, p.cidade AS prestador_cidade, p.contato AS prestador_contato,
           COALESCE(AVG(av.nota), 0)::numeric(3,1) AS rating,
           COUNT(av.id)::int AS avaliacoes
    FROM anuncios an
    JOIN prestadores p ON p.id = an.prestador_id
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN avaliacoes av ON av.prestador_id = p.id
    WHERE an.ativo = TRUE
      AND an.visivel = TRUE AND NOT an.oculto_admin
      AND p.ativo = TRUE
      AND p.visivel = TRUE
      AND u.ativo = TRUE
  `;
  const params = [];

  if (busca) {
    params.push('%' + busca.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
    sql += ` AND (LOWER(an.titulo) LIKE $${params.length} OR LOWER(an.descricao) LIKE $${params.length} OR LOWER(an.categoria) LIKE $${params.length} OR LOWER(p.nome) LIKE $${params.length})`;
  }
  if (categoria) {
    params.push(categoria);
    sql += ` AND an.categoria = $${params.length}`;
  }
  if (regiao) {
    params.push(regiao);
    sql += ` AND an.regiao = $${params.length}`;
  }
  if (cidade) {
    params.push(cidade);
    sql += ` AND p.cidade = $${params.length}`;
  }

  sql += ' GROUP BY an.id, p.id ORDER BY an.criado_em DESC';

  const result = await pool.query(sql, params);
  res.json(result.rows);
}));

app.get('/api/anuncios/meus', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT an.*, p.nome AS prestador_nome
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE p.usuario_id = $1 AND an.ativo = TRUE
     ORDER BY an.criado_em DESC`,
    [req.usuario.id]
  );
  res.json(result.rows);
}));

app.get('/api/anuncios/:id', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'ID de anúncio inválido.');

  const result = await pool.query(
    `SELECT an.*, p.id AS prestador_id, p.nome AS prestador_nome, p.cidade AS prestador_cidade,
            p.contato AS prestador_contato, p.descricao AS prestador_bio, p.usuario_id AS prestador_usuario_id,
            COALESCE(AVG(av.nota), 0)::numeric(3,1) AS rating,
            COUNT(av.id)::int AS avaliacoes
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN avaliacoes av ON av.prestador_id = p.id
     WHERE an.id = $1 AND an.ativo AND an.visivel AND NOT an.oculto_admin AND p.ativo AND p.visivel AND u.ativo
     GROUP BY an.id, p.id, u.id`,
    [id]
  );
  const anuncio = result.rows[0];
  if (!anuncio) throw new HttpError(404, 'Anúncio não encontrado.');

  res.json(anuncio);
}));

app.post('/api/anuncios', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const userId = req.usuario.id;
  let prestador = await obterPrestadorDoUsuario(userId);

  if (!prestador) {
    const novoP = await pool.query(
      `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, ativo, visivel)
       VALUES ($1, $2, 'Prestador de Serviços', $3, 0, $4, '', TRUE, TRUE)
       RETURNING id, nome, cidade, contato, ativo, visivel`,
      [userId, req.usuario.nome, req.usuario.cidade || 'Camaquã', req.usuario.telefone || '']
    );
    prestador = novoP.rows[0];
  }

  const titulo = texto(req.body.titulo, 200);
  const descricao = texto(req.body.descricao, 2000);
  const categoria = texto(req.body.categoria, 100);
  const regiao = texto(req.body.regiao, 100) || prestador.cidade || 'Camaquã';
  const preco = req.body.preco !== undefined && req.body.preco !== '' ? Number(req.body.preco) : null;
  const fotoUrl = urlHttpValida(texto(req.body.foto_url, 500));

  if (!titulo || !descricao || !categoria) {
    throw new HttpError(400, 'Título, descrição e categoria são campos obrigatórios.');
  }
  if (preco !== null && (!Number.isFinite(preco) || preco < 0 || preco > 99999999)) {
    throw new HttpError(400, 'Preço inválido.');
  }

  const ins = await pool.query(
    `INSERT INTO anuncios (prestador_id, titulo, descricao, categoria, regiao, preco, foto_url, ativo, visivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
     RETURNING *`,
    [prestador.id, titulo, descricao, categoria, regiao, preco, fotoUrl]
  );

  res.status(201).json(ins.rows[0]);
}));

app.put('/api/anuncios/:id', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anúncio inválido.');

  const donoCheck = await pool.query(
    `SELECT an.id, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!donoCheck.rows[0]) throw new HttpError(404, 'Anúncio não encontrado.');
  if (donoCheck.rows[0].usuario_id !== req.usuario.id) {
    throw new HttpError(403, 'Você só pode editar seus próprios anúncios.');
  }

  const titulo = texto(req.body.titulo, 200);
  const descricao = texto(req.body.descricao, 2000);
  const categoria = texto(req.body.categoria, 100);
  const regiao = texto(req.body.regiao, 100);
  const preco = req.body.preco !== undefined && req.body.preco !== '' ? Number(req.body.preco) : null;
  const fotoUrl = urlHttpValida(texto(req.body.foto_url, 500));

  if (!titulo || !descricao || !categoria || !regiao) {
    throw new HttpError(400, 'Título, descrição, categoria e região são obrigatórios.');
  }

  const upd = await pool.query(
    `UPDATE anuncios
     SET titulo = $1, descricao = $2, categoria = $3, regiao = $4, preco = $5, foto_url = $6, atualizado_em = NOW()
     WHERE id = $7
     RETURNING *`,
    [titulo, descricao, categoria, regiao, preco, fotoUrl, id]
  );
  res.json(upd.rows[0]);
}));

app.put('/api/anuncios/:id/visibilidade', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anúncio inválido.');

  const anCheck = await pool.query(
    `SELECT an.id, an.visivel, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!anCheck.rows[0]) throw new HttpError(404, 'Anúncio não encontrado.');

  const isDono = anCheck.rows[0].usuario_id === req.usuario.id;
  if (!isDono) {
    throw new HttpError(403, 'Você só pode alterar a visibilidade de seus próprios anúncios.');
  }

  const novoVisivel = typeof req.body.visivel === 'boolean' ? req.body.visivel : !anCheck.rows[0].visivel;

  const upd = await pool.query(
    'UPDATE anuncios SET visivel = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *',
    [novoVisivel, id]
  );


  res.json(upd.rows[0]);
}));

app.delete('/api/anuncios/:id', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anúncio inválido.');

  const anCheck = await pool.query(
    `SELECT an.id, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!anCheck.rows[0]) throw new HttpError(404, 'Anúncio não encontrado.');

  const isDono = anCheck.rows[0].usuario_id === req.usuario.id;
  if (!isDono) {
    throw new HttpError(403, 'Você só pode remover seus próprios anúncios.');
  }

  await pool.query('UPDATE anuncios SET ativo = FALSE, visivel = FALSE, atualizado_em = NOW() WHERE id = $1', [id]);


  res.json({ mensagem: 'Anúncio desativado com sucesso (registro preservado).' });
}));

app.get('/api/categorias-anuncios', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT an.categoria
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE an.ativo = TRUE AND an.visivel = TRUE AND NOT an.oculto_admin AND p.ativo = TRUE AND p.visivel = TRUE AND u.ativo = TRUE
     ORDER BY an.categoria`
  );
  res.json(result.rows.map((r) => r.categoria));
}));

/* =========================================================
   ORDENS DE SERVIÇO (Etapa 2)
========================================================= */

// 1. Criar Ordem de Serviço (Apenas clientes autenticados e ativos)
app.post('/api/ordens', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const clienteId = req.usuario.id;
  const tipo = req.body.tipo; // 'aberta' ou 'direcionada'

  if (tipo !== 'aberta' && tipo !== 'direcionada') {
    throw new HttpError(400, 'Tipo de ordem inválido (deve ser "aberta" ou "direcionada").');
  }

  const descricao = texto(req.body.descricao, 2000);
  const cidade = texto(req.body.cidade, 100);
  const bairro = texto(req.body.bairro, 100) || 'Centro';
  const periodoDesejado = texto(req.body.periodo_desejado, 100) || null;

  if (!descricao) throw new HttpError(400, 'A descrição da necessidade é obrigatória.');
  if (!cidade || !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');

  let titulo = texto(req.body.titulo, 200);
  let categoria = texto(req.body.categoria, 100);
  let anuncioId = null;
  let anuncioTituloSnapshot = null;
  let anuncioPrecoSnapshot = null;
  let prestadorDestinatarioId = null;
  let statusInicial = 'aberta';

  const novaOrdem = await comTransacao(async (client) => {
    if (tipo === 'aberta') {
      if (!titulo) throw new HttpError(400, 'O título da ordem aberta é obrigatório.');
      if (!categoria) throw new HttpError(400, 'A categoria do serviço é obrigatória.');
      statusInicial = 'aberta';
    } else {
      // Ordem direcionada via anúncio
      anuncioId = inteiroPositivo(req.body.anuncio_origem_id || req.body.anuncio_id);
      if (!anuncioId) throw new HttpError(400, 'Para ordem direcionada, informe o anúncio de origem.');

      // Consulta anúncio e prestador
      const anRes = await client.query(
        `SELECT an.*, p.id AS prestador_id, p.ativo AS prestador_ativo, p.visivel AS prestador_visivel,
                u.ativo AS prestador_usuario_ativo
         FROM anuncios an
         JOIN prestadores p ON p.id = an.prestador_id
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE an.id = $1 FOR SHARE OF an,p,u`,
        [anuncioId]
      );
      const anuncio = anRes.rows[0];
      if (!anuncio || !anuncio.ativo) {
        throw new HttpError(404, 'Anúncio não encontrado ou indisponível.');
      }
      if (anuncio.oculto_admin || !anuncio.visivel || !anuncio.prestador_ativo || !anuncio.prestador_visivel || !anuncio.prestador_usuario_ativo) {
        throw new HttpError(400, 'Este anúncio está oculto ou o prestador está temporariamente indisponível para novos pedidos.');
      }

      prestadorDestinatarioId = anuncio.prestador_id;
      anuncioTituloSnapshot = anuncio.titulo;
      anuncioPrecoSnapshot = anuncio.preco;
      categoria = anuncio.categoria;
      titulo = titulo || ('Pedido: ' + anuncio.titulo);
      statusInicial = 'aguardando_resposta';
    }

    const ins = await client.query(
      `INSERT INTO ordens_servico (
         cliente_id, tipo, titulo, descricao, categoria, cidade, bairro, periodo_desejado,
         anuncio_origem_id, anuncio_titulo_snapshot, anuncio_preco_snapshot,
         prestador_destinatario_id, prestador_responsavel_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13)
       RETURNING *`,
      [
        clienteId, tipo, titulo, descricao, categoria, cidade, bairro, periodoDesejado,
        anuncioId, anuncioTituloSnapshot, anuncioPrecoSnapshot,
        prestadorDestinatarioId, statusInicial
      ]
    );
    const ordem = ins.rows[0];

    // Registra evento no historico da ordem
    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, NULL, $3, $4)`,
      [ordem.id, clienteId, statusInicial, `Ordem criada pelo cliente como "${tipo}"`]
    );

    return ordem;
  });

  res.status(201).json(novaOrdem);
}));

// 2. Área de Oportunidades Abertas (Para prestadores ativos)
// PRIVACIDADE: Oculta dados pessoais do cliente (endereço exato, telefone, sobrenome)
app.get('/api/ordens/oportunidades', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const categoria = texto(req.query.categoria, 100);
  const cidade = texto(req.query.cidade, 100);
  const busca = texto(req.query.busca, 100);

  let sql = `
    SELECT o.id, o.titulo, o.descricao, o.categoria, o.cidade, o.bairro, o.periodo_desejado, o.criado_em,
           SPLIT_PART(u.nome, ' ', 1) AS cliente_primeiro_nome
    FROM ordens_servico o
    JOIN usuarios u ON u.id = o.cliente_id
    WHERE o.status = 'aberta'
      AND o.tipo = 'aberta'
      AND o.prestador_responsavel_id IS NULL
      AND u.ativo = TRUE
  `;
  const params = [];

  if (categoria) {
    params.push(categoria);
    sql += ` AND o.categoria = $${params.length}`;
  }
  if (cidade) {
    params.push(cidade);
    sql += ` AND o.cidade = $${params.length}`;
  }
  if (busca) {
    params.push('%' + busca.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
    sql += ` AND (LOWER(o.titulo) LIKE $${params.length} OR LOWER(o.descricao) LIKE $${params.length} OR LOWER(o.categoria) LIKE $${params.length})`;
  }

  sql += ' ORDER BY o.criado_em DESC';
  const result = await pool.query(sql, params);
  res.json(result.rows);
}));

// 3. Minhas Ordens (Área do Cliente)
app.get('/api/ordens/minhas', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT o.*,
            p_dest.nome AS prestador_destinatario_nome,
            p_resp.nome AS prestador_responsavel_nome,
            p_resp.contato AS prestador_responsavel_contato,
            CASE WHEN av.id IS NOT NULL THEN true ELSE false END AS avaliada,
            av.nota AS avaliacao_nota
     FROM ordens_servico o
     LEFT JOIN prestadores p_dest ON p_dest.id = o.prestador_destinatario_id
     LEFT JOIN prestadores p_resp ON p_resp.id = o.prestador_responsavel_id
     LEFT JOIN avaliacoes av ON av.ordem_id = o.id
     WHERE o.cliente_id = $1
     ORDER BY o.criado_em DESC`,
    [req.usuario.id]
  );
  res.json(result.rows);
}));

// 4. Pedidos Direcionados Recebidos (Área do Prestador)
app.get('/api/ordens/recebidas', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) return res.json([]);

  const result = await pool.query(
    `SELECT o.*, u.nome AS cliente_nome, u.cidade AS cliente_cidade,
            (o.anuncio_origem_id IS NULL OR (an.ativo AND an.visivel AND NOT an.oculto_admin AND p.visivel)) AS pode_aceitar
     FROM ordens_servico o
     JOIN prestadores p ON p.id=o.prestador_destinatario_id
     LEFT JOIN anuncios an ON an.id=o.anuncio_origem_id
     JOIN usuarios u ON u.id = o.cliente_id
     WHERE o.prestador_destinatario_id = $1
       AND o.status = 'aguardando_resposta'
       AND u.ativo = TRUE
     ORDER BY o.criado_em DESC`,
    [prestador.id]
  );
  res.json(result.rows);
}));

// 5. Meus Atendimentos Assumidos (Área do Prestador — Aceitas, Em Andamento e Concluídas)
app.get('/api/ordens/atendimentos', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) return res.json([]);

  const result = await pool.query(
    `SELECT o.*, u.nome AS cliente_nome, u.cidade AS cliente_cidade, u.telefone AS cliente_telefone,
            CASE WHEN av.id IS NOT NULL THEN true ELSE false END AS avaliada,
            av.nota AS avaliacao_nota, av.comentario AS avaliacao_comentario
     FROM ordens_servico o
     JOIN usuarios u ON u.id = o.cliente_id
     LEFT JOIN avaliacoes av ON av.ordem_id = o.id
     WHERE o.prestador_responsavel_id = $1
     ORDER BY o.atualizado_em DESC`,
    [prestador.id]
  );
  res.json(result.rows);
}));

// 6. Consultar Detalhes de uma Ordem Específica
app.get('/api/ordens/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'ID de ordem inválido.');

  const result = await pool.query(
    `SELECT o.*,
            u.nome AS cliente_nome, u.telefone AS cliente_telefone, u.email AS cliente_email,
            p_dest.nome AS prestador_destinatario_nome,
            p_resp.nome AS prestador_responsavel_nome, p_resp.contato AS prestador_responsavel_contato,
            p_dest.usuario_id AS prestador_destinatario_user_id,
            p_resp.usuario_id AS prestador_responsavel_user_id
     FROM ordens_servico o
     JOIN usuarios u ON u.id = o.cliente_id
     LEFT JOIN prestadores p_dest ON p_dest.id = o.prestador_destinatario_id
     LEFT JOIN prestadores p_resp ON p_resp.id = o.prestador_responsavel_id
     WHERE o.id = $1`,
    [id]
  );
  const ordem = result.rows[0];
  if (!ordem) throw new HttpError(404, 'Ordem de serviço não encontrada.');

  const userId = req.usuario.id;
  const isCliente = ordem.cliente_id === userId;
  const isDestinatario = ordem.prestador_destinatario_user_id === userId;
  const isResponsavel = ordem.prestador_responsavel_user_id === userId;
  const isAdmin = req.usuario.tipo === 'admin';
  const isPrestadorOportunidade = req.usuario.tipo === 'prestador' && ordem.status === 'aberta' && ordem.tipo === 'aberta';

  if (!isCliente && !isDestinatario && !isResponsavel && !isAdmin && !isPrestadorOportunidade) {
    throw new HttpError(403, 'Você não tem permissão para visualizar esta ordem.');
  }

  // Se for apenas visualizador de oportunidade aberta, esconde dados privados
  if (!isCliente && !isResponsavel && !isAdmin) {
    delete ordem.cliente_telefone;
    delete ordem.cliente_email;
    ordem.cliente_nome = ordem.cliente_nome.split(' ')[0];
  }

  res.json(ordem);
}));

// 7. Editar Escopo da Ordem (Apenas cliente proprietário, enquanto 'aberta' ou 'aguardando_resposta')
app.put('/api/ordens/:id', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const alterada = await comTransacao(async client => {
    const ordRes = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = ordRes.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem de serviço não encontrada.');

    if (ordem.cliente_id !== req.usuario.id) {
      throw new HttpError(403, 'Você só pode editar suas próprias ordens.');
    }

    if (ordem.status !== 'aberta' && ordem.status !== 'aguardando_resposta') {
      throw new HttpError(403, 'Não é permitido alterar o escopo de uma ordem após o aceite pelo prestador.');
    }

    const titulo = texto(req.body.titulo, 200) || ordem.titulo;
    const descricao = texto(req.body.descricao, 2000) || ordem.descricao;
    const categoria = texto(req.body.categoria, 100) || ordem.categoria;
    const cidade = texto(req.body.cidade, 100) || ordem.cidade;
    const bairro = texto(req.body.bairro, 100) || ordem.bairro;
    const periodoDesejado = req.body.periodo_desejado !== undefined ? texto(req.body.periodo_desejado, 100) : ordem.periodo_desejado;

    if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');

    const upd = await client.query(
      `UPDATE ordens_servico
       SET titulo = $1, descricao = $2, categoria = $3, cidade = $4, bairro = $5, periodo_desejado = $6, atualizado_em = NOW()
       WHERE id = $7
       RETURNING *`,
      [titulo, descricao, categoria, cidade, bairro, periodoDesejado, id]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, $3, $3, 'Escopo da ordem editado pelo cliente')`,
      [id, req.usuario.id, ordem.status]
    );
    return upd.rows[0];
  });
  res.json(alterada);
}));

// 8. Aceitar Ordem (Atômico, proteção contra concorrência)
app.put('/api/ordens/:id/aceitar', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) {
    throw new HttpError(400, 'Perfil de prestador não configurado.');
  }

  const ordemAceita = await comTransacao(async (client) => {
    // Lock exclusivo na linha da ordem
    const lockRes = await client.query(
      `SELECT o.*, u.ativo AS cliente_ativo
       FROM ordens_servico o
       JOIN usuarios u ON u.id = o.cliente_id
       WHERE o.id = $1 FOR UPDATE`,
      [id]
    );
    const ordem = lockRes.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    if (ordem.cliente_ativo === false) {
      throw new HttpError(400, 'Não é possível aceitar a ordem pois a conta do cliente está desativada.');
    }

    if (ordem.tipo === 'direcionada') {
      if (ordem.prestador_destinatario_id !== prestador.id) {
        throw new HttpError(403, 'Apenas o prestador destinatário pode aceitar este pedido direcionado.');
      }
      if (ordem.status !== 'aguardando_resposta') {
        throw new HttpError(400, 'Este pedido não está aguardando resposta.');
      }

      // Revalidação do anúncio de origem
      if (ordem.anuncio_origem_id) {
        const anCheck = await client.query(
          `SELECT an.ativo, (an.visivel AND NOT an.oculto_admin AND p.visivel AND p.ativo AND u.ativo) AS visivel FROM anuncios an JOIN prestadores p ON p.id=an.prestador_id JOIN usuarios u ON u.id=p.usuario_id WHERE an.id=$1 FOR SHARE OF an,p,u`,
          [ordem.anuncio_origem_id]
        );
        const an = anCheck.rows[0];
        if (!an || an.ativo === false || an.visivel === false) {
          throw new HttpError(400, 'Não é possível aceitar este pedido pois o anúncio original foi ocultado pelo prestador.');
        }
      }
    } else {
      // Ordem aberta
      if (ordem.status !== 'aberta' || ordem.prestador_responsavel_id !== null) {
        throw new HttpError(409, 'Esta ordem já foi aceita por outro profissional ou não está mais disponível.');
      }
    }

    // Aceite atômico
    const upd = await client.query(
      `UPDATE ordens_servico
       SET prestador_responsavel_id = $1, status = 'aceita', atualizado_em = NOW()
       WHERE id = $2
       RETURNING *`,
      [prestador.id, id]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, $3, 'aceita', $4)`,
      [id, req.usuario.id, ordem.status, `Ordem aceita pelo prestador ${prestador.nome}`]
    );

    return upd.rows[0];
  });

  res.json(ordemAceita);
}));

// 9. Recusar Pedido Direcionado (Apenas destinatário de ordem direcionada)
app.put('/api/ordens/:id/recusar', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) throw new HttpError(400, 'Perfil de prestador não configurado.');

  const motivo = texto(req.body.motivo, 500) || 'Indisponibilidade de agenda no momento';

  const ordemRecusada = await comTransacao(async (client) => {
    const check = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = check.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    if (ordem.tipo !== 'direcionada' || ordem.prestador_destinatario_id !== prestador.id) {
      throw new HttpError(403, 'Apenas o prestador destinatário pode recusar este pedido.');
    }
    if (ordem.status !== 'aguardando_resposta') {
      throw new HttpError(400, 'Esta ordem não está no estado "Aguardando resposta".');
    }

    const upd = await client.query(
      `UPDATE ordens_servico
       SET status = 'recusada', motivo_recusa = $1, atualizado_em = NOW()
       WHERE id = $2
       RETURNING *`,
      [motivo, id]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, 'aguardando_resposta', 'recusada', $3)`,
      [id, req.usuario.id, `Pedido recusado pelo prestador. Motivo: ${motivo}`]
    );

    return upd.rows[0];
  });

  res.json(ordemRecusada);
}));

// 10. Iniciar Atendimento (Transição: 'aceita' -> 'em_andamento')
app.put('/api/ordens/:id/iniciar', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) throw new HttpError(400, 'Prestador não encontrado.');

  const upd = await comTransacao(async (client) => {
    const check = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = check.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    if (ordem.prestador_responsavel_id !== prestador.id) {
      throw new HttpError(403, 'Apenas o prestador responsável pode iniciar o atendimento.');
    }
    if (ordem.status !== 'aceita') {
      throw new HttpError(400, `Transição inválida: a ordem deve estar "aceita" (status atual: ${ordem.status}).`);
    }

    const resUpd = await client.query(
      "UPDATE ordens_servico SET status = 'em_andamento', atualizado_em = NOW() WHERE id = $1 RETURNING *",
      [id]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, 'aceita', 'em_andamento', 'Atendimento iniciado pelo prestador')`,
      [id, req.usuario.id]
    );

    return resUpd.rows[0];
  });

  res.json(upd);
}));

// 11. Concluir Atendimento (Transição: 'em_andamento' -> 'concluida')
// REGRA: Concluir uma ordem NÃO afeta nem desativa o anúncio
app.put('/api/ordens/:id/concluir', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const prestador = await obterPrestadorDoUsuario(req.usuario.id);
  if (!prestador) throw new HttpError(400, 'Prestador não encontrado.');

  const upd = await comTransacao(async (client) => {
    const check = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = check.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    if (ordem.prestador_responsavel_id !== prestador.id) {
      throw new HttpError(403, 'Apenas o prestador responsável pode concluir o atendimento.');
    }
    if (ordem.status !== 'em_andamento') {
      throw new HttpError(400, `Transição inválida: a ordem deve estar "em_andamento" (status atual: ${ordem.status}).`);
    }

    const resUpd = await client.query(
      "UPDATE ordens_servico SET status = 'concluida', atualizado_em = NOW() WHERE id = $1 RETURNING *",
      [id]
    );

    // Incrementa contador de serviços concluídos no prestador
    await client.query('UPDATE prestadores SET requisicoes = requisicoes + 1 WHERE id = $1', [prestador.id]);

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, 'em_andamento', 'concluida', 'Atendimento finalizado com sucesso pelo prestador')`,
      [id, req.usuario.id]
    );

    return resUpd.rows[0];
  });

  res.json(upd);
}));

// 12. Cancelar Ordem
// Cliente pode cancelar se 'aberta' ou 'aguardando_resposta'.
// Admin pode cancelar se 'aceita' ou 'em_andamento', exigindo motivo.
app.put('/api/ordens/:id/cancelar', requireAuth, asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');
  const motivo = texto(req.body.motivo, 500);

  const resUpd = await comTransacao(async (client) => {
    const check = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = check.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    if (ordem.status === 'concluida' || ordem.status === 'cancelada' || ordem.status === 'recusada') {
      throw new HttpError(400, `Esta ordem já está encerrada (${ordem.status}) e não pode ser cancelada.`);
    }

    const isCliente = ordem.cliente_id === req.usuario.id;
    const isAdmin = req.usuario.tipo === 'admin';

    if (isCliente) {
      if (ordem.status !== 'aberta' && ordem.status !== 'aguardando_resposta') {
        throw new HttpError(403, 'Cancelamentos após o aceite pelo prestador devem ser solicitados à administração com registro do motivo.');
      }
    } else if (!isAdmin) {
      throw new HttpError(403, 'Você não tem permissão para cancelar esta ordem.');
    }

    if (isAdmin && !motivo) {
      throw new HttpError(400, 'Para cancelamentos administrativos de ordens já aceitas, o motivo é obrigatório.');
    }

    const upd = await client.query(
      `UPDATE ordens_servico
       SET status = 'cancelada', motivo_cancelamento = $1, cancelado_por_usuario_id = $2, atualizado_em = NOW()
       WHERE id = $3
       RETURNING *`,
      [motivo || 'Cancelado pelo cliente', req.usuario.id, id]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, $3, 'cancelada', $4)`,
      [id, req.usuario.id, ordem.status, `Cancelamento: ${motivo || 'Sem observação'}`]
    );

    if (isAdmin) {
      await client.query(
        `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo)
         VALUES ($1, 'cancelar_ordem', 'ordens_servico', $2, $3)`,
        [req.usuario.id, id, motivo]
      );
    }

    return upd.rows[0];
  });

  res.json(resUpd);
}));

// 13. Ajuste Excepcional de Escopo por Administrador
app.put('/api/admin/ordens/:id/escopo', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Ordem inválida.');

  const motivo = texto(req.body.motivo, 500);
  if (!motivo) throw new HttpError(400, 'O motivo da alteração de escopo administrativa é obrigatório.');

  const resUpd = await comTransacao(async (client) => {
    const check = await client.query('SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE', [id]);
    const ordem = check.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem não encontrada.');

    const campos = ['titulo','descricao','categoria','cidade','bairro'];
    const escopo = registro => Object.fromEntries(campos.map(c => [c, registro[c]]));
    if (Object.keys(req.body).some(c => c !== 'motivo' && !campos.includes(c))) throw new HttpError(400, 'Campo fora do escopo permitido.');
    if (req.body.cidade && !CIDADES.includes(req.body.cidade)) throw new HttpError(400, 'Cidade inválida.');
    if (!campos.some(c => texto(req.body[c], 2000) && req.body[c].trim() !== ordem[c])) throw new HttpError(400, 'Informe uma alteração de escopo.');
    const titulo = texto(req.body.titulo, 200) || ordem.titulo;
    const descricao = texto(req.body.descricao, 2000) || ordem.descricao;
    const categoria = texto(req.body.categoria, 100) || ordem.categoria;
    const cidade = texto(req.body.cidade, 100) || ordem.cidade;
    const bairro = texto(req.body.bairro, 100) || ordem.bairro;

    const upd = await client.query(
      `UPDATE ordens_servico
       SET titulo = $1, descricao = $2, categoria = $3, cidade = $4, bairro = $5, atualizado_em = NOW()
       WHERE id = $6
       RETURNING *`,
      [titulo, descricao, categoria, cidade, bairro, id]
    );

    await client.query(
      `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo, dados_anteriores, dados_posteriores)
       VALUES ($1, 'ajuste_escopo', 'ordens_servico', $2, $3, $4,$5)`,
      [req.usuario.id, id, motivo, escopo(ordem), escopo(upd.rows[0])]
    );

    await client.query(
      `INSERT INTO ordem_historico_eventos (ordem_id, usuario_id, status_anterior, status_novo, descricao)
       VALUES ($1, $2, $3, $3, $4)`,
      [id, req.usuario.id, ordem.status, `Ajuste administrativo de escopo: ${motivo}`]
    );

    return upd.rows[0];
  });

  res.json(resUpd);
}));

/* =========================================================
   AVALIACOES (Vinculadas à Ordem Concluída)
========================================================= */

app.post('/api/avaliacoes', requireAuth, requireRole('cliente'), asyncHandler(async (req, res) => {
  const ordemId = inteiroPositivo(req.body.ordem_id);
  const nota = Number(req.body.nota);
  const comentario = texto(req.body.comentario, 1000);

  if (!ordemId) throw new HttpError(400, 'Informe a ordem de serviço a ser avaliada.');
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    throw new HttpError(400, 'A nota de avaliação deve ser um número inteiro de 1 a 5.');
  }

  const avaliacao = await comTransacao(async (client) => {
    // Busca a ordem com lock
    const ordCheck = await client.query(
      'SELECT * FROM ordens_servico WHERE id = $1 FOR UPDATE',
      [ordemId]
    );
    const ordem = ordCheck.rows[0];
    if (!ordem) throw new HttpError(404, 'Ordem de serviço não encontrada.');

    // REGRA: Somente o cliente responsável pode avaliar
    if (ordem.cliente_id !== req.usuario.id) {
      throw new HttpError(403, 'Você só pode avaliar atendimentos solicitados pela sua própria conta.');
    }

    // REGRA: A ordem precisa estar concluída
    if (ordem.status !== 'concluida') {
      throw new HttpError(400, `A ordem deve estar com status "concluida" para ser avaliada (status atual: ${ordem.status}).`);
    }

    if (!ordem.prestador_responsavel_id) {
      throw new HttpError(400, 'Esta ordem não possui prestador responsável registrado.');
    }

    // REGRA: Prestador não pode autoavaliar
    const prestCheck = await client.query('SELECT usuario_id FROM prestadores WHERE id = $1', [ordem.prestador_responsavel_id]);
    if (prestCheck.rows[0] && prestCheck.rows[0].usuario_id === req.usuario.id) {
      throw new HttpError(403, 'Prestadores não podem avaliar o próprio atendimento.');
    }

    // REGRA: Única avaliação por ordem (garantida também por UNIQUE constraint)
    const jaAvaliada = await client.query('SELECT id FROM avaliacoes WHERE ordem_id = $1', [ordemId]);
    if (jaAvaliada.rows.length > 0) {
      throw new HttpError(409, 'Esta ordem de serviço já foi avaliada anteriormente.');
    }

    const ins = await client.query(
      `INSERT INTO avaliacoes (ordem_id, prestador_id, usuario_id, nota, comentario)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ordemId, ordem.prestador_responsavel_id, req.usuario.id, nota, comentario]
    );

    return ins.rows[0];
  });

  res.status(201).json(avaliacao);
}));

/* =========================================================
   PRESTADORES / BUSCA E DETALHES
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
    JOIN usuarios u ON u.id = p.usuario_id
    LEFT JOIN avaliacoes a ON a.prestador_id = p.id
    WHERE p.ativo = TRUE AND p.visivel = TRUE AND u.ativo = TRUE
  `;
  const params = [];

  if (busca) {
    params.push('%' + busca.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%');
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

  sql += ` GROUP BY p.id ORDER BY ${ordem}, p.id`;

  const result = await pool.query(sql, params);
  res.json(result.rows);
}));

app.get('/api/prestadores/:id', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Prestador inválido.');

  const prestadorRes = await pool.query(
    `SELECT p.*, COALESCE(AVG(a.nota),0)::numeric(3,1) AS rating, COUNT(a.id)::int AS avaliacoes
     FROM prestadores p
     JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN avaliacoes a ON a.prestador_id = p.id
     WHERE p.id = $1 AND p.ativo = TRUE AND p.visivel = TRUE AND u.ativo = TRUE
     GROUP BY p.id`,
    [id]
  );
  const prestador = prestadorRes.rows[0];
  if (!prestador) throw new HttpError(404, 'Prestador não encontrado ou inativo.');

  const comentarios = await pool.query(
    `SELECT a.nota, a.comentario, a.criado_em, 'Cliente' AS autor
     FROM avaliacoes a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.prestador_id = $1
     ORDER BY a.criado_em DESC`,
    [id]
  );

  const anuncios = await pool.query(
    `SELECT * FROM anuncios
     WHERE prestador_id = $1 AND ativo = TRUE AND visivel = TRUE AND NOT oculto_admin
     ORDER BY criado_em DESC`,
    [id]
  );

  // Historico publico de ordens concluidas deste prestador (SEM dados privados de clientes)
  const historicoConcluido = await pool.query(
    `SELECT o.cidade, COALESCE((SELECT MIN(e.criado_em) FROM ordem_historico_eventos e WHERE e.ordem_id=o.id AND e.status_novo='concluida'), o.criado_em)::date AS data_conclusao
     FROM ordens_servico o
     WHERE o.prestador_responsavel_id = $1 AND o.status = 'concluida'
     ORDER BY data_conclusao DESC`,
    [id]
  );

  res.json({
    ...prestador,
    comentarios: comentarios.rows,
    anuncios: anuncios.rows,
    historicoConcluido: historicoConcluido.rows,
  });
}));

app.get('/api/profissoes', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT p.profissao
     FROM prestadores p
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.ativo = TRUE AND p.visivel = TRUE AND u.ativo = TRUE
     ORDER BY p.profissao`
  );
  res.json(result.rows.map((r) => r.profissao));
}));

app.post('/api/prestadores', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const usuarioId = req.usuario.id;
  const nome = req.usuario.nome;
  const profissao = texto(req.body.profissao, 100);
  const cidade = texto(req.body.cidade, 100) || req.usuario.cidade;
  const preco = Number(req.body.preco) || 0;
  const contato = texto(req.body.contato, 30) || req.usuario.telefone;
  const descricao = texto(req.body.descricao, 2000);
  const fotoUrl = urlHttpValida(texto(req.body.foto_url, 500));

  if (!profissao || !cidade || !contato) {
    throw new HttpError(400, 'Campos obrigatórios faltando (profissão, cidade e contato).');
  }
  if (!CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');
  if (!Number.isFinite(preco) || preco < 0 || preco > 99999999) throw new HttpError(400, 'Preço inválido.');

  const result = await comTransacao(async client => {
    await client.query('SELECT id FROM usuarios WHERE id=$1 FOR UPDATE',[usuarioId]);
    const existente = await client.query('SELECT id FROM prestadores WHERE usuario_id=$1',[usuarioId]);
    if (existente.rowCount) throw new HttpError(409,'Seu perfil já existe. Edite o perfil atual.');
    return client.query(
    `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, foto_url, ativo, visivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE)
     RETURNING *`,
    [usuarioId, nome, profissao, cidade, preco, contato, descricao, fotoUrl]
  );
  });
  res.status(201).json(result.rows[0]);
}));

app.put('/api/prestadores/:id', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'ID inválido.');

  const check = await pool.query('SELECT * FROM prestadores WHERE id = $1', [id]);
  const p = check.rows[0];
  if (!p) throw new HttpError(404, 'Prestador não encontrado.');
  if (p.usuario_id !== req.usuario.id) {
    throw new HttpError(403, 'Você só pode editar seu próprio perfil profissional.');
  }

  const profissao = texto(req.body.profissao, 100) || p.profissao;
  const cidade = texto(req.body.cidade, 100) || p.cidade;
  const preco = req.body.preco !== undefined ? Number(req.body.preco) : p.preco;
  const contato = texto(req.body.contato, 30) || p.contato;
  const descricao = req.body.descricao !== undefined ? texto(req.body.descricao, 2000) : p.descricao;
  const fotoUrl = req.body.foto_url !== undefined ? urlHttpValida(texto(req.body.foto_url, 500)) : p.foto_url;

  if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade inválida.');

  const upd = await pool.query(
    `UPDATE prestadores
     SET profissao = $1, cidade = $2, preco = $3, contato = $4, descricao = $5, foto_url = $6
     WHERE id = $7
     RETURNING *`,
    [profissao, cidade, preco, contato, descricao, fotoUrl, id]
  );
  res.json(upd.rows[0]);
}));

/* =========================================================
   COMPATIBILIDADE COM HISTÓRICO LEGADO
========================================================= */

// Rota legada adaptada para ordens_servico do cliente autenticado
app.get('/api/historico/:usuarioId', requireAuth, asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.params.usuarioId);
  if (!usuarioId) throw new HttpError(400, 'Usuário inválido.');

  if (req.usuario.tipo !== 'admin' && req.usuario.id !== usuarioId) {
    throw new HttpError(403, 'Você só pode acessar seu próprio histórico.');
  }

  const result = await pool.query(
    `SELECT o.id, o.titulo AS servico, o.status, o.criado_em AS data_solicitacao,
            COALESCE(p_resp.nome, p_dest.nome, 'Aguardando prestador') AS prestador_nome,
            o.prestador_responsavel_id AS prestador_id
     FROM ordens_servico o
     LEFT JOIN prestadores p_resp ON p_resp.id = o.prestador_responsavel_id
     LEFT JOIN prestadores p_dest ON p_dest.id = o.prestador_destinatario_id
     WHERE o.cliente_id = $1
     ORDER BY o.criado_em DESC`,
    [usuarioId]
  );
  res.json(result.rows);
}));

/* =========================================================
   ADMINISTRACAO (Base)
========================================================= */

// As tabelas e colunas abaixo são constantes do servidor.
function moderar({ tabela, coluna, entrada, acoes, filtro = 'TRUE' }) {
  return asyncHandler(async (req,res) => {
    const id = inteiroPositivo(req.params.id);
    const valor = req.body[entrada];
    const motivo = texto(req.body.motivo,500);
    if (!id || typeof valor !== 'boolean' || !motivo) throw new HttpError(400,'Informe o estado e o motivo da alteração.');
    const registro = await comTransacao(async db => {
      const alterado = await db.query(
        `UPDATE ${tabela} SET ${coluna}=$1 WHERE id=$2 AND ${filtro} RETURNING id, ${coluna}`, [valor,id]);
      if (!alterado.rowCount) throw new HttpError(404,'Registro indisponível para moderação.');
      await db.query('INSERT INTO log_admin(admin_id,acao,entidade,entidade_id,motivo) VALUES($1,$2,$3,$4,$5)',
        [req.usuario.id,acoes[Number(valor)],tabela,id,motivo]);
      return alterado.rows[0];
    });
    res.json(registro);
  });
}
app.use('/api/admin', requireAuth, requireRole('admin'));
app.put('/api/admin/usuarios/:id/status', moderar({ tabela:'usuarios', coluna:'ativo', entrada:'ativo',
  acoes:['desativar_usuario','reativar_usuario'], filtro:"tipo IN ('cliente','prestador')" }));
app.put('/api/admin/prestadores/:id/visibilidade', moderar({ tabela:'prestadores', coluna:'visivel', entrada:'visivel',
  acoes:['ocultar_perfil','restaurar_perfil'] }));
app.put('/api/admin/anuncios/:id/moderacao', moderar({ tabela:'anuncios', coluna:'oculto_admin', entrada:'oculto_admin',
  acoes:['restaurar_anuncio','ocultar_anuncio'], filtro:'ativo' }));
app.get('/api/admin/painel', asyncHandler(async (req,res) => {
  const consultas = {
    contas: "SELECT id,nome,email,tipo,ativo FROM usuarios WHERE tipo IN ('cliente','prestador') ORDER BY id DESC",
    perfis: 'SELECT id,nome,visivel FROM prestadores ORDER BY id DESC',
    anuncios: 'SELECT id,titulo,ativo,visivel,oculto_admin FROM anuncios ORDER BY id DESC',
    ordens: 'SELECT o.*,u.nome AS cliente,p.nome AS responsavel FROM ordens_servico o JOIN usuarios u ON u.id=o.cliente_id LEFT JOIN prestadores p ON p.id=o.prestador_responsavel_id ORDER BY o.id DESC',
    historico: 'SELECT l.*,u.nome AS administrador FROM log_admin l JOIN usuarios u ON u.id=l.admin_id ORDER BY l.id DESC'
  };
  const listas = await Promise.all(Object.entries(consultas).map(async ([nome,sql]) => [nome,(await pool.query(sql)).rows]));
  res.set('Cache-Control','no-store').json(Object.fromEntries(listas));
}));

/* =========================================================
   TRATAMENTO DE ERROS E ROTA NAO ENCONTRADA
========================================================= */
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisição grande demais.' });
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });

  const erroPg = {
    '23505': [409, 'Registro já existe ou violação de unicidade.'],
    '23503': [400, 'Referência inválida (registro inexistente).'],
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
   INICIALIZACAO
========================================================= */
async function iniciar() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('\n[ERRO] Não foi possível conectar ao PostgreSQL:', err.message || err.code || err);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

iniciar();
