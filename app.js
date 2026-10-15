/* ============================================================
   MiCaja — Caja diaria para pequeños comercios
   Datos guardados localmente (localStorage)
   ============================================================ */

/* ================== Persistencia con versión ==================
   LS_KEY apunta SIEMPRE a la clave actual.
   LS_LEGACY es la clave vieja desde la que migramos una sola vez. */
const LS_KEY    = 'micaja_v2';
const LS_LEGACY = 'micaja_v1';
const LS_VERSION = 2;

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

const CATS = {
  ingreso: [
    { id: 'venta',    nombre: 'Venta',           icon: '🛍️' },
    { id: 'servicio', nombre: 'Servicio',        icon: '🔧' },
    { id: 'cobro',    nombre: 'Cobro pendiente', icon: '💰' },
    { id: 'otro_ing', nombre: 'Otro ingreso',    icon: '➕' },
  ],
  egreso: [
    { id: 'mercaderia', nombre: 'Mercadería',   icon: '📦' },
    { id: 'alquiler',   nombre: 'Alquiler',     icon: '🏠' },
    { id: 'servicios',  nombre: 'Servicios',    icon: '💡' },
    { id: 'sueldos',    nombre: 'Sueldos',      icon: '👥' },
    { id: 'otro_egr',   nombre: 'Otro gasto',   icon: '➖' },
  ],
};

const METODOS = {
  efectivo:      { nombre: 'Efectivo',      color: '#6366f1' },
  debito:        { nombre: 'Débito',        color: '#8b5cf6' },
  credito:       { nombre: 'Crédito',       color: '#ec4899' },
  transferencia: { nombre: 'Transferencia', color: '#10b981' },
};

/* Estructura canónica del estado.
   Cualquier campo nuevo que agregues en el futuro se declara acá. */
function emptyState() {
  return {
    version: LS_VERSION,
    settings: {
      nombre: 'Mi Comercio',
      saldoInicial: 0,
      // espacios reservados para las próximas etapas (Drive, comprobantes):
      comercioId: null,
      drive: { connected: false, folderId: null, email: null, lastSync: null },
    },
    days: {},
    // reservado para etapa 3:
    comprobantes: [],
    facturas: [],
  };
}

/* Migración: recibe lo que había en localStorage (v1 o v2)
   y devuelve siempre un estado con la forma actual. */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();

  const s = emptyState();

  // v1 -> v2: no había version, settings.drive, ni comprobantes
  if (raw.settings) {
    s.settings = { ...s.settings, ...raw.settings };
    // asegurar que drive exista aunque venga de v1
    s.settings.drive = { ...emptyState().settings.drive, ...(raw.settings.drive || {}) };
  }
  if (raw.days && typeof raw.days === 'object') {
    s.days = raw.days;
  }
  if (Array.isArray(raw.comprobantes)) s.comprobantes = raw.comprobantes;
  if (Array.isArray(raw.facturas))     s.facturas     = raw.facturas;

  s.version = LS_VERSION;
  return s;
}

/* ================== Estado global ================== */
let state = loadState();
let formTipo = 'ingreso';

function loadState() {
  // 1) intentar la clave actual
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Estado actual corrupto, intentando migrar:', e); }

  // 2) migrar desde la clave vieja (v1)
  try {
    const legacy = localStorage.getItem(LS_LEGACY);
    if (legacy) {
      const migrated = migrate(JSON.parse(legacy));
      // guardamos ya migrado y borramos la vieja
      localStorage.setItem(LS_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LS_LEGACY);
      console.info('MiCaja: datos migrados de v1 a v2 ✓');
      return migrated;
    }
  } catch (e) { console.warn('Datos v1 ilegibles, arrancando de cero:', e); }

  // 3) primera vez
  return emptyState();
}

