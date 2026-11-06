/* =============================================
   SERVIÇO FÁCIL — main.js
   Gerenciamento de sessão, autenticação, perfis e anúncios.
============================================= */

const API = '/api';

function lerUsuarioSalvo() {
  try {
    return JSON.parse(localStorage.getItem('cs_currentUser')) || null;
  } catch {
    return null;
  }
}

let currentUser = lerUsuarioSalvo();

/* ---------- SEGURANÇA: escape de HTML e URLs ---------- */
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function urlImagemSegura(valor) {
  if (!valor) return '';
  try {
    const u = new URL(valor);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.replace(/['"()\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  } catch {
    return '';
  }
}

/* ---------- HELPER DE REQUISIÇÃO (COM CREDENCIAIS DE SESSÃO) ---------- */
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // Envia cookies de sessão HTTP-Only
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Erro na requisição.');
  return data;
}

/* ---------- MENU MOBILE ---------- */
const navToggle = document.getElementById('navToggle');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    document.querySelector('.site-header').classList.toggle('open');
  });
}

/* ---------- ÁREA LOGADA NO HEADER ---------- */
function renderAuthArea() {
  const area = document.getElementById('authArea');
  if (!area) return;

  document.querySelectorAll('[data-role]').forEach(item => { item.hidden = item.dataset.role !== currentUser?.tipo; });
  if (currentUser) {
    const primeiroNome = String(currentUser.nome || '').split(' ')[0];
    area.innerHTML = `
      <div class="auth-user-group">
        <span class="auth-user-greeting">Olá, ${escapeHtml(primeiroNome)}</span>
        <button class="btn btn-ghost" id="logoutBtn" type="button">Sair</button>
      </div>
    `;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } catch (err) {
          alert(err.message);
          return;
        }
        currentUser = null;
        localStorage.removeItem('cs_currentUser');
        window.location.href = 'index.html';
      });
    }
  } else {
    area.innerHTML = `
      <a class="btn btn-ghost" href="login.html">Entrar</a>
      <a class="btn btn-accent" href="cadastro.html">Cadastrar</a>
    `;
  }
}

// Sincroniza sessão do servidor na inicialização
async function sincronizarSessao() {
  try {
    const usuarioAtivo = await api('/auth/me');
    if (usuarioAtivo) {
      currentUser = usuarioAtivo;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));
    } else {
      currentUser = null;
      localStorage.removeItem('cs_currentUser');
    }
  } catch {
    currentUser = null;
    localStorage.removeItem('cs_currentUser');
  }
  renderAuthArea();
}
const sessaoPronta = sincronizarSessao();
async function mostrarContato() {
  const contato = document.querySelector('.contato-admin');
  if (!contato) return;
  try {
    const { email } = await api('/contato-administrativo');
    if (email) {
      const link = document.createElement('a');
      link.href = 'mailto:' + email;
      link.textContent = email;
      contato.replaceChildren('Contato com a administração: ', link);
    }
  } catch { contato.textContent = 'Contato administrativo indisponível.'; }
}
mostrarContato();

