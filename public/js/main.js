/* =============================================
   CONECTA SERVIÇOS — main.js
   ÚNICO arquivo JS, compartilhado por TODAS as páginas.
   Cada bloco só roda se os elementos daquela página existirem.
============================================= */

const API = '/api';

function lerUsuarioSalvo() {
  try {
    return JSON.parse(localStorage.getItem('cs_currentUser')) || null;
  } catch {
    return null; // valor corrompido no localStorage
  }
}
let currentUser = lerUsuarioSalvo();

/* ---------- SEGURANÇA: escape de HTML e URLs ---------- */
function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Aceita só http/https e neutraliza caracteres que poderiam sair de url('...') no CSS.
function urlImagemSegura(valor) {
  if (!valor) return '';
  try {
    const u = new URL(valor);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href.replace(/['"()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  } catch {
    return '';
  }
}

/* ---------- HELPER DE REQUISIÇÃO ---------- */
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
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
      <span style="color:var(--bg-dominant); font-size:.9rem;">Olá, ${escapeHtml(primeiroNome)}</span>
      <button class="btn btn-ghost" id="logoutBtn" type="button">Sair</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', () => {
      currentUser = null;
      localStorage.removeItem('cs_currentUser');
      window.location.href = 'index.html';
    });
  } else {
    area.innerHTML = `
      <a class="btn btn-ghost" href="login.html">Entrar</a>
      <a class="btn btn-accent" href="cadastro.html">Cadastrar</a>
    `;
  }
}
renderAuthArea();

/* ---------- CARDS DE PRESTADOR ---------- */
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
      <div class="card__price">R$ ${Number(p.preco).toFixed(2)}</div>
    </div>
    <div class="card__actions">
      <button type="button" class="btn btn-secondary" data-action="ver-perfil" data-id="${id}">Ver perfil</button>
      <button type="button" class="btn btn-accent" data-action="contatar" data-id="${id}"
        data-contato="${escapeHtml(p.contato)}" data-servico="${escapeHtml(p.profissao)}">Contato</button>
    </div>
  </div>`;
}

function contatarPrestador(prestadorId, contato, servico) {
  // Registra no histórico em segundo plano; abrir o WhatsApp logo evita bloqueio de pop-up.
  if (currentUser) {
    api('/historico', {
      method: 'POST',
      body: JSON.stringify({ usuario_id: currentUser.id, prestador_id: prestadorId, servico }),
    }).catch((err) => console.warn('Não foi possível registrar no histórico:', err.message));
  }
  const digitos = String(contato || '').replace(/\D/g, '');
  const numero = digitos.startsWith('55') && digitos.length > 11 ? digitos : '55' + digitos;
  window.open(`https://wa.me/${numero}`, '_blank', 'noopener');
}