function saveState() {
  state.version = LS_VERSION;
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function todayKey() {
  return new Date().toLocaleDateString('sv');
}

function getDay(key) {
  if (!state.days[key]) {
    const saldo = (key === todayKey()) ? Number(state.settings.saldoInicial) || 0 : 0;
    state.days[key] = { saldoInicial: saldo, cierre: null, movs: [] };
  }
  return state.days[key];
}

function formatMoney(n) {
  return '$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatFecha(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${d} de ${MESES[m - 1]} de ${y}`;
}
function formatHora(ts) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function catInfo(tipo, id) {
  return CATS[tipo].find(c => c.id === id) || { nombre: id, icon: '💵' };
}
function getCatName(tipo, id) { return catInfo(tipo, id).nombre; }
function getCatIcon(tipo, id) { return catInfo(tipo, id).icon; }

/* ================== Cálculos ================== */
function totalsDay(day) {
  let ventas = 0, egresos = 0, ingEfectivo = 0, egrEfectivo = 0, otros = 0;
  for (const m of day.movs) {
    if (m.tipo === 'ingreso') {
      ventas += m.monto;
      if (m.metodo === 'efectivo') ingEfectivo += m.monto; else otros += m.monto;
    } else {
      egresos += m.monto;
      if (m.metodo === 'efectivo') egrEfectivo += m.monto; else otros -= m.monto;
    }
  }
  const efectivo = day.saldoInicial + ingEfectivo - egrEfectivo;
  return { ventas, egresos, efectivo, otros, ingEfectivo, egrEfectivo };
}
function sortedDays() {
  return Object.keys(state.days).sort().reverse();
}
function movsLastNDays(n, tipos = ['ingreso', 'egreso']) {
  const keys = sortedDays().slice(0, n);
  const out = [];
  for (const k of keys) {
    for (const m of state.days[k].movs) {
      if (tipos.includes(m.tipo)) out.push({ ...m, fecha: k });
    }
  }
  return out;
}

/* ================== Navegación ================== */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'stats') renderStats();
  });
});

/* ================== Toast ================== */
let toastTimer;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast', 2400);
}

/* ================== Vista Caja ================== */
function fillCategorias() {
  const sel = document.getElementById('fCategoria');
  sel.innerHTML = CATS[formTipo].map(c => `<option value="${c.id}">${c.icon} ${c.nombre}</option>`).join('');
}

document.querySelectorAll('.tipo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tipo-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    formTipo = btn.dataset.tipo;
    fillCategorias();
  });
});

document.getElementById('btnAdd').addEventListener('click', () => {
  const monto = parseFloat(document.getElementById('fMonto').value);
  if (!monto || monto <= 0) { toast('Ingresá un monto válido', 'err'); return; }

  const day = getDay(todayKey());
  day.movs.push({
    id: Date.now() + Math.random().toString(16).slice(2),
    tipo: formTipo,
    cat: document.getElementById('fCategoria').value,
    metodo: document.getElementById('fMetodo').value,
    monto: Math.round(monto * 100) / 100,
    nota: document.getElementById('fNota').value.trim(),
    ts: Date.now(),
  });
  saveState();

  document.getElementById('fMonto').value = '';
  document.getElementById('fNota').value = '';
  document.getElementById('fMonto').focus();

  renderCaja();
  toast(formTipo === 'ingreso' ? 'Ingreso agregado ✓' : 'Egreso agregado ✓', 'ok');
});

function movItemHTML(m, dayKey) {
  const sign = m.tipo === 'ingreso' ? '+' : '−';
  return `
    <li class="mov-item">
      <div class="mov-ico ${m.tipo}">${getCatIcon(m.tipo, m.cat)}</div>
      <div class="mov-info">
        <div class="mov-cat">${getCatName(m.tipo, m.cat)}${m.nota ? ` — <span style="font-weight:500;color:var(--ink-soft)">${escapeHTML(m.nota)}</span>` : ''}</div>
        <div class="mov-meta">
          <span class="mov-tag">${METODOS[m.metodo].nombre}</span>
          <span>${formatHora(m.ts)}</span>
        </div>
      </div>
      <span class="mov-monto ${m.tipo}">${sign} ${formatMoney(m.monto)}</span>
      <button class="mov-del" data-id="${m.id}" data-day="${dayKey}" title="Eliminar">✕</button>
    </li>`;
}
function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

document.addEventListener('click', e => {
  const del = e.target.closest('.mov-del');
  if (!del) return;
  const day = state.days[del.dataset.day];
  if (!day) return;
  if (!confirm('¿Eliminar este movimiento?')) return;
  day.movs = day.movs.filter(m => m.id !== del.dataset.id);
  saveState();
  renderCaja();
  renderHistorial();
});

