const $ = (selector) => document.querySelector(selector);
const state = { credits: 0, history: [], currentImage: null };

const promptInput = $('#prompt');
const generateBtn = $('#generate-btn');
const formMessage = $('#form-message');
const resultEmpty = $('#result-empty');
const resultLoading = $('#result-loading');
const resultImageWrap = $('#result-image-wrap');
const resultImage = $('#result-image');
const resultDetails = $('#result-details');
const resultStatus = $('#result-status');
const buyModal = $('#buy-modal');
const quantityInput = $('#credit-quantity');

function setMessage(target, message = '', type = '') {
  target.textContent = message;
  target.className = `form-message${type ? ` ${type}` : ''}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace('.', '');
}

function updateCredits(value) {
  state.credits = Number(value || 0);
  $('#credit-count').textContent = state.credits;
  $('#credit-big-count').textContent = state.credits;
}

function updatePromptCount() {
  $('#char-count').textContent = `${promptInput.value.length.toLocaleString('pt-BR')} / 2.000`;
}

function renderHistory() {
  const grid = $('#history-grid');
  $('#history-count').textContent = `${state.history.length} ${state.history.length === 1 ? 'imagem' : 'imagens'}`;
  if (!state.history.length) {
    grid.innerHTML = '<div class="history-empty">Suas imagens geradas vão aparecer aqui.</div>';
    return;
  }
  grid.innerHTML = state.history.map((item) => `
    <article class="history-card" data-generation-id="${escapeHtml(item.id)}" title="Abrir imagem">
      <img src="${item.imageData}" alt="${escapeHtml(item.prompt)}" loading="lazy">
      <div class="history-meta"><p>${escapeHtml(item.prompt)}</p><span>${formatDate(item.createdAt)} · ${item.size}</span></div>
    </article>`).join('');
  grid.querySelectorAll('.history-card').forEach((card) => card.addEventListener('click', () => {
    const item = state.history.find((entry) => entry.id === card.dataset.generationId);
    if (item) showImage(item);
  }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function showImage(item) {
  state.currentImage = item;
  resultEmpty.classList.add('hidden');
  resultLoading.classList.add('hidden');
  resultImageWrap.classList.remove('hidden');
  resultDetails.classList.remove('hidden');
  resultImage.src = item.imageData;
  resultImage.alt = item.prompt;
  $('#result-dimensions').textContent = item.size.replace('x', ' × ');
  $('#result-time').textContent = formatDate(item.createdAt);
  resultStatus.textContent = 'IMAGEM PRONTA';
  resultStatus.style.color = 'var(--lime)';
  resultImageWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setGenerating(isGenerating) {
  generateBtn.disabled = isGenerating;
  generateBtn.querySelector('span:nth-child(2)').textContent = isGenerating ? 'Criando imagem...' : 'Gerar imagem';
  resultEmpty.classList.toggle('hidden', isGenerating);
  resultLoading.classList.toggle('hidden', !isGenerating);
  resultImageWrap.classList.add('hidden');
  resultDetails.classList.add('hidden');
  resultStatus.textContent = isGenerating ? 'PROCESSANDO' : 'AGUARDANDO PROMPT';
  resultStatus.style.color = '';
}

async function loadDashboard() {
  try {
    const response = await fetch('/api/me');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar seu saldo.');
    updateCredits(data.credits);
    state.history = data.history || [];
    renderHistory();
  } catch (error) {
    updateCredits(0);
    setMessage(formMessage, error.message);
  }
}

async function generate() {
  setMessage(formMessage);
  const prompt = promptInput.value.trim();
  if (prompt.length < 3) return setMessage(formMessage, 'Escreva pelo menos 3 caracteres para começar.');
  if (state.credits < 1) return openBuyModal();
  setGenerating(true);
  try {
    const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, size: $('#size').value, quality: $('#quality').value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível gerar a imagem.');
    updateCredits(data.credits);
    state.history.unshift(data.image);
    state.history = state.history.slice(0, 30);
    renderHistory();
    showImage(data.image);
    setMessage(formMessage, 'Imagem criada e salva no seu histórico.', 'success');
  } catch (error) {
    setGenerating(false);
    resultEmpty.classList.remove('hidden');
    resultStatus.textContent = 'ERRO AO GERAR';
    setMessage(formMessage, error.message);
  }
}

function openBuyModal() {
  buyModal.classList.remove('hidden');
  quantityInput.focus();
  updatePurchaseTotal();
}
function closeBuyModal() { buyModal.classList.add('hidden'); setMessage($('#checkout-message')); }
function quantity() { return Math.min(100, Math.max(1, Number(quantityInput.value) || 1)); }
function updatePurchaseTotal() {
  const value = quantity();
  quantityInput.value = value;
  $('#purchase-total').textContent = `R$ ${value.toFixed(2).replace('.', ',')}`;
  $('#checkout-label').textContent = `${value} crédito${value === 1 ? '' : 's'}`;
}

async function checkout() {
  const button = $('#checkout-btn');
  const message = $('#checkout-message');
  button.disabled = true;
  setMessage(message, 'Criando seu pagamento...');
  try {
    const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: quantity() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível criar o pagamento.');
    window.location.href = data.checkoutUrl;
  } catch (error) {
    setMessage(message, error.message);
    button.disabled = false;
  }
}

async function verifyReturnPayment() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('payment_id')) return;
  try {
    const response = await fetch(`/api/verify-payment?payment_id=${encodeURIComponent(params.get('payment_id'))}`);
    const data = await response.json();
    if (response.ok && data.credited) {
      updateCredits(data.credits);
      setMessage(formMessage, `${data.quantity || ''} crédito${data.quantity === 1 ? '' : 's'} adicionado${data.quantity === 1 ? '' : 's'} ao seu saldo.`, 'success');
    } else if (response.ok && data.status === 'pending') {
      setMessage(formMessage, 'O pagamento está pendente. Atualize a página quando for aprovado.');
    } else if (!response.ok) {
      setMessage(formMessage, data.error || 'Não foi possível confirmar o pagamento.');
    }
    window.history.replaceState({}, '', window.location.pathname);
  } catch { setMessage(formMessage, 'Pagamento recebido. O saldo será atualizado após a confirmação.'); }
}

function downloadCurrent() {
  if (!state.currentImage) return;
  const link = document.createElement('a');
  link.href = state.currentImage.imageData;
  link.download = `pixgen-${state.currentImage.id}.png`;
  document.body.appendChild(link); link.click(); link.remove();
}

promptInput.addEventListener('input', updatePromptCount);
generateBtn.addEventListener('click', generate);
$('#download-current').addEventListener('click', downloadCurrent);
$('[data-action="buy"]').addEventListener('click', openBuyModal);
$('#close-modal').addEventListener('click', closeBuyModal);
buyModal.addEventListener('click', (event) => { if (event.target === buyModal) closeBuyModal(); });
$('#quantity-minus').addEventListener('click', () => { quantityInput.value = quantity() - 1; updatePurchaseTotal(); });
$('#quantity-plus').addEventListener('click', () => { quantityInput.value = quantity() + 1; updatePurchaseTotal(); });
quantityInput.addEventListener('input', updatePurchaseTotal);
$('#checkout-btn').addEventListener('click', checkout);

updatePromptCount();
loadDashboard();
verifyReturnPayment();
