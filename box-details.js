/**
 * box-details.js — детальная история бокса с расчётом баланса
 */

let countsData = null, payData = null, tarifsData = null;
let boxesByBuran = { 1: [], 2: [] };

const buranSelect = document.getElementById('buranSelect');
const boxSelect = document.getElementById('boxSelect');
const loadBtn = document.getElementById('loadHistoryBtn');
const historyContainer = document.getElementById('historyContainer');
const balanceContainer = document.getElementById('balanceContainer');

async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

async function loadAllData() {
    try {
        const [counts, pay, tarifs] = await Promise.all([
            loadJSON('counts.json'),
            loadJSON('pay.json'),
            loadJSON('tarifs.json')
        ]);
        countsData = counts;
        payData = pay;
        tarifsData = tarifs;

        const unique = { 1: new Set(), 2: new Set() };
        countsData.counts.forEach(rec => {
            if (rec.Буран === 1) unique[1].add(rec.Бокс);
            else if (rec.Буран === 2) unique[2].add(rec.Бокс);
        });
        boxesByBuran[1] = Array.from(unique[1]).sort((a,b) => a - b);
        boxesByBuran[2] = Array.from(unique[2]).sort();
        return true;
    } catch(e) {
        console.error(e);
        historyContainer.innerHTML = '❌ Ошибка загрузки данных. Проверьте JSON-файлы.';
        return false;
    }
}

function parseDateRu(str) {
    let [d, m, y] = str.split('.');
    return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

buranSelect.addEventListener('change', () => {
    const buran = buranSelect.value;
    if (!buran) {
        boxSelect.disabled = true;
        boxSelect.innerHTML = '<option value="">-- сначала выберите Буран --</option>';
        return;
    }
    const boxes = boxesByBuran[parseInt(buran)] || [];
    boxSelect.disabled = false;
    boxSelect.innerHTML = '<option value="">-- выберите бокс --</option>';
    boxes.forEach(b => {
        const option = document.createElement('option');
        option.value = b;
        option.textContent = `Бокс ${b}`;
        boxSelect.appendChild(option);
    });
});

async function loadHistory() {
    const buran = buranSelect.value;
    const box = boxSelect.value;
    if (!buran || !box) {
        historyContainer.innerHTML = '<div class="empty-state">⚠️ Выберите Буран и бокс</div>';
        balanceContainer.style.display = 'none';
        return;
    }
    const буран = parseInt(buran);
    let боксNorm = (буран === 1) ? Number(box) : String(box);

    // Показания
    let readings = countsData.counts.filter(r => r.Буран === буран && r.Бокс === боксNorm)
        .map(r => ({ ...r, тип: 'reading' }));

    // Платежи
    let payments = payData.pay.filter(p => p.Буран === буран && p.Бокс === боксNorm)
        .map(p => ({ Дата: p.Дата, Платёж: p.Платёж, тип: 'payment' }));

    if (readings.length === 0) {
        historyContainer.innerHTML = '<div class="empty-state">📭 Нет данных для выбранного бокса</div>';
        balanceContainer.style.display = 'none';
        return;
    }

    // Рассчитываем начисления между показаниями
    const readingsSorted = [...readings].sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
    const tarifsSorted = [...tarifsData.tarifs].sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
    let accruals = [];

    for (let i = 1; i < readingsSorted.length; i++) {
        const prev = readingsSorted[i-1];
        const curr = readingsSorted[i];
        const consumption = curr.Показания - prev.Показания;
        const endDate = parseDateRu(curr.Дата);
        let tariff = null;
        for (let t of tarifsSorted) {
            if (parseDateRu(t.Дата) <= endDate) tariff = t.Тариф;
            else break;
        }
        if (tariff !== null) {
            const amount = consumption * tariff;
            accruals.push({
                Дата: curr.Дата,
                начисление: amount,
                тип: 'accrual'
            });
        }
    }

    // Объединяем все события и сортируем по дате
    let allEvents = [...readings, ...payments, ...accruals];
    allEvents.sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));

    // Вычисляем баланс нарастающим итогом
    let balance = 0;
    let eventsWithBalance = [];
    for (let ev of allEvents) {
        if (ev.тип === 'accrual') {
            balance += ev.начисление;
        } else if (ev.тип === 'payment') {
            balance -= ev.Платёж;
        }
        eventsWithBalance.push({ ...ev, balanceAfter: balance });
    }

    const currentBalance = balance;
    const balanceClass = currentBalance >= 0 ? 'balance-positive' : 'balance-negative';
    const balanceSign = currentBalance >= 0 ? '🔴' : '🟢';
    const balanceText = currentBalance >= 0 ? 'Долг' : 'Переплата';

    balanceContainer.style.display = 'block';
    balanceContainer.innerHTML = `
        <div class="balance-card">
            <div class="balance-amount ${balanceClass}">${balanceSign} ${Math.abs(currentBalance).toFixed(2)} руб</div>
            <div style="font-size:0.9rem;">${balanceText}</div>
        </div>
    `;

    // Формируем хронологию
    let html = '<div class="timeline">';
    for (let ev of eventsWithBalance) {
        if (ev.тип === 'reading') {
            html += `
                <div class="event-card reading">
                    <div class="event-header">
                        <span class="event-date">📅 ${ev.Дата}</span>
                        <span class="event-type reading">Показания</span>
                    </div>
                    <div class="event-details">
                        <div class="detail-item"><span class="detail-label">📊 Показания:</span> ${ev.Показания} кВт·ч</div>
                        <div class="detail-item"><span class="detail-label">💳 Баланс после:</span> ${ev.balanceAfter >= 0 ? '🔴' : '🟢'} ${Math.abs(ev.balanceAfter).toFixed(2)} руб</div>
                    </div>
                </div>
            `;
        } else if (ev.тип === 'payment') {
            html += `
                <div class="event-card payment">
                    <div class="event-header">
                        <span class="event-date">📅 ${ev.Дата}</span>
                        <span class="event-type payment">Платёж</span>
                    </div>
                    <div class="event-details">
                        <div class="detail-item"><span class="detail-label">💵 Сумма:</span> ${ev.Платёж.toFixed(2)} руб</div>
                        <div class="detail-item"><span class="detail-label">💳 Баланс после:</span> ${ev.balanceAfter >= 0 ? '🔴' : '🟢'} ${Math.abs(ev.balanceAfter).toFixed(2)} руб</div>
                    </div>
                </div>
            `;
        } else if (ev.тип === 'accrual') {
            html += `
                <div class="event-card accrual">
                    <div class="event-header">
                        <span class="event-date">📅 ${ev.Дата}</span>
                        <span class="event-type accrual">Начисление</span>
                    </div>
                    <div class="event-details">
                        <div class="detail-item"><span class="detail-label">💰 Начислено:</span> ${ev.начисление.toFixed(2)} руб</div>
                        <div class="detail-item"><span class="detail-label">💳 Баланс после:</span> ${ev.balanceAfter >= 0 ? '🔴' : '🟢'} ${Math.abs(ev.balanceAfter).toFixed(2)} руб</div>
                    </div>
                </div>
            `;
        }
    }
    html += '</div>';
    historyContainer.innerHTML = html;
}

loadBtn.addEventListener('click', loadHistory);

loadAllData();