function renderCaja() {
  const key = todayKey();
  const day = getDay(key);
  const t = totalsDay(day);

  document.getElementById('cardVentas').textContent = formatMoney(t.ventas);
  document.getElementById('cardVentasCount').textContent = day.movs.filter(m => m.tipo === 'ingreso').length + ' movimientos';
  document.getElementById('cardEgresos').textContent = formatMoney(t.egresos);
  document.getElementById('cardEgresosCount').textContent = day.movs.filter(m => m.tipo === 'egreso').length + ' movimientos';
  document.getElementById('cardEfectivo').textContent = formatMoney(t.efectivo);
  document.getElementById('cardEfectivoSub').textContent = 'saldo inicial: ' + formatMoney(day.saldoInicial);
  document.getElementById('cardOtros').textContent = formatMoney(t.otros);

  const list = document.getElementById('movList');
  const empty = document.getElementById('movEmpty');
  document.getElementById('movCount').textContent = day.movs.length;
  list.innerHTML = day.movs.slice().reverse().map(m => movItemHTML(m, key)).join('');
  empty.style.display = day.movs.length ? 'none' : 'block';

  document.getElementById('todayLine').textContent = formatFecha(key);
  document.getElementById('dayBadge').textContent = day.cierre ? '✅ Caja cerrada' : '🟢 Caja abierta';
}

/* ================== Cierre de caja ================== */
document.getElementById('btnCloseDay').addEventListener('click', () => {
  const day = getDay(todayKey());
  const t = totalsDay(day);
  document.getElementById('closeExpected').textContent = formatMoney(t.efectivo);
  document.getElementById('closeCounted').value = '';
  document.getElementById('closeDiff').className = 'close-diff';
  document.getElementById('closeDiff').textContent = '';
  document.getElementById('modalClose').classList.add('open');
  setTimeout(() => document.getElementById('closeCounted').focus(), 100);
});

document.getElementById('closeCounted').addEventListener('input', () => {
  const day = getDay(todayKey());
  const esperado = totalsDay(day).efectivo;
  const contado = parseFloat(document.getElementById('closeCounted').value) || 0;
  const diff = Math.round((contado - esperado) * 100) / 100;
  const el = document.getElementById('closeDiff');
  if (document.getElementById('closeCounted').value === '') { el.className = 'close-diff'; return; }
  if (diff === 0) { el.className = 'close-diff ok'; el.textContent = '✓ Cuadra perfecto. ¡Bien hecho!'; }
  else if (diff > 0) { el.className = 'close-diff ok'; el.textContent = `Sobran ${formatMoney(diff)} en caja.`; }
  else { el.className = 'close-diff bad'; el.textContent = `Faltan ${formatMoney(Math.abs(diff))} en caja.`; }
});

document.getElementById('closeCancel').addEventListener('click', () => {
  document.getElementById('modalClose').classList.remove('open');
});

document.getElementById('closeConfirm').addEventListener('click', () => {
  const counted = parseFloat(document.getElementById('closeCounted').value);
  if (isNaN(counted) || counted < 0) { toast('Ingresá el efectivo contado', 'err'); return; }

  const key = todayKey();
  const day = getDay(key);
  const t = totalsDay(day);
  const diff = Math.round((counted - t.efectivo) * 100) / 100;

  day.cierre = { contado: counted, esperado: t.efectivo, diff, ts: Date.now() };
  saveState();
  document.getElementById('modalClose').classList.remove('open');

  document.getElementById('doneSummary').innerHTML = `
    <div class="done-row"><span>Ventas del día</span><strong>${formatMoney(t.ventas)}</strong></div>
    <div class="done-row"><span>Egresos</span><strong>${formatMoney(t.egresos)}</strong></div>
    <div class="done-row"><span>Efectivo esperado</span><strong>${formatMoney(t.efectivo)}</strong></div>
    <div class="done-row"><span>Efectivo contado</span><strong>${formatMoney(counted)}</strong></div>
    <div class="done-row"><span>${diff === 0 ? 'Resultado' : (diff > 0 ? 'Sobrante' : 'Faltante')}</span>
      <strong style="color:${diff < 0 ? 'var(--red)' : 'var(--green)'}">${formatMoney(Math.abs(diff))}</strong></div>
    <div class="done-row"><span>Movimientos</span><strong>${day.movs.length}</strong></div>`;
  document.getElementById('modalDone').classList.add('open');
  renderCaja();
});

document.getElementById('doneOk').addEventListener('click', () => {
  document.getElementById('modalDone').classList.remove('open');
});

/* ================== Exportar día ================== */
document.getElementById('btnExportDay').addEventListener('click', () => {
  const key = todayKey();
  const day = getDay(key);
  const t = totalsDay(day);
  let csv = 'hora;tipo;categoria;medio;monto;nota\n';
  for (const m of day.movs) {
    csv += `${formatHora(m.ts)};${m.tipo};${getCatName(m.tipo, m.cat)};${METODOS[m.metodo].nombre};${m.monto.toFixed(2)};${(m.nota || '').replace(/;/g, ',')}\n`;
  }
  csv += `\nVentas;${t.ventas.toFixed(2)}\nEgresos;${t.egresos.toFixed(2)}\nEfectivo esperado;${t.efectivo.toFixed(2)}`;
  downloadCSV(csv, `caja_${key}.csv`);
  toast('Día exportado en CSV ✓', 'ok');
});