/* ---------- CARDS E RATINGS ---------- */
function starsHtml(rating) {
  const full = Math.min(5, Math.max(0, Math.round(Number(rating) || 0)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function ratingHtml(rating, quantidade) {
  return Number(quantidade) > 0 ? `${starsHtml(rating)} (${Number(quantidade)})` : 'Sem avaliações';
}

function cardTemplate(p) {
  const foto = urlImagemSegura(p.foto_url);
  const photoStyle = foto ? `style="background-image:url('${escapeHtml(foto)}')"` : '';
  const inicial = foto ? '' : escapeHtml(String(p.nome || '?').charAt(0));
  const id = Number(p.id);
  return `
  <div class="card">
    <div class="card__photo" ${photoStyle}>${inicial}</div>
    <div class="card__body">
      <div class="card__name">${escapeHtml(p.nome)}</div>
      <div class="card__profession">${escapeHtml(p.profissao)}</div>
      <div class="card__city">📍 ${escapeHtml(p.cidade)}</div>
      <div class="card__rating">${ratingHtml(p.rating, p.avaliacoes)}</div>
      <div class="card__price">R$ ${Number(p.preco || 0).toFixed(2)}</div>
    </div>
    <div class="card__actions">
      <button type="button" class="btn btn-secondary" data-action="ver-perfil" data-id="${id}">Ver perfil</button>
      <button type="button" class="btn btn-accent" data-action="contatar" data-id="${id}"
        data-contato="${escapeHtml(p.contato)}" data-servico="${escapeHtml(p.profissao)}">Contato</button>
    </div>
  </div>`;
}

function contatarPrestador(prestadorId, contato, servico) {
  const digitos = String(contato || '').replace(/\D/g, '');
  const numero = digitos.startsWith('55') && digitos.length > 11 ? digitos : '55' + digitos;
  window.open(`https://wa.me/${numero}`, '_blank', 'noopener');
}

/* ---------- MODAL DE PERFIL DO PRESTADOR ---------- */
function getProviderModal() {
  let modal = document.getElementById('providerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal hidden';
    modal.id = 'providerModal';
    modal.innerHTML = `
      <div class="modal__box" style="max-width:550px;">
        <button class="modal__close" id="closeProviderModal" type="button">×</button>
        <div id="providerModalContent"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  return modal;
}

async function openProviderModal(id) {
  const modal = getProviderModal();
  try {
    await sessaoPronta;
    const p = await api(`/prestadores/${id}`);
    const comentariosHtml = p.comentarios && p.comentarios.length
      ? p.comentarios.map((c) => `
          <p style="margin-top:8px;"><strong>${escapeHtml(c.autor)}</strong>: ${starsHtml(c.nota)}<br>${escapeHtml(c.comentario || '')}</p>`).join('')
      : '<p style="opacity:.7;">Ainda sem comentários.</p>';

    const anunciosHtml = p.anuncios && p.anuncios.length
      ? p.anuncios.map((an) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong>${escapeHtml(an.titulo)}</strong>
              <span style="font-weight:700; color:#0f172a;">${an.preco ? 'R$ ' + Number(an.preco).toFixed(2) : 'A combinar'}</span>
            </div>
            <span style="font-size:0.8rem; color:#0284c7;">${escapeHtml(an.categoria)}</span>
            <p style="font-size:0.85rem; margin:6px 0;">${escapeHtml(an.descricao)}</p>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
              <span style="font-size:0.8rem; color:#64748b;">📍 ${escapeHtml(an.regiao)}</span>
              ${currentUser?.tipo === 'cliente' ? `<a class="btn btn-accent" href="historico.html?anuncio=${Number(an.id)}">Solicitar serviço</a>` : ''}
            </div>
          </div>`).join('')
      : '<p style="opacity:.7;">Nenhum anúncio avulso ativo no momento.</p>';

    document.getElementById('providerModalContent').innerHTML = `
      <h3>${escapeHtml(p.nome)}</h3>
      <p><strong>${escapeHtml(p.profissao)}</strong> · ${escapeHtml(p.cidade)}</p>
      <p class="card__rating">${ratingHtml(p.rating, p.avaliacoes)}</p>
      <p style="margin:12px 0;">${escapeHtml(p.descricao || 'Sem descrição informada.')}</p>
      <p><strong>Preço de referência:</strong> R$ ${Number(p.preco || 0).toFixed(2)}</p>
      <p><strong>Contato:</strong> ${escapeHtml(p.contato)}</p>
      <button type="button" class="btn btn-accent btn-block" data-action="contatar" data-id="${Number(p.id)}"
        data-contato="${escapeHtml(p.contato)}" data-servico="${escapeHtml(p.profissao)}" style="margin-top:10px;">Chamar no WhatsApp</button>

      <hr style="margin:14px 0;">
      <h4>Serviços e Anúncios Oferecidos</h4>
      ${anunciosHtml}

      <hr style="margin:14px 0;">
      <h4>Atendimentos concluídos</h4>
      ${p.historicoConcluido.map(o => `<p>Serviço concluído em ${escapeHtml(o.cidade)} · ${new Date(o.data_conclusao).toLocaleDateString('pt-BR')}</p>`).join('') || '<p>Nenhum atendimento concluído.</p>'}
      <hr><h4>Avaliações de Clientes</h4>
      ${comentariosHtml}
    `;
    modal.classList.remove('hidden');
  } catch (err) {
    alert('Erro ao carregar perfil: ' + err.message);
  }
}

/* ---------- CLIQUES GLOBAIS ---------- */
document.addEventListener('click', (e) => {
  const modal = document.getElementById('providerModal');
  if (modal && (e.target.id === 'closeProviderModal' || e.target === modal)) {
    modal.classList.add('hidden');
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'ver-perfil') openProviderModal(Number(d.id));
  else if (d.action === 'contatar') contatarPrestador(Number(d.id), d.contato, d.servico);
  else if (d.action === 'categoria') location.href = `busca.html?profissao=${encodeURIComponent(d.profissao)}`;
});

/* =========================================================
   PÁGINA: index.html (HOME)
========================================================= */
const featuredGrid = document.getElementById('featuredGrid');
if (featuredGrid) {
  (async () => {
    try {
      const prestadores = await api('/prestadores?ordenar=relevancia');
      featuredGrid.innerHTML = prestadores.slice(0, 3).map(cardTemplate).join('')
        || '<p>Ainda não há prestadores cadastrados.</p>';
    } catch (err) {
      featuredGrid.innerHTML = `<p>Não foi possível carregar prestadores (${escapeHtml(err.message)}).</p>`;
    }
  })();

  (async () => {
    try {
      const professions = await api('/profissoes');
      document.getElementById('categoryChips').innerHTML = professions.map((prof) =>
        `<span class="chip" data-action="categoria" data-profissao="${escapeHtml(prof)}">${escapeHtml(prof)}</span>`).join('');
    } catch (err) { console.warn(err); }
  })();

  const heroBtn = document.getElementById('heroSearchBtn');
  if (heroBtn) {
    heroBtn.addEventListener('click', () => {
      const q = document.getElementById('heroSearchInput').value;
      const cidade = document.getElementById('heroCitySelect').value;
      location.href = `busca.html?busca=${encodeURIComponent(q)}&cidade=${encodeURIComponent(cidade)}`;
    });
  }
}

/* =========================================================
   PÁGINA: busca.html
========================================================= */
const resultsGrid = document.getElementById('resultsGrid');
if (resultsGrid) {
  const urlParams = new URLSearchParams(window.location.search);
  let sequencia = 0;
  let timer = null;

  async function populateProfessionFilter() {
    const select = document.getElementById('filterProfession');
    try {
      const professions = await api('/profissoes');
      select.innerHTML = '<option value="">Todas</option>'
        + professions.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
      if (urlParams.get('profissao')) select.value = urlParams.get('profissao');
    } catch (err) { console.warn(err); }
  }

  async function renderResults() {
    const minha = ++sequencia;
    const params = new URLSearchParams({
      busca: document.getElementById('filterKeyword').value,
      cidade: document.getElementById('filterCity').value,
      profissao: document.getElementById('filterProfession').value,
      precoMax: document.getElementById('filterPrice').value,
      ordenar: document.getElementById('filterSort').value,
    });
    document.getElementById('resultsCount').textContent = 'Carregando...';
    try {
      const prestadores = await api('/prestadores?' + params.toString());
      if (minha !== sequencia) return;
      document.getElementById('resultsCount').textContent = `${prestadores.length} prestador(es) encontrado(s)`;
      resultsGrid.innerHTML = prestadores.length
        ? prestadores.map(cardTemplate).join('')
        : '<p>Nenhum prestador encontrado com esses filtros.</p>';
    } catch (err) {
      if (minha !== sequencia) return;
      document.getElementById('resultsCount').textContent = '';
      resultsGrid.innerHTML = `<p>Erro ao buscar: ${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById('filterKeyword').value = urlParams.get('busca') || '';
  document.getElementById('filterCity').value = urlParams.get('cidade') || '';

  document.getElementById('filterKeyword').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(renderResults, 300);
  });
  ['filterCity', 'filterProfession', 'filterSort'].forEach((id) =>
    document.getElementById(id).addEventListener('input', renderResults));

  document.getElementById('filterPrice').addEventListener('input', (e) => {
    document.getElementById('priceValue').textContent = `R$ ${e.target.value}`;
    clearTimeout(timer);
    timer = setTimeout(renderResults, 200);
  });

  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterKeyword').value = '';
    document.getElementById('filterCity').value = '';
    document.getElementById('filterProfession').value = '';
    document.getElementById('filterPrice').value = 500;
    document.getElementById('priceValue').textContent = 'R$ 500';
    document.getElementById('filterSort').value = 'relevancia';
    renderResults();
  });

  populateProfessionFilter().then(renderResults);
}

/* =========================================================
   PÁGINA: login.html
========================================================= */
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const senha = document.getElementById('loginPassword').value;
    const msg = document.getElementById('loginMsg');
    try {
      const usuario = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, senha }) });
      currentUser = usuario;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));
      msg.className = 'form-msg success';
      msg.textContent = 'Login realizado com sucesso! Redirecionando...';
      setTimeout(() => {
        window.location.href = usuario.tipo === 'admin' ? 'admin.html' : usuario.tipo === 'prestador' ? 'perfil.html' : 'historico.html';
      }, 700);
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  });
}

/* =========================================================
   PÁGINA: cadastro.html
========================================================= */
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = document.querySelector('input[name="tipoConta"]:checked').value;
    const msg = document.getElementById('regMsg');
    const payload = {
      nome: document.getElementById('regNome').value,
      cidade: document.getElementById('regCidade').value,
      email: document.getElementById('regEmail').value,
      telefone: document.getElementById('regTelefone').value,
      senha: document.getElementById('regSenha').value,
      tipo,
    };
    try {
      const usuario = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      currentUser = usuario;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));
      msg.className = 'form-msg success';
      msg.textContent = 'Cadastro realizado com sucesso!';
      setTimeout(() => {
        window.location.href = tipo === 'prestador' ? 'perfil.html' : 'index.html';
      }, 700);
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  });
}

/* =========================================================
   PÁGINA: perfil.html (PAINEL DO PRESTADOR — ETAPA 2)
========================================================= */
const providerMainLayout = document.getElementById('providerMainLayout');
if (providerMainLayout) {
  let meusAnunciosList = [];

  // Controle de abas
  document.querySelectorAll('.provider-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.provider-tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      tabBtn.classList.add('active');
      const paneId = tabBtn.dataset.tab;
      const pane = document.getElementById(paneId);
      if (pane) pane.classList.add('active');
    });
  });

  async function inicializarPainelPrestador() {
    try {
      const me = await api('/auth/me');
      if (!me) {
        window.location.href = 'login.html';
        return;
      }
      currentUser = me;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));

      if (currentUser.tipo !== 'prestador') {
        document.getElementById('notProviderWarning').classList.remove('hidden');
        providerMainLayout.classList.add('hidden');
        return;
      }

      const perfilCompleto = await api('/perfil');
      document.getElementById('profNome').value = perfilCompleto.nome || '';
      document.getElementById('profCidade').value = perfilCompleto.cidade || '';
      document.getElementById('profContato').value = perfilCompleto.telefone || '';
      if (perfilCompleto.perfilPrestador) {
        document.getElementById('profEspecialidades').value = perfilCompleto.perfilPrestador.profissao || '';
        document.getElementById('profDescricao').value = perfilCompleto.perfilPrestador.descricao || '';
      }
      document.getElementById('adPrestadorNome').value = perfilCompleto.nome + ' (' + (perfilCompleto.cidade || 'Região') + ')';

      await Promise.all([
        carregarOportunidades(),
        carregarPedidosDirecionados(),
        carregarMeusAtendimentos(),
        carregarMeusAnuncios(),
      ]);
    } catch (err) {
      console.error('Erro ao inicializar painel do prestador:', err);
    }
  }

  // 1. OPORTUNIDADES ABERTAS
  async function carregarOportunidades() {
    const grid = document.getElementById('oportunidadesGrid');
    if (!grid) return;
    const params = new URLSearchParams({
      busca: document.getElementById('filtroOportunidadeBusca').value,
      cidade: document.getElementById('filtroOportunidadeCidade').value,
      categoria: document.getElementById('filtroOportunidadeCategoria').value,
    });

    try {
      const ops = await api('/ordens/oportunidades?' + params.toString());
      const badge = document.getElementById('badgeOportunidades');
      if (badge) {
        if (ops.length > 0) {
          badge.textContent = ops.length;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      if (!ops || ops.length === 0) {
        grid.innerHTML = '<p style="color:#64748b;">Nenhuma oportunidade aberta encontrada no momento com estes filtros.</p>';
        return;
      }

      grid.innerHTML = ops.map((o) => `
        <div class="opportunity-card" id="op-card-${o.id}">
          <div class="opportunity-card__header">
            <div>
              <h4 style="font-size:1.1rem; color:var(--secondary); margin-bottom:4px;">${escapeHtml(o.titulo)}</h4>
              <span class="badge" style="background:#e0f2fe; color:#0369a1;">${escapeHtml(o.categoria)}</span>
            </div>
            <span class="badge badge--visivel">Aberta para Aceite</span>
          </div>

          <p style="font-size:0.92rem; color:#334155; margin:8px 0;">${escapeHtml(o.descricao)}</p>

          <div style="font-size:0.85rem; color:#64748b; border-top:1px solid #f1f5f9; padding-top:8px; display:flex; flex-direction:column; gap:4px;">
            <span>📍 <strong>Localização:</strong> ${escapeHtml(o.bairro)}, ${escapeHtml(o.cidade)}</span>
            ${o.periodo_desejado ? `<span>⏰ <strong>Período Desejado:</strong> ${escapeHtml(o.periodo_desejado)}</span>` : ''}
            <span>👤 <strong>Solicitante:</strong> ${escapeHtml(o.cliente_primeiro_nome)}</span>
            <span>📅 <strong>Publicado em:</strong> ${new Date(o.criado_em).toLocaleDateString('pt-BR')}</span>
          </div>

          <button class="btn btn-accent btn-block" style="margin-top:10px;" data-comando="aceitarOrdem" data-id="${o.id}">🤝 Aceitar esta Oportunidade</button>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<p class="form-msg error">Erro ao carregar oportunidades: ${escapeHtml(err.message)}</p>`;
    }
  }

  const btnFiltroOps = document.getElementById('btnFiltrarOportunidades');
  if (btnFiltroOps) btnFiltroOps.addEventListener('click', carregarOportunidades);

  // 2. PEDIDOS DIRECIONADOS
  async function carregarPedidosDirecionados() {
    const grid = document.getElementById('pedidosDirecionadosGrid');
    if (!grid) return;
    try {
      const pedidos = await api('/ordens/recebidas');
      const badge = document.getElementById('badgeDirecionados');
      if (badge) {
        if (pedidos.length > 0) {
          badge.textContent = pedidos.length;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      if (!pedidos || pedidos.length === 0) {
        grid.innerHTML = '<p style="color:#64748b;">Nenhum novo pedido direcionado aguardando sua resposta.</p>';
        return;
      }

      grid.innerHTML = pedidos.map((p) => `
        <div class="opportunity-card" id="dir-card-${p.id}" style="border-left:4px solid #f59e0b;">
          <div class="opportunity-card__header">
            <div>
              <h4 style="font-size:1.1rem; color:var(--secondary); margin-bottom:4px;">${escapeHtml(p.titulo)}</h4>
              <span class="badge" style="background:#fef3c7; color:#b45309;">Aguardando sua Resposta</span>
            </div>
            ${p.anuncio_preco_snapshot ? `<span style="font-weight:700;">Ref: R$ ${Number(p.anuncio_preco_snapshot).toFixed(2)}</span>` : ''}
          </div>

          <p style="font-size:0.92rem; color:#334155; margin:8px 0;">${escapeHtml(p.descricao)}</p>

          <div style="font-size:0.85rem; color:#64748b; border-top:1px solid #f1f5f9; padding-top:8px; display:flex; flex-direction:column; gap:4px;">
            <span>👤 <strong>Cliente:</strong> ${escapeHtml(p.cliente_nome)} (${escapeHtml(p.cliente_cidade)})</span>
            <span>📍 <strong>Bairro:</strong> ${escapeHtml(p.bairro)}</span>
            ${p.periodo_desejado ? `<span>⏰ <strong>Período Desejado:</strong> ${escapeHtml(p.periodo_desejado)}</span>` : ''}
          </div>

          <div style="display:flex; gap:8px; margin-top:12px;">
            ${p.pode_aceitar ? `<button class="btn btn-accent" style="flex:1;" data-comando="aceitarOrdem" data-id="${p.id}">✅ Aceitar pedido</button>` : '<span>O anúncio está indisponível para aceite.</span>'}
            <button class="btn btn-secondary" style="flex:1; background:#fee2e2; color:#b91c1c;" data-comando="abrirModalRecusa" data-id="${p.id}">❌ Recusar Pedido</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<p class="form-msg error">Erro ao carregar pedidos: ${escapeHtml(err.message)}</p>`;
    }
  }

  // 3. MEUS ATENDIMENTOS ASSUMIDOS
  async function carregarMeusAtendimentos() {
    const grid = document.getElementById('meusAtendimentosGrid');
    if (!grid) return;
    try {
      const atendimentos = await api('/ordens/atendimentos');
      const badge = document.getElementById('badgeAtendimentos');
      const emAndamentoCount = atendimentos.filter((a) => a.status === 'aceita' || a.status === 'em_andamento').length;
      if (badge) {
        if (emAndamentoCount > 0) {
          badge.textContent = emAndamentoCount;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }

      if (!atendimentos || atendimentos.length === 0) {
        grid.innerHTML = '<p style="color:#64748b;">Você ainda não possui atendimentos assumidos.</p>';
        return;
      }

      grid.innerHTML = atendimentos.map((a) => {
        let acaoBtn = '';
        if (a.status === 'aceita') {
          acaoBtn = `<button class="btn btn-accent btn-block" data-comando="iniciarAtendimento" data-id="${a.id}">▶️ Iniciar Atendimento</button>`;
        } else if (a.status === 'em_andamento') {
          acaoBtn = `<button class="btn btn-secondary btn-block" style="background:#22c55e; color:#fff;" data-comando="concluirAtendimento" data-id="${a.id}">✅ Concluir Atendimento</button>`;
        } else if (a.status === 'concluida') {
          acaoBtn = `<span style="color:#16a34a; font-weight:700; font-size:0.9rem;">✓ Atendimento Concluído</span>`;
        }

        let avaliacaoBloco = '';
        if (a.avaliada) {
          avaliacaoBloco = `
            <div style="background:#fefce8; border:1px solid #fef08a; padding:8px; border-radius:6px; margin-top:8px;">
              <strong>Avaliação do Cliente:</strong> ${starsHtml(a.avaliacao_nota)} (${a.avaliacao_nota}/5)
              ${a.avaliacao_comentario ? `<p style="font-size:0.85rem; margin-top:2px; font-style:italic;">"${escapeHtml(a.avaliacao_comentario)}"</p>` : ''}
            </div>
          `;
        }

        return `
          <div class="opportunity-card" id="atendimento-card-${a.id}">
            <div class="opportunity-card__header">
              <div>
                <h4 style="font-size:1.1rem; color:var(--secondary); margin-bottom:4px;">${escapeHtml(a.titulo)}</h4>
                <span class="order-card__type">${a.tipo === 'aberta' ? 'Ordem Aberta' : 'Pedido Direcionado'}</span>
              </div>
              <span class="status status--${a.status}">${a.status.replace('_', ' ')}</span>
            </div>

            <p style="font-size:0.92rem; color:#334155; margin:8px 0;">${escapeHtml(a.descricao)}</p>

            <div style="font-size:0.88rem; background:#f8fafc; padding:10px; border-radius:6px; margin:6px 0; border:1px solid #e2e8f0;">
              <strong>Dados do Cliente para Execução:</strong><br>
              👤 Nome: <strong>${escapeHtml(a.cliente_nome)}</strong><br>
              📞 Contato: <strong>${escapeHtml(a.cliente_telefone || 'Não informado')}</strong><br>
              📍 Endereço/Bairro: <strong>${escapeHtml(a.bairro)}, ${escapeHtml(a.cidade)}</strong><br>
              ${a.periodo_desejado ? `⏰ Período Desejado: <strong>${escapeHtml(a.periodo_desejado)}</strong>` : ''}
            </div>

            ${avaliacaoBloco}

            <div style="margin-top:10px;">${acaoBtn}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<p class="form-msg error">Erro ao carregar atendimentos: ${escapeHtml(err.message)}</p>`;
    }
  }

  // Ações de Atendimento do Prestador
  window.aceitarOrdem = async function(id) {
    if (!confirm('Deseja assumir a responsabilidade por esta ordem de serviço?')) return;
    try {
      await api(`/ordens/${id}/aceitar`, { method: 'PUT' });
      alert('Ordem aceita com sucesso! Você agora é o responsável pelo atendimento.');
      await Promise.all([carregarOportunidades(), carregarPedidosDirecionados(), carregarMeusAtendimentos()]);
    } catch (err) {
      alert('Não foi possível aceitar a ordem: ' + err.message);
      await Promise.all([carregarOportunidades(), carregarPedidosDirecionados()]);
    }
  };

  window.iniciarAtendimento = async function(id) {
    try {
      await api(`/ordens/${id}/iniciar`, { method: 'PUT' });
      await carregarMeusAtendimentos();
    } catch (err) {
      alert('Erro ao iniciar atendimento: ' + err.message);
    }
  };

  window.concluirAtendimento = async function(id) {
    if (!confirm('Deseja marcar este atendimento como concluído?')) return;
    try {
      await api(`/ordens/${id}/concluir`, { method: 'PUT' });
      alert('Atendimento concluído com sucesso!');
      await carregarMeusAtendimentos();
    } catch (err) {
      alert('Erro ao concluir atendimento: ' + err.message);
    }
  };

  window.abrirModalRecusa = function(id) {
    document.getElementById('recusaOrderId').value = id;
    document.getElementById('recusaMotivo').value = '';
    document.getElementById('modalRecusa').classList.remove('hidden');
  };

  const closeRecusaBtn = document.getElementById('closeRecusaModal');
  if (closeRecusaBtn) {
    closeRecusaBtn.addEventListener('click', () => {
      document.getElementById('modalRecusa').classList.add('hidden');
    });
  }

  const btnConfRecusa = document.getElementById('btnConfirmarRecusa');
  if (btnConfRecusa) {
    btnConfRecusa.addEventListener('click', async () => {
      const id = Number(document.getElementById('recusaOrderId').value);
      const motivo = document.getElementById('recusaMotivo').value;
      try {
        await api(`/ordens/${id}/recusar`, { method: 'PUT', body: JSON.stringify({ motivo }) });
        document.getElementById('modalRecusa').classList.add('hidden');
        alert('Pedido recusado. O cliente será notificado.');
        await carregarPedidosDirecionados();
      } catch (err) {
        alert('Erro ao recusar pedido: ' + err.message);
      }
    });
  }

  // 4. MEUS ANÚNCIOS (Preservado da Etapa 1)
  async function carregarMeusAnuncios() {
    try {
      meusAnunciosList = await api('/anuncios/meus');
      renderizarMeusAnuncios(meusAnunciosList);
    } catch (err) {
      const grid = document.getElementById('myAdsGrid');
      if (grid) grid.innerHTML = `<p class="form-msg error">Erro ao carregar anúncios: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderizarMeusAnuncios(anuncios) {
    const grid = document.getElementById('myAdsGrid');
    const badge = document.getElementById('adCountBadge');
    if (!grid) return;
    if (badge) badge.textContent = `(${anuncios.length} cadastrado${anuncios.length === 1 ? '' : 's'})`;

    if (!anuncios || anuncios.length === 0) {
      grid.innerHTML = '<p style="color:#64748b;">Você ainda não cadastrou nenhum anúncio. Utilize o formulário ao lado para publicar sua primeira oferta!</p>';
      return;
    }

    grid.innerHTML = anuncios.map((an) => {
      const isVisivel = an.visivel === true;
      const statusBadge = an.oculto_admin ? '<span class="badge badge--oculto">Oculto pela administração</span>' : isVisivel
        ? '<span class="badge badge--visivel">Visível na Busca</span>'
        : '<span class="badge badge--oculto">Oculto</span>';

      const precoFmt = an.preco ? `R$ ${Number(an.preco).toFixed(2)}` : 'A combinar';

      return `
        <div class="ad-card ${isVisivel ? '' : 'ad-card--hidden'}" id="ad-card-${an.id}">
          <div class="ad-card__header">
            <div>
              <div class="ad-card__title">${escapeHtml(an.titulo)}</div>
              <div class="ad-card__category">${escapeHtml(an.categoria)}</div>
            </div>
            ${statusBadge}
          </div>
          <p class="ad-card__desc">${escapeHtml(an.descricao)}</p>
          <div class="ad-card__meta">
            <span>📍 ${escapeHtml(an.regiao)}</span>
            <span class="ad-card__price">${precoFmt}</span>
          </div>
          <div class="ad-card__actions">
            <button type="button" class="btn btn-secondary" data-comando="alternarVisibilidadeAnuncio" data-id="${an.id}" data-visivel="${isVisivel}">
              ${isVisivel ? '👁️ Ocultar' : '👁️ Mostrar'}
            </button>
            <button type="button" class="btn btn-ghost" style="color:var(--secondary); border-color:var(--bg-dominant-2);" data-comando="editarAnuncio" data-id="${an.id}">
              ✏️ Editar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.alternarVisibilidadeAnuncio = async function(id, statusAtual) {
    try {
      await api(`/anuncios/${id}/visibilidade`, {
        method: 'PUT',
        body: JSON.stringify({ visivel: !statusAtual }),
      });
      await carregarMeusAnuncios();
    } catch (err) {
      alert('Erro ao alterar visibilidade: ' + err.message);
    }
  };

  window.editarAnuncio = function(id) {
    const an = meusAnunciosList.find((item) => item.id === id);
    if (!an) return;

    document.getElementById('adFormTitle').textContent = 'Editar Anúncio de Serviço';
    document.getElementById('adTitulo').value = an.titulo;
    document.getElementById('adCategoria').value = an.categoria;
    document.getElementById('adRegiao').value = an.regiao;
    document.getElementById('adPreco').value = an.preco || '';
    document.getElementById('adDescricao').value = an.descricao;
    document.getElementById('adFoto').value = an.foto_url || '';
    document.getElementById('adEditId').value = an.id;

    document.getElementById('adSubmitBtn').textContent = 'Salvar Alterações';
    document.getElementById('adCancelEditBtn').classList.remove('hidden');
    document.getElementById('adTitulo').focus();
  };

  const cancelEditBtn = document.getElementById('adCancelEditBtn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', () => {
      document.getElementById('adForm').reset();
      document.getElementById('adEditId').value = '';
      document.getElementById('adFormTitle').textContent = 'Publicar Novo Anúncio de Serviço';
      document.getElementById('adSubmitBtn').textContent = 'Publicar Anúncio';
      document.getElementById('adCancelEditBtn').classList.add('hidden');
      document.getElementById('adPrestadorNome').value = currentUser.nome;
    });
  }

  const formPerfil = document.getElementById('myProfileForm');
  if (formPerfil) {
    formPerfil.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('profileMsg');
      const payload = {
        nome: document.getElementById('profNome').value,
        cidade: document.getElementById('profCidade').value,
        telefone: document.getElementById('profContato').value,
        profissao: document.getElementById('profEspecialidades').value,
        descricao: document.getElementById('profDescricao').value,
      };
      try {
        const atualizado = await api('/perfil', { method: 'PUT', body: JSON.stringify(payload) });
        currentUser = atualizado;
        localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));
        document.getElementById('adPrestadorNome').value = atualizado.nome + ' (' + (atualizado.cidade || '') + ')';
        renderAuthArea();

        msg.className = 'form-msg success';
        msg.textContent = 'Perfil profissional atualizado com sucesso!';
        setTimeout(() => { msg.textContent = ''; }, 3500);
      } catch (err) {
        msg.className = 'form-msg error';
        msg.textContent = err.message;
      }
    });
  }

  const formAd = document.getElementById('adForm');
  if (formAd) {
    formAd.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('adMsg');
      const editId = document.getElementById('adEditId').value;
      const payload = {
        titulo: document.getElementById('adTitulo').value,
        categoria: document.getElementById('adCategoria').value,
        regiao: document.getElementById('adRegiao').value,
        preco: document.getElementById('adPreco').value ? Number(document.getElementById('adPreco').value) : null,
        descricao: document.getElementById('adDescricao').value,
        foto_url: document.getElementById('adFoto').value,
      };

      try {
        if (editId) {
          await api(`/anuncios/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
          msg.className = 'form-msg success';
          msg.textContent = 'Anúncio atualizado com sucesso!';
        } else {
          await api('/anuncios', { method: 'POST', body: JSON.stringify(payload) });
          msg.className = 'form-msg success';
          msg.textContent = 'Anúncio publicado com sucesso!';
        }

        document.getElementById('adForm').reset();
        document.getElementById('adEditId').value = '';
        document.getElementById('adFormTitle').textContent = 'Publicar Novo Anúncio de Serviço';
        document.getElementById('adSubmitBtn').textContent = 'Publicar Anúncio';
        document.getElementById('adCancelEditBtn').classList.add('hidden');
        document.getElementById('adPrestadorNome').value = currentUser.nome;

        await carregarMeusAnuncios();
        setTimeout(() => { msg.textContent = ''; }, 3500);
      } catch (err) {
        msg.className = 'form-msg error';
        msg.textContent = err.message;
      }
    });
  }

  inicializarPainelPrestador();
}

/* =========================================================
   PÁGINA: historico.html (MINHAS ORDENS — ÁREA DO CLIENTE)
========================================================= */
const historyList = document.getElementById('historyList');
if (historyList) {
  let minhasOrdensCache = [];

  const ROTULOS_STATUS = {
    aberta: 'Aberta (Mural de Oportunidades)',
    aguardando_resposta: 'Aguardando Resposta do Prestador',
    aceita: 'Aceita pelo Prestador',
    em_andamento: 'Em Andamento',
    concluida: 'Concluída',
    recusada: 'Recusada pelo Prestador',
    cancelada: 'Cancelada',
  };

  async function carregarMinhasOrdens() {
    try {
      const me = await api('/auth/me');
      if (!me) {
        window.location.href = 'login.html';
        return;
      }
      currentUser = me;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));

      if (me.tipo !== 'cliente') { location.replace(me.tipo === 'admin' ? 'admin.html' : 'perfil.html'); return; }
      minhasOrdensCache = await api('/ordens/minhas');
      filtrarOrdens();
      const anuncio = new URLSearchParams(location.search).get('anuncio');
      if (anuncio) {
        history.replaceState(null,'','historico.html');
        const oferta = await api('/anuncios/' + encodeURIComponent(anuncio));
        abrirModalNovaOrdem();
        const form = document.getElementById('orderForm');
        form.dataset.anuncio = oferta.id;
        document.getElementById('orderModalTitle').textContent = 'Pedido para ' + oferta.prestador_nome;
        document.getElementById('orderHelp').textContent = 'Somente o prestador deste anúncio receberá seu pedido.';
        document.getElementById('orderTitulo').value = oferta.titulo;
        document.getElementById('orderCategoria').value = oferta.categoria;
        document.getElementById('orderCategoria').readOnly = true;
        document.getElementById('btnSubmitOrder').textContent = 'Enviar pedido';
      }
    } catch (err) {
      historyList.innerHTML = `<p class="form-msg error">Erro ao carregar ordens: ${escapeHtml(err.message)}</p>`;
    }
  }

  function filtrarOrdens() {
    const filtro = document.querySelector('#statusOrdem').value;
    const ordens = minhasOrdensCache.filter(o => !filtro || o.status === filtro);
    if (filtro && !ordens.length) { historyList.textContent = 'Nenhuma ordem com este status.'; return; }
    renderizarMinhasOrdens(ordens);
  }
  document.querySelector('#statusOrdem').addEventListener('change', filtrarOrdens);
  function renderizarMinhasOrdens(ordens) {
    if (!ordens || ordens.length === 0) {
      historyList.innerHTML = `
        <div style="background:#fff; padding:30px; border-radius:12px; text-align:center; border:1px solid #cbd5e1;">
          <h3>Nenhuma ordem de serviço cadastrada ainda</h3>
          <p style="color:#64748b; margin:10px 0 16px;">Você pode publicar uma necessidade no mural de oportunidades ou escolher um prestador na página de busca.</p>
          <button class="btn btn-accent" data-comando="abrirModalNovaOrdem">+ Publicar Ordem Aberta</button>
        </div>`;
      return;
    }

    historyList.innerHTML = ordens.map((o) => {
      const statusClass = 'status--' + o.status;
      const rotulo = ROTULOS_STATUS[o.status] || o.status;
      const dataFmt = new Date(o.criado_em).toLocaleDateString('pt-BR');

      let infoPrestador = '';
      if (o.tipo === 'direcionada' && o.prestador_destinatario_nome) {
        infoPrestador = `<strong>Destinatário:</strong> ${escapeHtml(o.prestador_destinatario_nome)}`;
      }
      if (o.prestador_responsavel_nome) {
        infoPrestador = `<strong>Responsável:</strong> ${escapeHtml(o.prestador_responsavel_nome)} ${o.prestador_responsavel_contato ? '· 📞 ' + escapeHtml(o.prestador_responsavel_contato) : ''}`;
      }

      let botoesAcao = '';
      if (o.status === 'aberta' || o.status === 'aguardando_resposta') {
        botoesAcao = `
          <button class="btn btn-ghost" style="color:var(--secondary); border-color:#cbd5e1;" data-comando="editarOrdem" data-id="${o.id}">✏️ Editar Escopo</button>
          <button class="btn btn-ghost" style="color:#dc2626; border-color:#fca5a5;" data-comando="cancelarOrdem" data-id="${o.id}">❌ Cancelar Ordem</button>
        `;
      } else if (o.status === 'recusada') {
        botoesAcao = `
          <button class="btn btn-accent" data-comando="converterParaAberta" data-id="${o.id}">📢 Publicar como Ordem Aberta</button>
        `;
      } else if (o.status === 'concluida') {
        if (!o.avaliada) {
          botoesAcao = `
            <button class="btn btn-accent" data-comando="abrirModalAvaliacao" data-id="${o.id}" data-nome="${escapeHtml(o.prestador_responsavel_nome || 'Prestador')}">⭐ Avaliar Atendimento</button>
          `;
        } else {
          botoesAcao = `
            <span style="font-size:0.9rem; font-weight:700; color:#b45309;">Avaliado: ${starsHtml(o.avaliacao_nota)}</span>
          `;
        }
      }

      let alertaRecusa = '';
      if (o.status === 'recusada') {
        alertaRecusa = `
          <div class="refusal-alert">
            <strong>O prestador recusou este pedido.</strong>
            <p style="margin-top:2px;">Motivo informado: ${escapeHtml(o.motivo_recusa || 'Sem justificativa')}</p>
            <p style="font-size:0.8rem; margin-top:4px;">Deseja que outros profissionais atendam? Você pode transformar esta necessidade em uma ordem aberta abaixo.</p>
          </div>
        `;
      }

      return `
        <div class="order-card" id="order-card-${o.id}">
          <div class="order-card__header">
            <div>
              <div class="order-card__title">${escapeHtml(o.titulo)}</div>
              <span class="order-card__type">${o.tipo === 'aberta' ? 'Ordem Aberta (Mural)' : 'Pedido Direcionado'}</span>
            </div>
            <span class="status ${statusClass}">${rotulo}</span>
          </div>

          ${alertaRecusa}

          <p class="order-card__desc">${escapeHtml(o.descricao)}</p>

          <div class="order-card__meta">
            <span>🏷️ <strong>Categoria:</strong> ${escapeHtml(o.categoria)}</span>
            <span>📍 <strong>Local:</strong> ${escapeHtml(o.bairro)}, ${escapeHtml(o.cidade)}</span>
            ${o.periodo_desejado ? `<span>⏰ <strong>Período:</strong> ${escapeHtml(o.periodo_desejado)}</span>` : ''}
            <span>📅 <strong>Criado em:</strong> ${dataFmt}</span>
          </div>

          <div class="order-card__footer">
            <div class="order-card__provider-info">${infoPrestador}</div>
            <div class="order-card__actions">${botoesAcao}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function limparFormularioOrdem() {
    const form = document.getElementById('orderForm');
    form.reset();
    delete form.dataset.anuncio;
    document.getElementById('orderCategoria').readOnly = false;
    document.getElementById('orderMsg').textContent = '';
    document.getElementById('orderHelp').textContent = '';
  }
  window.abrirModalNovaOrdem = function() {
    limparFormularioOrdem();
    document.getElementById('orderEditId').value = '';
    document.getElementById('orderModalTitle').textContent = 'Publicar Nova Ordem Aberta';
    document.getElementById('btnSubmitOrder').textContent = 'Publicar Ordem Aberta';
    if (currentUser && currentUser.cidade) {
      document.getElementById('orderCidade').value = currentUser.cidade;
    }
    document.getElementById('orderModal').classList.remove('hidden');
  };

  const btnOpenModal = document.getElementById('btnOpenNewOrderModal');
  if (btnOpenModal) btnOpenModal.addEventListener('click', abrirModalNovaOrdem);

  const closeOrderModal = document.getElementById('closeOrderModal');
  if (closeOrderModal) {
    closeOrderModal.addEventListener('click', () => {
      document.getElementById('orderModal').classList.add('hidden');
    });
  }

  const orderFormEl = document.getElementById('orderForm');
  if (orderFormEl) {
    orderFormEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('orderEditId').value;
      const msg = document.getElementById('orderMsg');
      const payload = {
        tipo: orderFormEl.dataset.anuncio ? 'direcionada' : 'aberta',
        anuncio_id: orderFormEl.dataset.anuncio,
        titulo: document.getElementById('orderTitulo').value,
        categoria: document.getElementById('orderCategoria').value,
        cidade: document.getElementById('orderCidade').value,
        bairro: document.getElementById('orderBairro').value,
        periodo_desejado: document.getElementById('orderPeriodo').value,
        descricao: document.getElementById('orderDescricao').value,
      };

      try {
        if (editId) {
          await api(`/ordens/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
          msg.className = 'form-msg success';
          msg.textContent = 'Ordem atualizada com sucesso!';
        } else {
          await api('/ordens', { method: 'POST', body: JSON.stringify(payload) });
          msg.className = 'form-msg success';
          msg.textContent = payload.anuncio_id ? 'Pedido enviado ao prestador.' : 'Ordem publicada no mural de oportunidades!';
        }

        setTimeout(() => {
          document.getElementById('orderModal').classList.add('hidden');
          msg.textContent = '';
          carregarMinhasOrdens();
        }, 1000);
      } catch (err) {
        msg.className = 'form-msg error';
        msg.textContent = err.message;
      }
    });
  }

  window.editarOrdem = function(id) {
    const o = minhasOrdensCache.find((item) => item.id === id);
    if (!o) return;

    limparFormularioOrdem();
    document.getElementById('orderEditId').value = o.id;
    document.getElementById('orderTitulo').value = o.titulo;
    document.getElementById('orderCategoria').value = o.categoria;
    document.getElementById('orderCidade').value = o.cidade;
    document.getElementById('orderBairro').value = o.bairro;
    document.getElementById('orderPeriodo').value = o.periodo_desejado || '';
    document.getElementById('orderDescricao').value = o.descricao;

    document.getElementById('orderModalTitle').textContent = 'Editar Escopo da Ordem #' + o.id;
    document.getElementById('btnSubmitOrder').textContent = 'Salvar Alterações';
    document.getElementById('orderModal').classList.remove('hidden');
  };

  window.cancelarOrdem = async function(id) {
    if (!confirm('Deseja realmente cancelar esta ordem de serviço?')) return;
    try {
      await api(`/ordens/${id}/cancelar`, { method: 'PUT', body: JSON.stringify({ motivo: 'Cancelado pelo cliente' }) });
      await carregarMinhasOrdens();
    } catch (err) {
      alert('Erro ao cancelar ordem: ' + err.message);
    }
  };

  window.converterParaAberta = function(id) {
    const o = minhasOrdensCache.find((item) => item.id === id);
    if (!o) return;

    limparFormularioOrdem();
    document.getElementById('orderEditId').value = '';
    document.getElementById('orderTitulo').value = o.titulo;
    document.getElementById('orderCategoria').value = o.categoria;
    document.getElementById('orderCidade').value = o.cidade;
    document.getElementById('orderBairro').value = o.bairro;
    document.getElementById('orderPeriodo').value = o.periodo_desejado || '';
    document.getElementById('orderDescricao').value = o.descricao;

    document.getElementById('orderModalTitle').textContent = 'Publicar como Nova Ordem Aberta';
    document.getElementById('btnSubmitOrder').textContent = 'Confirmar e Publicar Ordem Aberta';
    document.getElementById('orderModal').classList.remove('hidden');
  };

  let selectedStars = 0;
  window.abrirModalAvaliacao = function(ordemId, prestadorNome) {
    document.getElementById('reviewTargetOrderId').value = ordemId;
    document.getElementById('reviewProviderName').textContent = 'Profissional: ' + prestadorNome;
    document.getElementById('reviewComment').value = '';
    selectedStars = 0;
    document.querySelectorAll('#starInput span').forEach((s) => s.classList.remove('active'));
    document.getElementById('reviewModal').classList.remove('hidden');
  };

  document.querySelectorAll('#starInput span').forEach((star) => {
    star.addEventListener('click', () => {
      selectedStars = Number(star.dataset.value);
      document.querySelectorAll('#starInput span').forEach((s) =>
        s.classList.toggle('active', Number(s.dataset.value) <= selectedStars));
    });
  });

  const closeReviewBtn = document.getElementById('closeReviewModal');
  if (closeReviewBtn) {
    closeReviewBtn.addEventListener('click', () => {
      document.getElementById('reviewModal').classList.add('hidden');
    });
  }

  const submitRevBtn = document.getElementById('submitReview');
  if (submitRevBtn) {
    submitRevBtn.addEventListener('click', async () => {
      const ordemId = Number(document.getElementById('reviewTargetOrderId').value);
      if (!selectedStars) {
        alert('Selecione uma nota de 1 a 5 estrelas.');
        return;
      }
      const comentario = document.getElementById('reviewComment').value;

      try {
        await api('/avaliacoes', {
          method: 'POST',
          body: JSON.stringify({ ordem_id: ordemId, nota: selectedStars, comentario }),
        });
        document.getElementById('reviewModal').classList.add('hidden');
        alert('Avaliação enviada com sucesso! Obrigado pelo feedback.');
        await carregarMinhasOrdens();
      } catch (err) {
        alert('Erro ao enviar avaliação: ' + err.message);
        await carregarMinhasOrdens();
      }
    });
  }

  carregarMinhasOrdens();
}

document.addEventListener('click', e => {
  const d = e.target.closest('[data-comando]')?.dataset;
  if (!d) return;
  const comandos = ['aceitarOrdem','abrirModalRecusa','iniciarAtendimento','concluirAtendimento','editarAnuncio','alternarVisibilidadeAnuncio','abrirModalNovaOrdem','editarOrdem','cancelarOrdem','converterParaAberta','abrirModalAvaliacao'];
  if (comandos.includes(d.comando)) window[d.comando](Number(d.id), d.nome ?? (d.visivel === 'true'));
});
