// server.js — API Express com sessao no servidor, RBAC, perfis e anuncios
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
const STATUS_EDITAVEIS = ['andamento', 'concluido'];
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
app.use(express.static(path.join(__dirname, 'public')));

// Sessao via PostgreSQL (armazenamento persistente no servidor)
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
      secure: false, // Pode ser true em ambiente HTTPS de producao
    },
  })
);

// Rate limit para login/cadastro
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
app.use('/api/auth', limiteAuth);

/* =========================================================
   MIDDLEWARES DE AUTENTICACAO E AUTORIZACAO (RBAC)
========================================================= */

// Exige usuario logado e com conta ATIVA no banco de dados
async function requireAuth(req, res, next) {
  try {
    if (!req.session || !req.session.usuario || !req.session.usuario.id) {
      return res.status(401).json({ erro: 'Acesso restrito. Faca login para continuar.' });
    }

    // Consulta status da conta em tempo real no banco
    const result = await pool.query(
      'SELECT id, nome, email, telefone, cidade, tipo, ativo FROM usuarios WHERE id = $1',
      [req.session.usuario.id]
    );
    const usuarioBanco = result.rows[0];

    if (!usuarioBanco) {
      req.session.destroy(() => {});
      return res.status(401).json({ erro: 'Usuario nao encontrado. Sessao encerrada.' });
    }

    if (usuarioBanco.ativo === false) {
      req.session.destroy(() => {});
      return res.status(403).json({ erro: 'Sua conta esta desativada. Acoes protegidas estao bloqueadas.' });
    }

    // Atualiza dados na sessao e disponibiliza em req.usuario
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

// Exige perfis especificos
function requireRole(...tiposPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ erro: 'Nao autenticado.' });
    }
    if (!tiposPermitidos.includes(req.usuario.tipo)) {
      return res.status(403).json({
        erro: 'Acesso negado: seu perfil (' + req.usuario.tipo + ') nao tem permissao para esta operacao.'
      });
    }
    next();
  };
}

/* =========================================================
   AUTENTICACAO
========================================================= */

// Cadastro publico: cliente ou prestador (NUNCA admin)
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const nome = texto(req.body.nome, 150);
  const email = texto(req.body.email, 150).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  const telefone = texto(req.body.telefone, 30);
  const cidade = texto(req.body.cidade, 100);
  const tipo = req.body.tipo;

  if (!nome || !email || !senha || !tipo) throw new HttpError(400, 'Campos obrigatorios faltando.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail invalido.');
  if (senha.length < 6 || senha.length > 72) throw new HttpError(400, 'A senha deve ter de 6 a 72 caracteres.');

  // REGRA: cadastro publico nunca pode conceder perfil admin
  if (tipo === 'admin') {
    throw new HttpError(403, 'O perfil de administrador nao pode ser criado pelo cadastro publico.');
  }
  if (!TIPOS_CADASTRO.includes(tipo)) {
    throw new HttpError(400, 'Tipo de conta invalido.');
  }
  if (cidade && !CIDADES.includes(cidade)) {
    throw new HttpError(400, 'Cidade invalida.');
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

      // Se for prestador, inicializa seu perfil profissional base na tabela prestadores
      if (tipo === 'prestador') {
        await client.query(
          `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, ativo, visivel)
           VALUES ($1, $2, 'Prestador de Servicos', $3, 0, $4, '', TRUE, TRUE)`,
          [user.id, user.nome, user.cidade || 'Camaquã', user.telefone || '']
        );
      }
      return user;
    });

    // Inicia sessao autenticada no servidor
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
    if (err.code === '23505') throw new HttpError(409, 'E-mail ja cadastrado.');
    throw err;
  }
}));

// Login com sessao no servidor
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = texto(req.body.email, 150).toLowerCase();
  const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
  if (!email || !senha) throw new HttpError(400, 'Informe e-mail e senha.');

  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const usuario = result.rows[0];
  const senhaOk = usuario ? await bcrypt.compare(senha, usuario.senha_hash) : false;
  if (!senhaOk) throw new HttpError(401, 'E-mail ou senha invalidos.');

  // REGRA: Contas desativadas nao podem logar
  if (usuario.ativo === false) {
    throw new HttpError(403, 'Esta conta foi desativada. Entre em contato com a administracao.');
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

// Logout com destruicao da sessao
app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ erro: 'Erro ao encerrar sessao.' });
      res.clearCookie('connect.sid');
      res.json({ mensagem: 'Sessao encerrada com sucesso.' });
    });
  } else {
    res.json({ mensagem: 'Sessao ja encerrada.' });
  }
});