document.getElementById('btnExportAll').addEventListener('click', () => {
  let csv = 'fecha;hora;tipo;categoria;medio;monto;nota\n';
  for (const k of sortedDays()) {
    for (const m of state.days[k].movs) {
      csv += `${k};${formatHora(m.ts)};${m.tipo};${getCatName(m.tipo, m.cat)};${METODOS[m.metodo].nombre};${m.monto.toFixed(2)};${(m.nota || '').replace(/;/g, ',')}\n`;
    }
  }
  downloadCSV(csv, 'micaja_todo.csv');
  toast('Todo exportado en CSV ✓', 'ok');
});

document.getElementById('btnExportJSON').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `micaja_backup_${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Respaldo JSON descargado ✓', 'ok');
});

function downloadCSV(csv, filename) {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ================== Historial ================== */
const histDate = document.getElementById('histDate');
histDate.addEventListener('change', renderHistorial);

function renderHistorial() {
  if (!histDate.value) histDate.value = todayKey();
  const key = histDate.value;
  const day = state.days[key];
  const empty = document.getElementById('histEmpty');
  const list = document.getElementById('histList');

  if (!day || day.movs.length === 0) {
    document.getElementById('histVentas').textContent = formatMoney(0);
    document.getElementById('histEgresos').textContent = formatMoney(0);
    document.getElementById('histEfectivo').textContent = formatMoney(0);
    const est = document.getElementById('histEstado');
    est.textContent = '—'; est.className = 'card-value';
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  const t = totalsDay(day);
  document.getElementById('histVentas').textContent = formatMoney(t.ventas);
  document.getElementById('histEgresos').textContent = formatMoney(t.egresos);
  document.getElementById('histEfectivo').textContent = formatMoney(t.efectivo);

  const est = document.getElementById('histEstado');
  if (day.cierre) {
    est.textContent = 'Cerrada ✓';
    est.className = 'card-value state-closed';
  } else {
    est.textContent = 'Abierta';
    est.className = 'card-value state-open';
  }

  list.innerHTML = day.movs.slice().reverse().map(m => movItemHTML(m, key)).join('');
  empty.style.display = 'none';
}

/* ================== Estadísticas ================== */
let chartV = null, chartM = null, chartC = null;

function renderStats() {
  // Últimos 14 días con datos
  const keys = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(d.toLocaleDateString('sv'));
  }

  const ventasArr = [], egrArr = [], labels = [];
  for (const k of keys) {
    const day = state.days[k];
    const t = day ? totalsDay(day) : { ventas: 0, egresos: 0 };
    ventasArr.push(t.ventas);
    egrArr.push(t.egresos);
    labels.push(k.slice(8) + '/' + k.slice(5, 7));
  }

  if (chartV) chartV.destroy();
  chartV = new Chart(document.getElementById('chartVentas'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ventas', data: ventasArr, backgroundColor: '#6366f1', borderRadius: 6, maxBarThickness: 26 },
        { label: 'Egresos', data: egrArr, backgroundColor: '#f0a5a5', borderRadius: 6, maxBarThickness: 26 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 18, font: { family: 'Plus Jakarta Sans', weight: 600 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatMoney(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans' } } },
        y: { grid: { color: '#eef0f6' }, ticks: { callback: v => '$' + v, font: { family: 'Plus Jakarta Sans' } } },
      },
    },
  });

  // Medios de pago (30 días)
  const movs30 = movsLastNDays(30);
  const porMedio = {};
  for (const m of movs30) porMedio[m.metodo] = (porMedio[m.metodo] || 0) + m.monto;
  const mediosKeys = Object.keys(porMedio);

  if (chartM) chartM.destroy();
  chartM = new Chart(document.getElementById('chartMedios'), {
    type: 'doughnut',
    data: {
      labels: mediosKeys.map(k => METODOS[k].nombre),
      datasets: [{ data: mediosKeys.map(k => porMedio[k]), backgroundColor: mediosKeys.map(k => METODOS[k].color), borderWidth: 3, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { family: 'Plus Jakarta Sans', weight: 600 } } },
        tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.raw)}` } },
      },
    },
  });

  // Ingresos por categoría (30 días)
  const porCat = {};
  for (const m of movs30.filter(m => m.tipo === 'ingreso')) {
    const nombre = getCatName('ingreso', m.cat);
    porCat[nombre] = (porCat[nombre] || 0) + m.monto;
  }
  const catKeys = Object.keys(porCat);
  const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9'];

  if (chartC) chartC.destroy();
  chartC = new Chart(document.getElementById('chartCat'), {
    type: 'bar',
    data: {
      labels: catKeys,
      datasets: [{ data: catKeys.map(k => porCat[k]), backgroundColor: catKeys.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 8, maxBarThickness: 34 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { color: '#eef0f6' }, ticks: { callback: v => '$' + v, font: { family: 'Plus Jakarta Sans' } } },
        y: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', weight: 700 } } },
      },
    },
  });

  // Tarjetas resumen
  const ultimos7 = keys.slice(-7).map(k => state.days[k]).filter(Boolean);
  const ventas7 = ultimos7.reduce((s, d) => s + totalsDay(d).ventas, 0);
  document.getElementById('statPromedio').textContent = formatMoney(ultimos7.length ? ventas7 / ultimos7.length : 0);

  let mejorKey = null, mejorVal = -1;
  for (const k of keys) {
    const day = state.days[k];
    if (!day) continue;
    const v = totalsDay(day).ventas;
    if (v > mejorVal) { mejorVal = v; mejorKey = k; }
  }
  if (mejorKey && mejorVal > 0) {
    const [y, m, d] = mejorKey.split('-');
    document.getElementById('statMejor').textContent = formatMoney(mejorVal);
    document.getElementById('statMejorFecha').textContent = `${d} de ${MESES[Number(m) - 1]}`;
  } else {
    document.getElementById('statMejor').textContent = '—';
    document.getElementById('statMejorFecha').textContent = 'sin datos aún';
  }

  const mesKey = todayKey().slice(0, 7);
  let totalMes = 0;
  for (const k of Object.keys(state.days)) {
    if (k.startsWith(mesKey)) totalMes += totalsDay(state.days[k]).ventas;
  }
  document.getElementById('statMes').textContent = formatMoney(totalMes);
  const [ay, am] = mesKey.split('-');
  document.getElementById('statMesNombre').textContent = MESES[Number(am) - 1] + ' ' + ay;
}