/* ---------- MODAL DE PERFIL DO PRESTADOR ---------- */
// Cria o modal sob demanda, então ele também funciona em páginas que não o têm no HTML (ex.: perfil.html).
function getProviderModal() {
  let modal = document.getElementById('providerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal hidden';
    modal.id = 'providerModal';
    modal.innerHTML = `
      <div class="modal__box">
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
    const comentariosHtml = p.comentarios.length
      ? p.comentarios.map((c) => `
          <p style="margin-top:8px;"><strong>${escapeHtml(c.autor)}</strong>: ${starsHtml(c.nota)}<br>${escapeHtml(c.comentario || '')}</p>`).join('')
      : '<p style="opacity:.7;">Ainda sem comentários.</p>';

    document.getElementById('providerModalContent').innerHTML = `
      <h3>${escapeHtml(p.nome)}</h3>
      <p><strong>${escapeHtml(p.profissao)}</strong> · ${escapeHtml(p.cidade)}</p>
      <p class="card__rating">${ratingHtml(p.rating, p.avaliacoes)}</p>
      <p style="margin:12px 0;">${escapeHtml(p.descricao || 'Sem descrição informada.')}</p>
      <p><strong>Preço médio:</strong> R$ ${Number(p.preco).toFixed(2)}</p>
      <p><strong>Contato:</strong> ${escapeHtml(p.contato)}</p>
      <button type="button" class="btn btn-accent btn-block" data-action="contatar" data-id="${Number(p.id)}"
        data-contato="${escapeHtml(p.contato)}" data-servico="${escapeHtml(p.profissao)}">Chamar no WhatsApp</button>
      <hr style="margin:14px 0;">
      <h4>Avaliações</h4>
      ${comentariosHtml}
    `;
    modal.classList.remove('hidden');
  } catch (err) {
    alert('Erro ao carregar perfil: ' + err.message);
  }
}

/* ---------- CLIQUES GLOBAIS (substitui os onclick inline) ---------- */
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
  let sequencia = 0; // descarta respostas antigas se o usuário digitar rápido
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
      setTimeout(() => { window.location.href = 'index.html'; }, 800);
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
      setTimeout(() => { window.location.href = tipo === 'prestador' ? 'perfil.html' : 'index.html'; }, 800);
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  });
}

/* =========================================================
   PÁGINA: perfil.html
========================================================= */
const providerForm = document.getElementById('providerForm');
if (providerForm) {
  async function renderMyServices() {
    const grid = document.getElementById('myServicesGrid');
    if (!currentUser) {
      grid.innerHTML = '<p>Faça login para ver seus serviços publicados.</p>';
      return;
    }
    try {
      const meus = await api(`/prestadores/usuario/${currentUser.id}`);
      grid.innerHTML = meus.length
        ? meus.map((p) => cardTemplate({ ...p, rating: 0, avaliacoes: 0 })).join('')
        : '<p>Você ainda não publicou nenhum serviço.</p>';
    } catch (err) {
      grid.innerHTML = `<p>Erro: ${escapeHtml(err.message)}</p>`;
    }
  }

  providerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('providerMsg');
    if (!currentUser) {
      msg.className = 'form-msg error';
      msg.textContent = 'Você precisa estar logado para publicar um serviço.';
      return;
    }
    const payload = {
      usuario_id: currentUser.id,
      nome: document.getElementById('pNome').value,
      profissao: document.getElementById('pProfissao').value,
      cidade: document.getElementById('pCidade').value,
      preco: Number(document.getElementById('pPreco').value),
      contato: document.getElementById('pContato').value,
      descricao: document.getElementById('pDescricao').value,
      foto_url: document.getElementById('pFoto').value,
    };
    try {
      await api('/prestadores', { method: 'POST', body: JSON.stringify(payload) });
      msg.className = 'form-msg success';
      msg.textContent = 'Serviço publicado com sucesso!';
      providerForm.reset();
      renderMyServices();
    } catch (err) {
      msg.className = 'form-msg error';
      msg.textContent = err.message;
    }
  });

  renderMyServices();
}

/* =========================================================
   PÁGINA: historico.html
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
          body: JSON.stringify({ status: 'concluido', usuario_id: currentUser.id }),
        });
        renderHistory();
      } catch (err) {
        alert('Erro ao atualizar o serviço: ' + err.message);
      }
    }
  });

  document.getElementById('closeReviewModal').addEventListener('click', () =>
    document.getElementById('reviewModal').classList.add('hidden'));

  document.querySelectorAll('#starInput span').forEach((star) => {
    star.addEventListener('click', () => {
      selectedStars = Number(star.dataset.value);
      document.querySelectorAll('#starInput span').forEach((s) =>
        s.classList.toggle('active', Number(s.dataset.value) <= selectedStars));
    });
  });

  document.getElementById('submitReview').addEventListener('click', async (e) => {
    if (!currentUser) return;
    if (!selectedStars) { alert('Selecione uma nota de 1 a 5 estrelas.'); return; }
    const botao = e.currentTarget;
    botao.disabled = true; // evita envio duplo
    try {
      await api('/avaliacoes', {
        method: 'POST',
        body: JSON.stringify({
          prestador_id: reviewTargetProviderId,
          usuario_id: currentUser.id,
          nota: selectedStars,
          comentario: document.getElementById('reviewComment').value,
          historico_id: reviewTargetHistoryId,
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

  renderHistory();
}