// Verificacao do estado da sessao autenticada
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
   PERFIL PESSOAL E PROFISSIONAL DO PRESTADOR
========================================================= */

// Obter dados do proprio perfil autenticado
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

// Atualizar perfil autenticado (NUNCA permite alterar tipo para admin)
app.put('/api/perfil', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.usuario.id;
  const nome = texto(req.body.nome, 150);
  const telefone = texto(req.body.telefone, 30);
  const cidade = texto(req.body.cidade, 100);
  const descricao = typeof req.body.descricao === 'string' ? texto(req.body.descricao, 2000) : undefined;
  const profissao = typeof req.body.profissao === 'string' ? texto(req.body.profissao, 100) : undefined;

  if (!nome) throw new HttpError(400, 'Nome e obrigatorio.');
  if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade invalida.');

  // REGRA: Impedir elevacao de privilegio
  if (req.body.tipo && req.body.tipo !== req.usuario.tipo) {
    throw new HttpError(403, 'Nao e permitido alterar o perfil de acesso da conta.');
  }

  const result = await pool.query(
    `UPDATE usuarios SET nome = $1, telefone = $2, cidade = $3
     WHERE id = $4
     RETURNING id, nome, email, telefone, cidade, tipo`,
    [nome, telefone, cidade || null, userId]
  );
  const userAtualizado = result.rows[0];

  // Se for prestador, sincroniza os dados do perfil profissional em prestadores
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
   ANUNCIOS (Ofertas de Servico)
========================================================= */

// Listar anuncios publicos (apenas ativos e visiveis de prestadores ativos e visiveis)
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
      AND an.visivel = TRUE
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

// Meus anuncios (prestador autenticado vê todos os seus, inclusive ocultos)
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

// Detalhes do anuncio publico
app.get('/api/anuncios/:id', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'ID de anuncio invalido.');

  const result = await pool.query(
    `SELECT an.*, p.id AS prestador_id, p.nome AS prestador_nome, p.cidade AS prestador_cidade,
            p.contato AS prestador_contato, p.descricao AS prestador_bio, p.usuario_id AS prestador_usuario_id,
            COALESCE(AVG(av.nota), 0)::numeric(3,1) AS rating,
            COUNT(av.id)::int AS avaliacoes
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN avaliacoes av ON av.prestador_id = p.id
     WHERE an.id = $1 AND an.ativo = TRUE
     GROUP BY an.id, p.id, u.id`,
    [id]
  );
  const anuncio = result.rows[0];
  if (!anuncio) throw new HttpError(404, 'Anuncio nao encontrado.');

  const isDono = req.session && req.session.usuario && req.session.usuario.id === anuncio.prestador_usuario_id;
  const isAdmin = req.session && req.session.usuario && req.session.usuario.tipo === 'admin';
  if ((!anuncio.visivel) && !isDono && !isAdmin) {
    throw new HttpError(404, 'Anuncio indisponivel ou oculto.');
  }

  res.json(anuncio);
}));

