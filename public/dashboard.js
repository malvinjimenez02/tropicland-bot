const API = '/api/dashboard';

function token() {
  return localStorage.getItem('dashboard_token') || '';
}

function headers(extra = {}) {
  return { 'Content-Type': 'application/json', 'x-dashboard-token': token(), ...extra };
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, { headers: headers(), ...opts });
  if (res.status === 401) {
    localStorage.removeItem('dashboard_token');
    window.location.href = '/';
    return null;
  }
  return res;
}

// ---- Toast ----
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = msg;
  toastMsg.className = `px-4 py-3 rounded-lg shadow-lg text-sm text-white font-medium ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ---- Tabs ----
function switchTab(tab) {
  document.getElementById('panel-config').classList.toggle('hidden', tab !== 'config');
  document.getElementById('panel-conv').classList.toggle('hidden', tab !== 'conv');

  document.getElementById('tab-config').className = `tab-btn px-5 py-3 text-sm font-medium border-b-2 ${
    tab === 'config' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'
  }`;
  document.getElementById('tab-conv').className = `tab-btn px-5 py-3 text-sm font-medium border-b-2 ${
    tab === 'conv' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'
  }`;

  if (tab === 'conv') {
    loadConversaciones();
  }
}

// ---- Config ----
async function loadConfig() {
  const res = await apiFetch('/config');
  if (!res) return;
  const data = await res.json();

  document.getElementById('systemPrompt').value = data.systemPrompt || '';
  document.getElementById('storeName').value = data.businessInfo?.store_name || '';
  document.getElementById('deliverySdq').value = data.businessInfo?.delivery_sdq || '';
  document.getElementById('deliverySti').value = data.businessInfo?.delivery_sti || '';
  document.getElementById('deliveryInterior').value = data.businessInfo?.delivery_interior || '';

  window._cachedFaqs = data.faqs || [];
  renderFaqs(data.faqs || []);
}

async function savePrompt() {
  const prompt = document.getElementById('systemPrompt').value.trim();
  if (!prompt) return showToast('El prompt no puede estar vacío', 'error');

  const res = await apiFetch('/config/prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  if (!res) return;
  res.ok ? showToast('Prompt guardado. La IA lo usará en el próximo mensaje.') : showToast('Error guardando el prompt', 'error');
}

async function saveBusiness() {
  const body = {
    store_name: document.getElementById('storeName').value.trim(),
    delivery_sdq: document.getElementById('deliverySdq').value.trim(),
    delivery_sti: document.getElementById('deliverySti').value.trim(),
    delivery_interior: document.getElementById('deliveryInterior').value.trim(),
  };
  const res = await apiFetch('/config/business', { method: 'POST', body: JSON.stringify(body) });
  if (!res) return;
  res.ok ? showToast('Datos del negocio guardados') : showToast('Error guardando datos', 'error');
}

// ---- FAQs ----
function renderFaqs(faqs) {
  const list = document.getElementById('faqList');
  if (!faqs.length) {
    list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No hay FAQs configuradas todavía.</p>';
    return;
  }
  list.innerHTML = faqs.map((f, i) => faqCardHtml(f, i)).join('');
}

function faqCardHtml(f, i) {
  const idx = i ?? (window._cachedFaqs || []).findIndex(x => x.pregunta === f.pregunta);
  return `
    <div id="faq-card-${idx}" class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-gray-800">${escHtml(f.pregunta)}</p>
        <p class="text-sm text-gray-500 mt-0.5">${escHtml(f.respuesta)}</p>
      </div>
      <div class="flex gap-1 flex-shrink-0">
        <button onclick="startEditFaq(${idx})" class="text-gray-400 hover:text-emerald-600 transition-colors text-sm px-1" title="Editar">✏️</button>
        <button onclick="deleteFaqByIdx(${idx})" class="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none" title="Eliminar">✕</button>
      </div>
    </div>`;
}

function startEditFaq(idx) {
  const faqs = window._cachedFaqs || [];
  const f = faqs[idx];
  if (!f) return;
  const card = document.getElementById(`faq-card-${idx}`);
  if (!card) return;

  card.innerHTML = `
    <div class="flex-1 space-y-2">
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Pregunta</label>
        <input id="edit-q-${idx}" type="text" value="${escHtml(f.pregunta)}"
          class="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Respuesta</label>
        <textarea id="edit-a-${idx}" rows="2"
          class="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none">${escHtml(f.respuesta)}</textarea>
      </div>
      <div class="flex gap-2">
        <button onclick="saveEditFaq(${idx})"
          class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">Guardar</button>
        <button onclick="cancelEditFaq(${idx})"
          class="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-300 transition-colors">Cancelar</button>
      </div>
    </div>`;
}

async function saveEditFaq(idx) {
  const faqs = window._cachedFaqs || [];
  const original = faqs[idx];
  if (!original) return;

  const newQ = document.getElementById(`edit-q-${idx}`)?.value.trim();
  const newA = document.getElementById(`edit-a-${idx}`)?.value.trim();
  if (!newQ || !newA) return showToast('Completa la pregunta y la respuesta', 'error');

  if (newQ !== original.pregunta) {
    const delRes = await apiFetch('/config/faq', { method: 'DELETE', body: JSON.stringify({ pregunta: original.pregunta }) });
    if (!delRes || !delRes.ok) return showToast('Error actualizando FAQ', 'error');
  }

  const res = await apiFetch('/config/faq', { method: 'POST', body: JSON.stringify({ pregunta: newQ, respuesta: newA }) });
  if (!res) return;
  if (res.ok) { showToast('FAQ actualizada'); loadConfig(); }
  else showToast('Error guardando FAQ', 'error');
}

function cancelEditFaq(idx) {
  const faqs = window._cachedFaqs || [];
  const f = faqs[idx];
  if (!f) return loadConfig();
  const card = document.getElementById(`faq-card-${idx}`);
  if (card) card.outerHTML = faqCardHtml(f, idx);
}

async function deleteFaqByIdx(idx) {
  const faqs = window._cachedFaqs || [];
  const f = faqs[idx];
  if (!f) return;
  await deleteFaq(f.pregunta);
}

function showAddFaq() { document.getElementById('addFaqForm').classList.remove('hidden'); }
function hideAddFaq() {
  document.getElementById('addFaqForm').classList.add('hidden');
  document.getElementById('faqPregunta').value = '';
  document.getElementById('faqRespuesta').value = '';
}

async function saveFaq() {
  const pregunta = document.getElementById('faqPregunta').value.trim();
  const respuesta = document.getElementById('faqRespuesta').value.trim();
  if (!pregunta || !respuesta) return showToast('Completa la pregunta y la respuesta', 'error');

  const res = await apiFetch('/config/faq', { method: 'POST', body: JSON.stringify({ pregunta, respuesta }) });
  if (!res) return;
  if (res.ok) {
    showToast('FAQ guardada');
    hideAddFaq();
    loadConfig();
  } else {
    showToast('Error guardando FAQ', 'error');
  }
}

async function deleteFaq(pregunta) {
  if (!confirm(`¿Eliminar la FAQ "${pregunta}"?`)) return;
  const res = await apiFetch('/config/faq', { method: 'DELETE', body: JSON.stringify({ pregunta }) });
  if (!res) return;
  res.ok ? (showToast('FAQ eliminada'), loadConfig()) : showToast('Error eliminando FAQ', 'error');
}

// ---- Conversaciones ----
const BOT_STATE_LABELS = {
  activo: { text: 'Activo', cls: 'bg-emerald-100 text-emerald-700' },
  pausado: { text: 'Pausado', cls: 'bg-red-100 text-red-700' },
  escalado: { text: 'Escalado', cls: 'bg-yellow-100 text-yellow-700' },
};

let _activeChat = null; // { telefono, nombre }

async function loadConversaciones() {
  const list = document.getElementById('convList');
  list.innerHTML = '<p class="text-sm text-gray-400 text-center py-8 px-4">Cargando...</p>';

  const res = await apiFetch('/conversaciones');
  if (!res) return;
  const data = await res.json();

  if (!data.length) {
    list.innerHTML = '<p class="text-sm text-gray-400 text-center py-8 px-4">No hay conversaciones registradas.</p>';
    return;
  }

  // Store indexed by phone so onclick can look up safely
  window._convMap = {};
  data.forEach(c => { window._convMap[c.telefono] = c; });

  list.innerHTML = data.map(c => {
    const state = BOT_STATE_LABELS[c.estado_bot] || { text: c.estado_bot, cls: 'bg-gray-100 text-gray-600' };
    const initials = (c.nombre || '?').charAt(0).toUpperCase();
    const lastMsg = c.ultimo_recibido || c.ultimo_enviado || '';
    const preview = lastMsg ? lastMsg.slice(0, 45) + (lastMsg.length > 45 ? '…' : '') : 'Sin mensajes';
    const isActive = _activeChat && _activeChat.telefono === c.telefono;
    const tel = escAttr(c.telefono);
    const isPaused = c.estado_bot === 'pausado';
    return `
      <button onclick="openChat('${tel}')"
        class="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 ${isActive ? 'bg-emerald-50' : ''}">
        <div class="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm flex-shrink-0">${escHtml(initials)}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1">
            <p class="text-sm font-medium text-gray-900 truncate">${escHtml(c.nombre || '—')}</p>
            <span
              onclick="event.stopPropagation(); toggleBot('${tel}', ${!isPaused})"
              title="${isPaused ? 'Activar bot' : 'Pausar bot'}"
              class="inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium cursor-pointer select-none ${state.cls} flex-shrink-0 hover:opacity-70 transition-opacity"
            >${state.text}</span>
          </div>
          <p class="text-xs text-gray-500 truncate mt-0.5">${escHtml(preview)}</p>
        </div>
      </button>`;
  }).join('');
}

async function openChat(telefonoOrConv) {
  const conv = typeof telefonoOrConv === 'string'
    ? (window._convMap || {})[telefonoOrConv]
    : telefonoOrConv;
  if (!conv) return;
  _activeChat = { telefono: conv.telefono, nombre: conv.nombre };

  // Update header
  document.getElementById('chatEmpty').classList.add('hidden');
  document.getElementById('chatMessages').classList.remove('hidden');
  document.getElementById('chatInputArea').classList.remove('hidden');
  document.getElementById('chatHeader').classList.remove('hidden');

  const initials = (conv.nombre || '?').charAt(0).toUpperCase();
  document.getElementById('chatAvatar').textContent = initials;
  document.getElementById('chatName').textContent = conv.nombre || '—';
  document.getElementById('chatPhone').textContent = conv.telefono;

  const isPaused = conv.estado_bot === 'pausado';
  document.getElementById('chatBotActions').innerHTML = isPaused
    ? `<button onclick="toggleBot('${escAttr(conv.telefono)}', false)" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors">Activar bot</button>`
    : `<button onclick="toggleBot('${escAttr(conv.telefono)}', true)" class="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors">Pausar bot</button>`;

  // Re-render list to highlight active
  loadConversaciones();

  // Load messages
  await loadChatHistory(conv.telefono);
}

