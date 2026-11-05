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
          console.warn('Erro ao encerrar sessão:', err.message);
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
sincronizarSessao();

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
  if (currentUser) {
    api('/historico', {
      method: 'POST',
      body: JSON.stringify({ prestador_id: prestadorId, servico }),
    }).catch((err) => console.warn('Não foi possível registrar no histórico:', err.message));
  }
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
    const p = await api(`/prestadores/${id}`);
    const comentariosHtml = p.comentarios && p.comentarios.length
      ? p.comentarios.map((c) => `
          <p style="margin-top:8px;"><strong>${escapeHtml(c.autor)}</strong>: ${starsHtml(c.nota)}<br>${escapeHtml(c.comentario || '')}</p>`).join('')
      : '<p style="opacity:.7;">Ainda sem comentários.</p>';

    const anunciosHtml = p.anuncios && p.anuncios.length
      ? p.anuncios.map((an) => `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; margin-top:8px;">
            <strong>${escapeHtml(an.titulo)}</strong> <span style="font-size:0.8rem; color:#0284c7;">(${escapeHtml(an.categoria)})</span>
            <p style="font-size:0.85rem; margin:4px 0;">${escapeHtml(an.descricao)}</p>
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#64748b;">
              <span>📍 ${escapeHtml(an.regiao)}</span>
              <span>${an.preco ? 'R$ ' + Number(an.preco).toFixed(2) : 'A combinar'}</span>
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
      <h4>Avaliações de Clientes</h4>
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
        window.location.href = usuario.tipo === 'prestador' ? 'perfil.html' : 'index.html';
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
   PÁGINA: perfil.html (ÁREA DO PRESTADOR E ANÚNCIOS)
========================================================= */
const providerMainLayout = document.getElementById('providerMainLayout');
if (providerMainLayout) {
  let meusAnunciosList = [];

  async function inicializarAreaPrestador() {
    try {
      const me = await api('/auth/me');
      if (!me) {
        window.location.href = 'login.html';
        return;
      }
      currentUser = me;
      localStorage.setItem('cs_currentUser', JSON.stringify(currentUser));

      if (currentUser.tipo !== 'prestador' && currentUser.tipo !== 'admin') {
        document.getElementById('notProviderWarning').classList.remove('hidden');
        providerMainLayout.classList.add('hidden');
        return;
      }

      // Carrega dados completos do perfil
      const perfilCompleto = await api('/perfil');
      document.getElementById('profNome').value = perfilCompleto.nome || '';
      document.getElementById('profCidade').value = perfilCompleto.cidade || '';
      document.getElementById('profContato').value = perfilCompleto.telefone || '';
      if (perfilCompleto.perfilPrestador) {
        document.getElementById('profEspecialidades').value = perfilCompleto.perfilPrestador.profissao || '';
        document.getElementById('profDescricao').value = perfilCompleto.perfilPrestador.descricao || '';
      }

      // Preenche os dados de identificação somente-leitura do formulário de anúncio
      document.getElementById('adPrestadorNome').value = perfilCompleto.nome + ' (' + (perfilCompleto.cidade || 'Região') + ')';

      await carregarMeusAnuncios();
    } catch (err) {
      console.error('Erro ao inicializar área do prestador:', err);
    }
  }

  async function carregarMeusAnuncios() {
    try {
      meusAnunciosList = await api('/anuncios/meus');
      renderizarMeusAnuncios(meusAnunciosList);
    } catch (err) {
      document.getElementById('myAdsGrid').innerHTML = `<p class="form-msg error">Erro ao carregar anúncios: ${escapeHtml(err.message)}</p>`;
    }
  }

  function renderizarMeusAnuncios(anuncios) {
    const grid = document.getElementById('myAdsGrid');
    const badge = document.getElementById('adCountBadge');
    badge.textContent = `(${anuncios.length} cadastrado${anuncios.length === 1 ? '' : 's'})`;

    if (!anuncios || anuncios.length === 0) {
      grid.innerHTML = '<p style="color:#64748b;">Você ainda não cadastrou nenhum anúncio de serviço. Utilize o formulário ao lado para publicar sua primeira oferta!</p>';
      return;
    }

    grid.innerHTML = anuncios.map((an) => {
      const isVisivel = an.visivel === true;
      const statusBadge = isVisivel
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
            <button type="button" class="btn btn-secondary" onclick="alternarVisibilidadeAnuncio(${an.id}, ${isVisivel})">
              ${isVisivel ? '👁️ Ocultar' : '👁️ Mostrar'}
            </button>
            <button type="button" class="btn btn-ghost" style="color:var(--secondary); border-color:var(--bg-dominant-2);" onclick="editarAnuncio(${an.id})">
              ✏️ Editar
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Alternar visibilidade do anúncio (Ocultar / Mostrar)
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

  // Carregar dados para edição
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

  // Cancelar edição
  document.getElementById('adCancelEditBtn').addEventListener('click', () => {
    document.getElementById('adForm').reset();
    document.getElementById('adEditId').value = '';
    document.getElementById('adFormTitle').textContent = 'Publicar Novo Anúncio de Serviço';
    document.getElementById('adSubmitBtn').textContent = 'Publicar Anúncio';
    document.getElementById('adCancelEditBtn').classList.add('hidden');
    document.getElementById('adPrestadorNome').value = currentUser.nome;
  });

  // Salvar perfil do prestador
  document.getElementById('myProfileForm').addEventListener('submit', async (e) => {
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
      const atualizado = await api('/perfil', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
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

  // Publicar ou editar anúncio
  document.getElementById('adForm').addEventListener('submit', async (e) => {
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
        await api(`/anuncios/${editId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        msg.className = 'form-msg success';
        msg.textContent = 'Anúncio atualizado com sucesso!';
      } else {
        await api('/anuncios', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
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

  inicializarAreaPrestador();
}

/* =========================================================
   PÁGINA: historico.html (PRESERVADA E SESSÃO SEGURA)
========================================================= */
const historyList = document.getElementById('historyList');
if (historyList) {
  const ROTULOS = { andamento: 'Em andamento', concluido: 'Concluído', avaliado: 'Avaliado' };
  let reviewTargetHistoryId = null;
  let reviewTargetProviderId = null;
  let selectedStars = 0;

  async function renderHistory() {
    if (!currentUser) {
      historyList.innerHTML = '<p>Faça login para ver seu histórico de serviços.</p>';
      return;
    }
    try {
      const historico = await api(`/historico/${currentUser.id}`);
      historyList.innerHTML = historico.length ? historico.map((h) => {
        const status = ROTULOS[h.status] ? h.status : 'andamento';
        const botao = status === 'andamento'
          ? `<button type="button" class="btn btn-secondary" data-action="concluir" data-id="${Number(h.id)}">Marcar como concluído</button>`
          : status === 'concluido'
            ? `<button type="button" class="btn btn-accent" data-action="avaliar" data-id="${Number(h.id)}"
                data-prestador="${Number(h.prestador_id)}" data-nome="${escapeHtml(h.prestador_nome)}"
                data-servico="${escapeHtml(h.servico || '')}">Avaliar</button>`
            : '';
        return `
        <div class="history-item">
          <div class="history-item__info">
            <h4>${escapeHtml(h.servico || 'Serviço')} — ${escapeHtml(h.prestador_nome)}</h4>
            <p>Solicitado em ${new Date(h.data_solicitacao).toLocaleDateString('pt-BR')}</p>
          </div>
          <span class="status status--${status}">${ROTULOS[status]}</span>
          ${botao}
        </div>`;
      }).join('') : '<p>Nenhum serviço solicitado ainda.</p>';
    } catch (err) {
      historyList.innerHTML = `<p>Erro: ${escapeHtml(err.message)}</p>`;
    }
  }

  function openReviewModal(historyId, providerId, providerNome, servico) {
    reviewTargetHistoryId = historyId;
    reviewTargetProviderId = providerId;
    selectedStars = 0;
    document.querySelectorAll('#starInput span').forEach((s) => s.classList.remove('active'));
    document.getElementById('reviewComment').value = '';
    document.getElementById('reviewProviderName').textContent = `${providerNome} — ${servico}`;
    document.getElementById('reviewModal').classList.remove('hidden');
  }

  historyList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !currentUser) return;
    const d = btn.dataset;

    if (d.action === 'avaliar') {
      openReviewModal(Number(d.id), Number(d.prestador), d.nome, d.servico);
    } else if (d.action === 'concluir') {
      try {
        await api(`/historico/${Number(d.id)}/status`, {
          method: 'PUT',
          body: JSON.stringify({ status: 'concluido' }),
        });
        renderHistory();
      } catch (err) {
        alert('Erro ao atualizar o serviço: ' + err.message);
      }
    }
  });

  const closeReviewModalBtn = document.getElementById('closeReviewModal');
  if (closeReviewModalBtn) {
    closeReviewModalBtn.addEventListener('click', () =>
      document.getElementById('reviewModal').classList.add('hidden'));
  }

  document.querySelectorAll('#starInput span').forEach((star) => {
    star.addEventListener('click', () => {
      selectedStars = Number(star.dataset.value);
      document.querySelectorAll('#starInput span').forEach((s) =>
        s.classList.toggle('active', Number(s.dataset.value) <= selectedStars));
    });
  });

  const submitReviewBtn = document.getElementById('submitReview');
  if (submitReviewBtn) {
    submitReviewBtn.addEventListener('click', async (e) => {
      if (!currentUser) return;
      if (!selectedStars) { alert('Selecione uma nota de 1 a 5 estrelas.'); return; }
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        await api('/avaliacoes', {
          method: 'POST',
          body: JSON.stringify({
            prestador_id: reviewTargetProviderId,
            historico_id: reviewTargetHistoryId,
            nota: selectedStars,
            comentario: document.getElementById('reviewComment').value,
          }),
        });
        document.getElementById('reviewModal').classList.add('hidden');
        renderHistory();
      } catch (err) {
        alert('Erro ao enviar avaliação: ' + err.message);
      } finally {
        botao.disabled = false;
      }
    });
  }

  renderHistory();
}