// Criar anuncio — EXCLUSIVO PARA PRESTADORES ATIVOS
app.post('/api/anuncios', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const userId = req.usuario.id;

  // Busca o prestador vinculado ao usuario autenticado
  let prestadorResult = await pool.query(
    'SELECT id, nome, cidade, contato, ativo, visivel FROM prestadores WHERE usuario_id = $1 AND ativo = TRUE LIMIT 1',
    [userId]
  );
  let prestador = prestadorResult.rows[0];

  if (!prestador) {
    const novoP = await pool.query(
      `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, ativo, visivel)
       VALUES ($1, $2, 'Prestador de Servicos', $3, 0, $4, '', TRUE, TRUE)
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
    throw new HttpError(400, 'Titulo, descricao e categoria sao campos obrigatorios.');
  }
  if (preco !== null && (!Number.isFinite(preco) || preco < 0 || preco > 99999999)) {
    throw new HttpError(400, 'Preco invalido.');
  }

  const ins = await pool.query(
    `INSERT INTO anuncios (prestador_id, titulo, descricao, categoria, regiao, preco, foto_url, ativo, visivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
     RETURNING *`,
    [prestador.id, titulo, descricao, categoria, regiao, preco, fotoUrl]
  );

  res.status(201).json(ins.rows[0]);
}));

// Editar anuncio — SOMENTE O PROPRIO PRESTADOR
app.put('/api/anuncios/:id', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anuncio invalido.');

  const donoCheck = await pool.query(
    `SELECT an.id, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!donoCheck.rows[0]) throw new HttpError(404, 'Anuncio nao encontrado.');
  if (donoCheck.rows[0].usuario_id !== req.usuario.id) {
    throw new HttpError(403, 'Voce so pode editar seus proprios anuncios.');
  }

  const titulo = texto(req.body.titulo, 200);
  const descricao = texto(req.body.descricao, 2000);
  const categoria = texto(req.body.categoria, 100);
  const regiao = texto(req.body.regiao, 100);
  const preco = req.body.preco !== undefined && req.body.preco !== '' ? Number(req.body.preco) : null;
  const fotoUrl = urlHttpValida(texto(req.body.foto_url, 500));

  if (!titulo || !descricao || !categoria || !regiao) {
    throw new HttpError(400, 'Titulo, descricao, categoria e regiao sao obrigatorios.');
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

// Alternar visibilidade do anuncio (Ocultar / Mostrar) — Dono ou Admin
app.put('/api/anuncios/:id/visibilidade', requireAuth, asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anuncio invalido.');

  const anCheck = await pool.query(
    `SELECT an.id, an.visivel, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!anCheck.rows[0]) throw new HttpError(404, 'Anuncio nao encontrado.');

  const isDono = anCheck.rows[0].usuario_id === req.usuario.id;
  const isAdmin = req.usuario.tipo === 'admin';
  if (!isDono && !isAdmin) {
    throw new HttpError(403, 'Voce so pode alterar a visibilidade de seus proprios anuncios.');
  }

  const novoVisivel = typeof req.body.visivel === 'boolean' ? req.body.visivel : !anCheck.rows[0].visivel;

  const upd = await pool.query(
    'UPDATE anuncios SET visivel = $1, atualizado_em = NOW() WHERE id = $2 RETURNING *',
    [novoVisivel, id]
  );

  if (isAdmin && !isDono) {
    await pool.query(
      `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo)
       VALUES ($1, $2, 'anuncio', $3, $4)`,
      [req.usuario.id, novoVisivel ? 'mostrar' : 'ocultar', id, texto(req.body.motivo, 500) || null]
    );
  }

  res.json(upd.rows[0]);
}));

// Exclusao logica de anuncio — Dono ou Admin
app.delete('/api/anuncios/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Anuncio invalido.');

  const anCheck = await pool.query(
    `SELECT an.id, p.usuario_id
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     WHERE an.id = $1 AND an.ativo = TRUE`,
    [id]
  );
  if (!anCheck.rows[0]) throw new HttpError(404, 'Anuncio nao encontrado.');

  const isDono = anCheck.rows[0].usuario_id === req.usuario.id;
  const isAdmin = req.usuario.tipo === 'admin';
  if (!isDono && !isAdmin) {
    throw new HttpError(403, 'Voce so pode remover seus proprios anuncios.');
  }

  // Soft delete: ativo = FALSE
  await pool.query('UPDATE anuncios SET ativo = FALSE, visivel = FALSE, atualizado_em = NOW() WHERE id = $1', [id]);

  if (isAdmin && !isDono) {
    await pool.query(
      `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo)
       VALUES ($1, 'desativar', 'anuncio', $2, $3)`,
      [req.usuario.id, id, texto(req.body.motivo, 500) || 'Exclusao logica administrativa']
    );
  }

  res.json({ mensagem: 'Anuncio desativado com sucesso (registro preservado).' });
}));

// Categorias unicas de anuncios
app.get('/api/categorias-anuncios', asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT an.categoria
     FROM anuncios an
     JOIN prestadores p ON p.id = an.prestador_id
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE an.ativo = TRUE AND an.visivel = TRUE AND p.ativo = TRUE AND p.visivel = TRUE AND u.ativo = TRUE
     ORDER BY an.categoria`
  );
  res.json(result.rows.map((r) => r.categoria));
}));