async function loadChatHistory(telefono) {
  const messages = document.getElementById('chatMessages');
  messages.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Cargando mensajes...</p>';

  const res = await apiFetch(`/conversacion/${encodeURIComponent(telefono)}/log`);
  if (!res) return;
  const log = await res.json();

  if (!log.length) {
    messages.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">Sin historial de mensajes aún.</p>';
    return;
  }

  messages.innerHTML = log.map(entry => chatBubble(entry)).join('');
  messages.scrollTop = messages.scrollHeight;
}

function chatBubble(entry) {
  const accion = (entry.accion || '').toUpperCase();
  const time = entry.fecha ? new Date(entry.fecha).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : '';
  const dateStr = entry.fecha ? new Date(entry.fecha).toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) : '';

  if (accion === 'MSG_RECIBIDO') {
    return `<div class="flex justify-start">
      <div class="max-w-xs lg:max-w-md bg-white rounded-2xl rounded-tl-sm shadow-sm px-4 py-2 text-sm text-gray-800">
        <p class="whitespace-pre-wrap break-words">${escHtml(entry.detalle)}</p>
        <p class="text-right text-xs text-gray-400 mt-1">${dateStr} ${time}</p>
      </div>
    </div>`;
  }

  if (accion === 'MSG_ENVIADO' || accion === 'MSG_MANUAL_ENVIADO' || accion === 'SEGUIMIENTO') {
    const label = accion === 'MSG_MANUAL_ENVIADO' ? '👤 Manual' : '🤖 Bot';
    return `<div class="flex justify-end">
      <div class="max-w-xs lg:max-w-md bg-emerald-600 rounded-2xl rounded-tr-sm shadow-sm px-4 py-2 text-sm text-white">
        <p class="whitespace-pre-wrap break-words">${escHtml(entry.detalle)}</p>
        <p class="text-right text-xs text-emerald-200 mt-1">${label} · ${dateStr} ${time}</p>
      </div>
    </div>`;
  }

  // System events (PEDIDO_REGISTRADO, ESCALADO, etc.)
  return `<div class="flex justify-center">
    <div class="bg-gray-200 text-gray-600 text-xs rounded-full px-3 py-1 text-center max-w-xs">
      ${escHtml(entry.accion)} · ${escHtml(entry.detalle.slice(0, 60))}${entry.detalle.length > 60 ? '…' : ''} · ${dateStr} ${time}
    </div>
  </div>`;
}

