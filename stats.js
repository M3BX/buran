/**
 * stats.js — статистика с быстрыми фильтрами
 * Кнопки: кто не передавал показания 2 месяца, кто не оплачивал 2 месяца, долг > 300
 */

let countsData = null, payData = null, tarifsData = null;
let allBoxStats = [];
let currentFilters = { buran: 'all', debtMin: null, debtMax: null, customFilter: null };
let currentSort = { column: 'buran', order: 'asc' };

async function loadJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} при загрузке ${url}`);
    return resp.json();
}

async function loadAllData() {
    try {
        const [counts, pay, tarifs] = await Promise.all([
            loadJSON('counts.json'),
            loadJSON('pay.json'),
            loadJSON('tarifs.json')
        ]);
        countsData = counts; payData = pay; tarifsData = tarifs;
        return true;
    } catch(e) {
        console.error(e);
        document.getElementById('statsContainer').innerHTML = '❌ Ошибка загрузки данных. Проверьте JSON-файлы.';
        return false;
    }
}

function parseDateRu(str) {
    let [d,m,y] = str.split('.');
    return new Date(2000+parseInt(y), parseInt(m)-1, parseInt(d));
}

function getTariffForDate(dateObj, sortedTarifs) {
    let applicable = null;
    for (let t of sortedTarifs) {
        if (parseDateRu(t.Дата) <= dateObj) applicable = t.Тариф;
        else break;
    }
    return applicable !== null ? applicable : 0;
}

function getAllBoxes() {
    const map = new Map();
    countsData.counts.forEach(rec => {
        const key = `${rec.Буран}|${rec.Бокс}`;
        if (!map.has(key)) map.set(key, { буран: rec.Буран, бокс: rec.Бокс });
    });
    return Array.from(map.values());
}

function getReadingsForBox(буран, бокс) {
    let norm = (буран === 1) ? Number(бокс) : String(бокс);
    return countsData.counts.filter(r => r.Буран === буран && r.Бокс === norm)
        .sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
}

function getLastReading(буран, бокс) {
    const readings = getReadingsForBox(буран, бокс);
    if (!readings.length) return null;
    return readings[readings.length-1];
}

function getLastPaymentForBox(буран, бокс) {
    let norm = (буран === 1) ? Number(бокс) : String(бокс);
    const payments = payData.pay.filter(p => p.Буран === буран && p.Бокс === norm);
    if (!payments.length) return null;
    return payments.sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата)).pop();
}

function getTotalPayments(буран, бокс) {
    let norm = (буран === 1) ? Number(бокс) : String(бокс);
    return payData.pay.filter(p => p.Буран === буран && p.Бокс === norm)
        .reduce((s,p) => s + p.Платёж, 0);
}

function calculateBoxStats(буран, бокс) {
    const readings = getReadingsForBox(буран, бокс);
    if (readings.length < 2) return null;
    const first = readings[0].Показания;
    const lastReading = readings[readings.length-1];
    const totalConsumption = lastReading.Показания - first;
    const lastDate = parseDateRu(lastReading.Дата);
    const sortedTarifs = [...tarifsData.tarifs].sort((a,b)=>parseDateRu(a.Дата)-parseDateRu(b.Дата));
    const tariff = getTariffForDate(lastDate, sortedTarifs);
    const totalAccrued = totalConsumption * tariff;
    const totalPayments = getTotalPayments(буран, бокс);
    const debt = totalAccrued - totalPayments;
    const lastPayment = getLastPaymentForBox(буран, бокс);
    return {
        буран, бокс,
        lastReading: lastReading.Показания,
        lastReadingDate: lastReading.Дата,
        lastPaymentDate: lastPayment ? lastPayment.Дата : null,
        lastPaymentAmount: lastPayment ? lastPayment.Платёж : 0,
        debt
    };
}

function buildBoxStatsArray() {
    const boxes = getAllBoxes();
    const stats = [];
    for (let box of boxes) {
        const stat = calculateBoxStats(box.буран, box.бокс);
        if (stat) stats.push(stat);
    }
    return stats;
}

function filterStats(stats) {
    let filtered = stats;
    if (currentFilters.buran !== 'all') {
        filtered = filtered.filter(s => s.буран == currentFilters.buran);
    }
    if (currentFilters.debtMin !== null) {
        filtered = filtered.filter(s => s.debt >= currentFilters.debtMin);
    }
    if (currentFilters.debtMax !== null) {
        filtered = filtered.filter(s => s.debt <= currentFilters.debtMax);
    }
    if (currentFilters.customFilter) {
        const cf = currentFilters.customFilter;
        if (cf.type === 'noReadings') {
            filtered = filtered.filter(s => parseDateRu(s.lastReadingDate) < cf.date);
        } else if (cf.type === 'noPayments') {
            filtered = filtered.filter(s => {
                if (!s.lastPaymentDate) return true;
                return parseDateRu(s.lastPaymentDate) < cf.date;
            });
        }
    }
    return filtered;
}

function sortStats(stats) {
    const { column, order } = currentSort;
    if (!column) return stats;
    return [...stats].sort((a,b) => {
        let valA = a[column], valB = b[column];
        if (column === 'lastReadingDate' || column === 'lastPaymentDate') {
            if (!valA) return order === 'asc' ? -1 : 1;
            if (!valB) return order === 'asc' ? 1 : -1;
            valA = parseDateRu(valA); valB = parseDateRu(valB);
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
            return order === 'asc' ? valA - valB : valB - valA;
        }
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        if (valA < valB) return order === 'asc' ? -1 : 1;
        if (valA > valB) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderStatsTable(stats) {
    if (!stats.length) return '<p>Нет данных</p>';
    let html = `<table class="stats-table"><thead><tr>
        <th data-col="buran">Буран</th><th data-col="box">Бокс</th>
        <th data-col="lastReading">Последние показания</th>
        <th data-col="lastPaymentDate">Последняя оплата (дата)</th>
        <th data-col="lastPaymentAmount">Последняя оплата (сумма)</th>
        <th data-col="debt">Долг</th>
    </tr></thead><tbody>`;
    stats.forEach(s => {
        const debtClass = s.debt >= 0 ? 'debt-positive' : 'debt-negative';
        const debtSign = s.debt >= 0 ? '🔴' : '🟢';
        html += `<tr>
            <td data-label="Буран">${s.буран}</td>
            <td data-label="Бокс">${s.бокс}</td>
            <td data-label="Последние показания">${s.lastReading} (${s.lastReadingDate})</td>
            <td data-label="Последняя оплата (дата)">${s.lastPaymentDate || '—'}</td>
            <td data-label="Последняя оплата (сумма)">${s.lastPaymentDate ? s.lastPaymentAmount.toFixed(2)+' руб' : '—'}</td>
            <td data-label="Долг" class="${debtClass}">${debtSign} ${Math.abs(s.debt).toFixed(2)} руб</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    return html;
}