/* =========================================================
   PRESTADORES / BUSCA E COMPATIBILIDADE
========================================================= */

// Listagem de prestadores
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

// Meus servicos/prestadores cadastrados pelo usuario autenticado
app.get('/api/prestadores/usuario/:usuarioId', requireAuth, asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.params.usuarioId);
  if (!usuarioId) throw new HttpError(400, 'Usuario invalido.');

  if (req.usuario.tipo !== 'admin' && req.usuario.id !== usuarioId) {
    throw new HttpError(403, 'Voce so pode consultar seus proprios registros.');
  }

  const result = await pool.query(
    'SELECT * FROM prestadores WHERE usuario_id = $1 AND ativo = TRUE ORDER BY criado_em DESC',
    [usuarioId]
  );
  res.json(result.rows);
}));

// Detalhes do prestador + anuncios dele + avaliacoes
app.get('/api/prestadores/:id', asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Prestador invalido.');

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
  if (!prestador) throw new HttpError(404, 'Prestador nao encontrado ou inativo.');

  // Avaliacoes do prestador
  const comentarios = await pool.query(
    `SELECT a.nota, a.comentario, a.criado_em, COALESCE(u.nome, 'Cliente') AS autor
     FROM avaliacoes a
     LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.prestador_id = $1
     ORDER BY a.criado_em DESC`,
    [id]
  );

  // Anuncios ativos e visiveis deste prestador
  const anuncios = await pool.query(
    `SELECT * FROM anuncios
     WHERE prestador_id = $1 AND ativo = TRUE AND visivel = TRUE
     ORDER BY criado_em DESC`,
    [id]
  );

  // Historico publico de servicos concluidos (SEM expor dados privados dos clientes)
  const historicoConcluido = await pool.query(
    `SELECT h.id, h.servico, h.status, h.data_solicitacao
     FROM historico h
     WHERE h.prestador_id = $1 AND h.status IN ('concluido', 'avaliado')
     ORDER BY h.data_solicitacao DESC`,
    [id]
  );

  res.json({
    ...prestador,
    comentarios: comentarios.rows,
    anuncios: anuncios.rows,
    historicoConcluido: historicoConcluido.rows,
  });
}));

// Lista de profissoes
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

// Cadastrar prestador/perfil profissional — SOMENTE PRESTADOR AUTENTICADO
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
    throw new HttpError(400, 'Campos obrigatorios faltando (profissao, cidade e contato).');
  }
  if (!CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade invalida.');
  if (!Number.isFinite(preco) || preco < 0 || preco > 99999999) throw new HttpError(400, 'Preco invalido.');

  const result = await pool.query(
    `INSERT INTO prestadores (usuario_id, nome, profissao, cidade, preco, contato, descricao, foto_url, ativo, visivel)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE)
     RETURNING *`,
    [usuarioId, nome, profissao, cidade, preco, contato, descricao, fotoUrl]
  );
  res.status(201).json(result.rows[0]);
}));

