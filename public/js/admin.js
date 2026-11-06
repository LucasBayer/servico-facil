'use strict';
const secao = document.querySelector('#secao');
const registros = document.querySelector('#registros');
const aviso = document.querySelector('#aviso');
const dialogo = document.querySelector('#alteracao');
const form = document.querySelector('#moderar');
const pendente = o => ['aberta','aguardando_resposta','aceita','em_andamento'].includes(o.status);
const statusOrdem = {aberta:'Aberta',aguardando_resposta:'Aguardando resposta',aceita:'Aceita',em_andamento:'Em andamento',concluida:'Concluída',recusada:'Recusada',cancelada:'Cancelada'};
let dados;
let operacao;
function elemento(tag, texto) {
  const el = document.createElement(tag);
  el.textContent = texto;
  return el;
}
function acao(card, nome, rota, payload, ordem) {
  const botao = elemento('button',nome);
  botao.className = 'btn btn-secondary';
  botao.addEventListener('click', () => {
    form.reset();
    operacao = {rota,payload};
    document.querySelector('#acaoTitulo').textContent = nome + ' · ' + card.querySelector('h3').textContent;
    document.querySelector('#erroAcao').textContent = '';
    const campos = document.querySelector('#campos');
    campos.replaceChildren();
    if (ordem) {
      for (const [campo,rotulo] of Object.entries({titulo:'Título',descricao:'Descrição',categoria:'Categoria',cidade:'Cidade',bairro:'Bairro'})) {
        const label = elemento('label',rotulo);
        const input = document.createElement(campo === 'descricao' ? 'textarea' : 'input');
        input.name = campo;
        input.required = true;
        input.maxLength = campo === 'descricao' ? 2000 : campo === 'titulo' ? 200 : 100;
        input.value = ordem[campo];
        label.append(input);
        campos.append(label);
      }
    }
    dialogo.showModal();
  });
  card.append(botao);
}
function renderizar() {
  registros.replaceChildren();
  if (!dados) return;
  const tipo = secao.value;
  const lista = tipo === 'pendencias' ? dados.ordens.filter(pendente) : dados[tipo];
  aviso.textContent = lista.length ? lista.length + ' registros' : 'Nenhum registro nesta seção.';
  for (const r of lista) {
    const card = document.createElement('article');
    card.append(elemento('h3','#' + r.id + ' · ' + (r.nome || r.titulo || r.acao)));
    if (tipo === 'contas') {
      card.append(elemento('p',[r.tipo,r.email,r.ativo ? 'Ativa' : 'Desativada'].join(' · ')));
      acao(card,r.ativo ? 'Desativar conta' : 'Restaurar conta','/admin/usuarios/'+r.id+'/status',{ativo:!r.ativo});
    } else if (tipo === 'perfis') {
      card.append(elemento('p',r.visivel ? 'Visibilidade habilitada' : 'Oculto'));
      acao(card,r.visivel ? 'Ocultar perfil' : 'Restaurar perfil','/admin/prestadores/'+r.id+'/visibilidade',{visivel:!r.visivel});
    } else if (tipo === 'anuncios') {
      card.append(elemento('p',[r.ativo ? 'Ativo' : 'Desativado',r.visivel ? 'Visibilidade habilitada pelo prestador' : 'Oculto pelo prestador',r.oculto_admin ? 'Oculto pela administração' : 'Liberado pela administração'].join(' · ')));
      if (r.ativo) acao(card,r.oculto_admin ? 'Restaurar anúncio' : 'Ocultar anúncio','/admin/anuncios/'+r.id+'/moderacao',{oculto_admin:!r.oculto_admin});
    } else if (tipo === 'historico') {
      card.append(elemento('p',new Date(r.criado_em).toLocaleString('pt-BR') + ' · ' + r.administrador + ' · ' + r.entidade + ' #' + r.entidade_id),elemento('p',r.motivo));
      for (const [label,valor] of [['Antes',r.dados_anteriores],['Depois',r.dados_posteriores]]) {
        if (valor) card.append(elemento('pre',label + '\n' + JSON.stringify(valor,null,2)));
      }
    } else {
      card.append(elemento('p',[statusOrdem[r.status],r.cliente,r.responsavel || 'Sem responsável'].join(' · ')),elemento('p',r.descricao));
      acao(card,'Ajustar escopo','/admin/ordens/'+r.id+'/escopo',{},r);
      if (['aceita','em_andamento'].includes(r.status)) acao(card,'Cancelar ordem','/ordens/'+r.id+'/cancelar',{});
    }
    registros.append(card);
  }
}
async function carregar() {
  aviso.textContent = 'Carregando registros…';
  try {
    dados = await api('/admin/painel');
    document.querySelector('#resumo').textContent = dados.contas.length + ' contas · ' + dados.ordens.filter(pendente).length + ' ordens pendentes · ' + dados.historico.length + ' ações registradas';
    renderizar();
  } catch (err) {
    dados = null;
    registros.replaceChildren();
    aviso.textContent = err.message;
  }
}
form.addEventListener('submit',async e => {
  e.preventDefault();
  const confirmar = form.querySelector('.btn-accent');
  confirmar.disabled = true;
  try {
    await api(operacao.rota,{method:'PUT',body:JSON.stringify({...operacao.payload,...Object.fromEntries(new FormData(form))})});
    dialogo.close();
    await carregar();
    if (dados) aviso.textContent += ' · Alteração registrada.';
  } catch(err) { document.querySelector('#erroAcao').textContent = err.message; }
  finally { confirmar.disabled = false; }
});
document.querySelector('#fechar').addEventListener('click',()=>dialogo.close());
secao.addEventListener('change',renderizar);
carregar();