function renderSummary(stats) {
    let totalDebt = 0, debtCount = 0;
    stats.forEach(s => { totalDebt += s.debt; if (s.debt > 0) debtCount++; });
    const avg = stats.length ? totalDebt / stats.length : 0;
    return `<div class="info-grid">
        <div class="info-item"><div class="info-label">Боксов</div><div class="info-value">${stats.length}</div></div>
        <div class="info-item"><div class="info-label">Общий долг</div><div class="info-value ${totalDebt>=0?'debt-positive':'debt-negative'}">${totalDebt>=0?'🔴':'🟢'} ${Math.abs(totalDebt).toFixed(2)} руб</div></div>
        <div class="info-item"><div class="info-label">Средний долг</div><div class="info-value">${avg.toFixed(2)} руб</div></div>
        <div class="info-item"><div class="info-label">Должников (>0)</div><div class="info-value">${debtCount}</div></div>
    </div>`;
}

function updateUI() {
    const filtered = filterStats(allBoxStats);
    const sorted = sortStats(filtered);
    document.getElementById('statsContainer').innerHTML = renderStatsTable(sorted);
    document.getElementById('summaryContainer').innerHTML = renderSummary(sorted);
    // обновить индикаторы сортировки (после перерисовки)
    document.querySelectorAll('.stats-table th').forEach(th => {
        const colMap = {'Буран':'buran','Бокс':'box','Последние показания':'lastReading','Последняя оплата (дата)':'lastPaymentDate','Последняя оплата (сумма)':'lastPaymentAmount','Долг':'debt'};
        const col = colMap[th.innerText.trim()];
        if (col && currentSort.column === col) {
            th.classList.add(currentSort.order);
        } else {
            th.classList.remove('asc','desc');
        }
    });
}

function resetFilters() {
    document.getElementById('filterBuran').value = 'all';
    document.getElementById('filterDebtMin').value = '';
    document.getElementById('filterDebtMax').value = '';
    currentFilters = { buran: 'all', debtMin: null, debtMax: null, customFilter: null };
    updateUI();
}

function applyStandardFilters() {
    currentFilters.customFilter = null;
    currentFilters.buran = document.getElementById('filterBuran').value;
    const min = document.getElementById('filterDebtMin').value;
    const max = document.getElementById('filterDebtMax').value;
    currentFilters.debtMin = min !== '' ? parseFloat(min) : null;
    currentFilters.debtMax = max !== '' ? parseFloat(max) : null;
    updateUI();
}

// Быстрые фильтры
function filterNoReadings() {
    resetFilters();
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
    currentFilters.customFilter = { type: 'noReadings', date: twoMonthsAgo };
    updateUI();
}
function filterNoPayments() {
    resetFilters();
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
    currentFilters.customFilter = { type: 'noPayments', date: twoMonthsAgo };
    updateUI();
}
function filterDebtOver300() {
    resetFilters();
    document.getElementById('filterDebtMin').value = 300;
    document.getElementById('filterDebtMax').value = '';
    currentFilters.debtMin = 300;
    currentFilters.debtMax = null;
    currentFilters.customFilter = null;
    updateUI();
}

async function initStats() {
    const ok = await loadAllData();
    if (!ok) return;
    allBoxStats = buildBoxStatsArray();
    updateUI();

    // Обработчики
    document.getElementById('filterBuran').addEventListener('change', applyStandardFilters);
    document.getElementById('filterDebtMin').addEventListener('input', applyStandardFilters);
    document.getElementById('filterDebtMax').addEventListener('input', applyStandardFilters);
    document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
    document.getElementById('btnNoReadings').addEventListener('click', filterNoReadings);
    document.getElementById('btnNoPayments').addEventListener('click', filterNoPayments);
    document.getElementById('btnDebtOver300').addEventListener('click', filterDebtOver300);

    // Сортировка через делегирование
    document.getElementById('statsContainer').addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (!th) return;
        const colMap = {'Буран':'buran','Бокс':'box','Последние показания':'lastReading','Последняя оплата (дата)':'lastPaymentDate','Последняя оплата (сумма)':'lastPaymentAmount','Долг':'debt'};
        const column = colMap[th.innerText.trim()];
        if (!column) return;
        if (currentSort.column === column) {
            currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.column = column;
            currentSort.order = 'asc';
        }
        updateUI();
    });
}

initStats();