/* ================== Config ================== */
function renderConfig() {
  document.getElementById('cfgNombre').value = state.settings.nombre;
  document.getElementById('cfgSaldo').value = state.settings.saldoInicial;
  document.getElementById('logoSub').textContent = state.settings.nombre;
}

document.getElementById('btnSaveConfig').addEventListener('click', () => {
  const nombre = document.getElementById('cfgNombre').value.trim() || 'Mi Comercio';
  const saldo = parseFloat(document.getElementById('cfgSaldo').value) || 0;
  state.settings.nombre = nombre;
  state.settings.saldoInicial = saldo;
  const today = getDay(todayKey());
  if (today.movs.length === 0) today.saldoInicial = saldo;
  saveState();
  renderConfig();
  renderCaja();
  toast('Ajustes guardados ✓', 'ok');
});

document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('¿Seguro? Se borrarán TODOS los datos de caja.')) return;
  if (!confirm('Última confirmación: esta acción no se puede deshacer.')) return;
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_LEGACY);
  state = loadState();
  renderConfig();
  renderCaja();
  renderHistorial();
  toast('Datos borrados. Empezá de cero.', 'err');
});

/* ================== PWA: service worker ================== */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin soporte o sin https */ });
  });
}

/* ===== PWA: botón "Instalar app" =====
   Chrome/Edge/Android muestran el botón automáticamente cuando la app
   es instalable. En iOS Safari no hay evento: se instala desde
   "Compartir → Agregar a pantalla de inicio". */
let deferredInstall = null;
const btnInstall = document.getElementById('btnInstall');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener('click', async () => {
  if (!deferredInstall) {
    toast('En iPhone/iPad: Compartir → "Agregar a pantalla de inicio"', '');
    return;
  }
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') toast('¡MiCaja se está instalando! 🎉', 'ok');
  deferredInstall = null;
  btnInstall.hidden = true;
});

window.addEventListener('appinstalled', () => {
  btnInstall.hidden = true;
  toast('MiCaja instalada como app ✓', 'ok');
});

/* ================== Arranque ================== */
fillCategorias();
renderConfig();
renderCaja();
renderHistorial();
document.getElementById('fMonto').focus();