// Editar prestador — SOMENTE O PROPRIO PRESTADOR
app.put('/api/prestadores/:id', requireAuth, requireRole('prestador'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'ID invalido.');

  const check = await pool.query('SELECT * FROM prestadores WHERE id = $1', [id]);
  const p = check.rows[0];
  if (!p) throw new HttpError(404, 'Prestador nao encontrado.');
  if (p.usuario_id !== req.usuario.id) {
    throw new HttpError(403, 'Voce so pode editar seu proprio perfil profissional.');
  }

  const profissao = texto(req.body.profissao, 100) || p.profissao;
  const cidade = texto(req.body.cidade, 100) || p.cidade;
  const preco = req.body.preco !== undefined ? Number(req.body.preco) : p.preco;
  const contato = texto(req.body.contato, 30) || p.contato;
  const descricao = req.body.descricao !== undefined ? texto(req.body.descricao, 2000) : p.descricao;
  const fotoUrl = req.body.foto_url !== undefined ? urlHttpValida(texto(req.body.foto_url, 500)) : p.foto_url;

  if (cidade && !CIDADES.includes(cidade)) throw new HttpError(400, 'Cidade invalida.');

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
   HISTORICO E SOLICITACOES (Preservado e protegido com sessao)
========================================================= */

app.get('/api/historico/:usuarioId', requireAuth, asyncHandler(async (req, res) => {
  const usuarioId = inteiroPositivo(req.params.usuarioId);
  if (!usuarioId) throw new HttpError(400, 'Usuario invalido.');

  if (req.usuario.tipo !== 'admin' && req.usuario.id !== usuarioId) {
    throw new HttpError(403, 'Voce so pode acessar seu proprio historico.');
  }

  const result = await pool.query(
    `SELECT h.*, p.nome AS prestador_nome
     FROM historico h
     JOIN prestadores p ON p.id = h.prestador_id
     WHERE h.usuario_id = $1
     ORDER BY h.data_solicitacao DESC`,
    [usuarioId]
  );
  res.json(result.rows);
}));

app.post('/api/historico', requireAuth, asyncHandler(async (req, res) => {
  const usuarioId = req.usuario.id;
  const prestadorId = inteiroPositivo(req.body.prestador_id);
  const servico = texto(req.body.servico, 100);

  if (!prestadorId) throw new HttpError(400, 'Prestador invalido.');

  const prestRes = await pool.query('SELECT * FROM prestadores WHERE id = $1 AND ativo = TRUE', [prestadorId]);
  const prest = prestRes.rows[0];
  if (!prest) throw new HttpError(404, 'Prestador nao encontrado ou inativo.');

  // REGRA: Prestador nao pode solicitar servico para si mesmo
  if (prest.usuario_id === usuarioId) {
    throw new HttpError(400, 'Nao e permitido solicitar atendimento para o seu proprio perfil.');
  }

  const registro = await comTransacao(async (client) => {
    const ins = await client.query(
      'INSERT INTO historico (usuario_id, prestador_id, servico) VALUES ($1, $2, $3) RETURNING *',
      [usuarioId, prestadorId, servico || prest.profissao]
    );
    await client.query('UPDATE prestadores SET requisicoes = requisicoes + 1 WHERE id = $1', [prestadorId]);
    return ins.rows[0];
  });
  res.status(201).json(registro);
}));

app.put('/api/historico/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  const status = req.body.status;
  if (!id) throw new HttpError(400, 'Dados invalidos.');
  if (!STATUS_EDITAVEIS.includes(status)) throw new HttpError(400, 'Status invalido.');

  const histCheck = await pool.query(
    `SELECT h.*, p.usuario_id AS prestador_usuario_id
     FROM historico h
     JOIN prestadores p ON p.id = h.prestador_id
     WHERE h.id = $1`,
    [id]
  );
  const hist = histCheck.rows[0];
  if (!hist) throw new HttpError(404, 'Solicitacao nao encontrada.');

  const isCliente = hist.usuario_id === req.usuario.id;
  const isPrestador = hist.prestador_usuario_id === req.usuario.id;
  const isAdmin = req.usuario.tipo === 'admin';

  if (!isCliente && !isPrestador && !isAdmin) {
    throw new HttpError(403, 'Voce nao tem permissao para alterar esta solicitacao.');
  }

  if (status === 'concluido' && !isPrestador && !isAdmin) {
    throw new HttpError(403, 'Apenas o prestador responsavel pelo atendimento pode informar a conclusao.');
  }

  const result = await pool.query(
    `UPDATE historico SET status = $1
     WHERE id = $2 AND status <> 'avaliado'
     RETURNING *`,
    [status, id]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Solicitacao nao pode ser alterada ou ja avaliada.');
  res.json(result.rows[0]);
}));

/* =========================================================
   AVALIACOES
========================================================= */