async function sendChatMessage() {
  if (!_activeChat) return;
  const input = document.getElementById('chatText');
  const mensaje = input.value.trim();
  if (!mensaje) return;

  input.value = '';
  input.style.height = 'auto';

  const res = await apiFetch(`/conversacion/${encodeURIComponent(_activeChat.telefono)}/mensaje`, {
    method: 'POST',
    body: JSON.stringify({ mensaje, nombre: _activeChat.nombre }),
  });
  if (!res) return;

  if (res.ok) {
    await loadChatHistory(_activeChat.telefono);
  } else {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || 'Error enviando mensaje', 'error');
  }
}

async function toggleBot(numero, pausar) {
  const action = pausar ? '/bot/pausar' : '/bot/activar';
  const res = await apiFetch(action, { method: 'POST', body: JSON.stringify({ numero_whatsapp: numero }) });
  if (!res) return;
  if (res.ok) {
    showToast(pausar ? 'Bot pausado para este número' : 'Bot activado para este número');
    await loadConversaciones();
    // Re-open chat to refresh header actions
    if (_activeChat && _activeChat.telefono === numero) {
      openChat(numero);
    }
  } else {
    showToast('Error al cambiar estado del bot', 'error');
  }
}


// ---- Helpers ----
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ---- Logout ----
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await apiFetch('/logout', { method: 'POST' });
  localStorage.removeItem('dashboard_token');
  window.location.href = '/';
});

// ---- WhatsApp status ----
async function refreshWaStatus() {
  const res = await apiFetch('/status');
  if (!res) return;
  const { connected } = await res.json();
  const el = document.getElementById('waStatus');
  if (connected) {
    el.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500"></span> WhatsApp conectado';
    el.className = 'flex items-center gap-1.5 text-xs font-medium text-emerald-600';
  } else {
    el.innerHTML = '<a href="/qr" target="_blank" class="underline">WhatsApp desconectado — escanear QR</a>';
    el.className = 'flex items-center gap-1.5 text-xs font-medium text-red-500';
  }
}

// ---- Init ----
(async () => {
  const res = await fetch(API + '/verify', { headers: headers() });
  if (!res.ok) {
    localStorage.removeItem('dashboard_token');
    window.location.href = '/';
    return;
  }

  await loadConfig();
  await refreshWaStatus();
  setInterval(refreshWaStatus, 15000);
})();