app.post('/api/avaliacoes', requireAuth, asyncHandler(async (req, res) => {
  const prestadorId = inteiroPositivo(req.body.prestador_id);
  const historicoId = inteiroPositivo(req.body.historico_id);
  const usuarioId = req.usuario.id;
  const nota = Number(req.body.nota);
  const comentario = texto(req.body.comentario, 1000);

  if (!prestadorId || !historicoId) throw new HttpError(400, 'Dados invalidos.');
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new HttpError(400, 'A nota deve ser de 1 a 5.');

  const avaliacao = await comTransacao(async (client) => {
    // REGRA: Prestador nao pode avaliar o proprio trabalho
    const pCheck = await client.query('SELECT usuario_id FROM prestadores WHERE id = $1', [prestadorId]);
    if (pCheck.rows[0] && pCheck.rows[0].usuario_id === usuarioId) {
      throw new HttpError(403, 'Prestadores nao podem avaliar o proprio perfil.');
    }

    // REGRA: Somente o cliente vinculado a solicitacao concluida pode avaliar, uma unica vez
    const marcado = await client.query(
      `UPDATE historico SET status = 'avaliado'
       WHERE id = $1 AND usuario_id = $2 AND prestador_id = $3 AND status = 'concluido'
       RETURNING id`,
      [historicoId, usuarioId, prestadorId]
    );
    if (!marcado.rows[0]) {
      throw new HttpError(409, 'Este servico nao esta disponivel para avaliacao (deve estar concluido e pertencer a voce).');
    }

    const ins = await client.query(
      'INSERT INTO avaliacoes (prestador_id, usuario_id, nota, comentario) VALUES ($1, $2, $3, $4) RETURNING *',
      [prestadorId, usuarioId, nota, comentario]
    );
    return ins.rows[0];
  });

  res.status(201).json(avaliacao);
}));

/* =========================================================
   ADMINISTRACAO (Base para Etapa 3)
========================================================= */

// Alternar status ativo de usuario (Desativar / Reativar)
app.put('/api/admin/usuarios/:id/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Usuario invalido.');
  if (typeof req.body.ativo !== 'boolean') throw new HttpError(400, 'Campo ativo (booleano) obrigatorio.');
  const motivo = texto(req.body.motivo, 500) || 'Acao administrativa';

  const userRes = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
  const user = userRes.rows[0];
  if (!user) throw new HttpError(404, 'Usuario nao encontrado.');

  const result = await pool.query(
    'UPDATE usuarios SET ativo = $1 WHERE id = $2 RETURNING id, nome, email, tipo, ativo',
    [req.body.ativo, id]
  );

  await pool.query(
    `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo, dados_anteriores)
     VALUES ($1, $2, 'usuarios', $3, $4, $5)`,
    [
      req.usuario.id,
      req.body.ativo ? 'reativar_usuario' : 'desativar_usuario',
      id,
      motivo,
      JSON.stringify({ ativo_anterior: user.ativo }),
    ]
  );

  res.json(result.rows[0]);
}));

// Alternar visibilidade de prestador
app.put('/api/admin/prestadores/:id/visibilidade', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = inteiroPositivo(req.params.id);
  if (!id) throw new HttpError(400, 'Prestador invalido.');
  if (typeof req.body.visivel !== 'boolean') throw new HttpError(400, 'Campo visivel obrigatorio.');
  const motivo = texto(req.body.motivo, 500) || 'Alteracao de visibilidade administrativa';

  const result = await pool.query(
    'UPDATE prestadores SET visivel = $1 WHERE id = $2 RETURNING *',
    [req.body.visivel, id]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Prestador nao encontrado.');

  await pool.query(
    `INSERT INTO log_admin (admin_id, acao, entidade, entidade_id, motivo)
     VALUES ($1, $2, 'prestadores', $3, $4)`,
    [req.usuario.id, req.body.visivel ? 'mostrar_prestador' : 'ocultar_prestador', id, motivo]
  );

  res.json(result.rows[0]);
}));

/* =========================================================
   TRATAMENTO DE ERROS E ROTA NAO ENCONTRADA
========================================================= */
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota nao encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON invalido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Requisicao grande demais.' });
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });

  const erroPg = {
    '23505': [409, 'Registro ja existe.'],
    '23503': [400, 'Referencia invalida (usuario ou prestador inexistente).'],
    '23514': [400, 'Valor invalido.'],
    '22P02': [400, 'Formato de dado invalido.'],
  }[err.code];
  if (erroPg) return res.status(erroPg[0]).json({ erro: erroPg[1] });

  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

process.on('unhandledRejection', (motivo) => {
  console.error('Rejeicao nao tratada:', motivo);
});

/* =========================================================
   INICIALIZACAO
========================================================= */
async function iniciar() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('\n[ERRO] Nao foi possivel conectar ao PostgreSQL:', err.message || err.code || err);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

iniciar();
