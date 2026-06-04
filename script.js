/**
 * script.js — учёт электроэнергии с двухуровневым выбором (Буран → Бокс)
 * 
 * Функции:
 * - Загрузка данных из counts.json, pay.json, tarifs.json, alerts.json
 * - Динамическое добавление/удаление блоков с выбором Бурана и бокса
 * - Подгрузка последних показаний из JSON в placeholder
 * - Сохранение состояния (выбранные бураны и боксы) в localStorage (показания не сохраняются)
 * - Расчёт общего расхода, начисления и долга по всем блокам
 * - Показ уведомлений из alerts.json при выборе бокса (одно окно для всех сообщений)
 * 
 * @version 12.0
 */

// ===================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====================

let countsData = null;
let tarifsData = null;
let payData = null;
let boxesByBuran = { 1: [], 2: [] };
let alertsData = [];

const boxesContainer = document.getElementById('boxesContainer');
const addBoxBtn = document.getElementById('addBoxBtn');
const clearStorageBtn = document.getElementById('clearStorageBtn');
const calcAllBtn = document.getElementById('calcAllBtn');

// ===================== ЗАГРУЗКА ДАННЫХ =====================

async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} при загрузке ${url}`);
    return await response.json();
}

async function loadAllData() {
    try {
        const [counts, tarifs, pay, alerts] = await Promise.all([
            loadJSON('counts.json'),
            loadJSON('tarifs.json'),
            loadJSON('pay.json'),
            loadJSON('alerts.json').catch(() => ({ alerts: [] })) // если файла нет, не ошибка
        ]);
        countsData = counts;
        tarifsData = tarifs;
        payData = pay;
        alertsData = alerts.alerts || [];

        const unique = { 1: new Set(), 2: new Set() };
        countsData.counts.forEach(rec => {
            if (rec.Буран === 1) unique[1].add(rec.Бокс);
            else if (rec.Буран === 2) unique[2].add(rec.Бокс);
        });
        boxesByBuran[1] = Array.from(unique[1]).sort((a,b) => a - b);
        boxesByBuran[2] = Array.from(unique[2]).sort();
        return true;
    } catch (error) {
        console.error(error);
        const tariffInfo = document.getElementById('tariffInfo');
        if (tariffInfo) tariffInfo.innerHTML = '❌ Ошибка загрузки данных. Проверьте JSON-файлы.';
        return false;
    }
}

// ===================== УВЕДОМЛЕНИЯ =====================

function getAlertsForBox(boxId) {
    return alertsData.filter(alert =>
        alert.boxIds.includes(boxId) || alert.boxIds.includes("*")
    );
}

function showAlertsForBox(boxId) {
    const alerts = getAlertsForBox(boxId);
    if (alerts.length === 0) return;

    // Используем модальное окно resultModal (оно же для результатов)
    const modal = document.getElementById('resultModal');
    const modalBody = document.getElementById('modalBody');

    let html = `<div style="text-align:left; padding: 10px;">`;
    alerts.forEach(alert => {
        html += `<div style="margin-bottom: 12px; padding: 8px; background: #fef3c7; border-radius: 12px;">
                    <div style="font-size: 1.2rem;">⚠️</div>
                    <div style="font-weight: bold;">${alert.message}</div>
                </div>`;
    });
    html += `</div>`;

    modalBody.innerHTML = html;
    modal.style.display = 'flex';
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

function parseDateRu(str) {
    let [day, month, year] = str.split('.');
    return new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day));
}

function getTariffForDate(dateObj, tarifsSorted) {
    let applicable = null;
    for (let t of tarifsSorted) {
        if (parseDateRu(t.Дата) <= dateObj) applicable = t.Тариф;
        else break;
    }
    return applicable !== null ? applicable : 0;
}

// ===================== РАБОТА С ПОКАЗАНИЯМИ И ДОЛГОМ =====================

function getLastReading(буран, бокс) {
    let боксNorm;
    if (буран === 1) боксNorm = typeof бокс === 'string' ? parseInt(бокс, 10) : бокс;
    else боксNorm = String(бокс);
    const records = countsData.counts.filter(r => r.Буран === буран && r.Бокс === боксNorm);
    if (records.length === 0) return null;
    const sorted = [...records].sort((a, b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
    return sorted[sorted.length - 1];
}

function calculatePayments(буран, бокс) {
    let боксNorm;
    if (буран === 1) боксNorm = Number(бокс);
    else боксNorm = String(бокс);
    const records = countsData.counts.filter(r => r.Буран === буран && r.Бокс === боксNorm);
    if (records.length < 2) return [];
    const sorted = [...records].sort((a, b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
    const tarifsSorted = [...tarifsData.tarifs].sort((a, b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
    let result = [];
    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i-1], curr = sorted[i];
        const consumption = curr.Показания - prev.Показания;
        const endDate = parseDateRu(curr.Дата);
        const tariff = getTariffForDate(endDate, tarifsSorted);
        const amount = consumption * tariff;
        result.push({
            период: `${prev.Дата} — ${curr.Дата}`,
            расход: consumption,
            тариф: tariff,
            сумма: parseFloat(amount.toFixed(2))
        });
    }
    return result;
}

function getDebt(буран, бокс) {
    let боксNorm;
    if (буран === 1) боксNorm = Number(бокс);
    else боксNorm = String(бокс);
    const payments = calculatePayments(буран, боксNorm);
    const payRecords = payData.pay.filter(p => p.Буран === буран && p.Бокс === боксNorm);
    let events = [];
    payments.forEach(p => {
        let endDate = p.период.split(' — ')[1];
        events.push({ дата: endDate, тип: 'начисление', сумма: p.сумма });
    });
    payRecords.forEach(pp => {
        events.push({ дата: pp.Дата, тип: 'платёж', сумма: pp.Платёж });
    });
    events.sort((a,b) => parseDateRu(a.дата) - parseDateRu(b.дата));
    let accrued = 0, paid = 0, history = [];
    for(let ev of events) {
        if(ev.тип === 'начисление') accrued += ev.сумма;
        else paid += ev.сумма;
        history.push({
            дата: ev.дата,
            тип: ev.тип,
            сумма_операции: ev.сумма,
            начисления_нарастающим: accrued,
            платежи_нарастающим: paid,
            сальдо: parseFloat((accrued-paid).toFixed(2))
        });
    }
    return history;
}

// ===================== ДИНАМИЧЕСКИЕ БЛОКИ =====================

function updateBoxOptions(buranSelect, boxSelect) {
    const buran = parseInt(buranSelect.value);
    const boxes = boxesByBuran[buran] || [];
    boxSelect.innerHTML = '<option value="">-- выберите бокс --</option>';
    boxes.forEach(b => {
        const option = document.createElement('option');
        option.value = b;
        option.textContent = `Бокс ${b}`;
        boxSelect.appendChild(option);
    });
}

function updatePlaceholderForSelections(buranSelect, boxSelect, input) {
    if (!buranSelect.value || !boxSelect.value) {
        input.placeholder = 'например 3500';
        return;
    }
    const буран = parseInt(buranSelect.value);
    let бокс = boxSelect.value;
    if (буран === 1) бокс = Number(бокс);
    const last = getLastReading(буран, бокс);
    if (last) {
        input.placeholder = `последние: ${last.Показания} от ${last.Дата}`;
    } else {
        input.placeholder = 'нет истории';
    }
}

function createBoxItem(index, saved = null) {
    const boxDiv = document.createElement('div');
    boxDiv.className = 'box-item';
    boxDiv.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>Буран</label>
                <select class="buran-select" required>
                    <option value="">-- выберите --</option>
                    <option value="1">Буран 1</option>
                    <option value="2">Буран 2</option>
                </select>
            </div>
            <div class="form-group">
                <label>Бокс</label>
                <select class="box-select" required disabled>
                    <option value="">-- сначала выберите Буран --</option>
                </select>
            </div>
            <div class="form-group">
                <label>Новые показания (кВт·ч)</label>
                <input type="number" class="new-reading" step="1" placeholder="например 3500" required>
            </div>
            <div class="form-group" style="flex:0.2;">
                <label style="opacity:0;">Удалить</label>
                <button type="button" class="remove-box" style="background:#ef4444;">✖</button>
            </div>
        </div>
    `;

    const buranSelect = boxDiv.querySelector('.buran-select');
    const boxSelect = boxDiv.querySelector('.box-select');
    const input = boxDiv.querySelector('.new-reading');

    buranSelect.addEventListener('change', () => {
        if (buranSelect.value) {
            boxSelect.disabled = false;
            updateBoxOptions(buranSelect, boxSelect);
        } else {
            boxSelect.disabled = true;
            boxSelect.innerHTML = '<option value="">-- сначала выберите Буран --</option>';
            input.placeholder = 'например 3500';
        }
        saveBoxesToStorage();
    });

    boxSelect.addEventListener('change', () => {
        if (buranSelect.value && boxSelect.value) {
            updatePlaceholderForSelections(buranSelect, boxSelect, input);
            showAlertsForBox(boxSelect.value); // <-- добавлено
        } else {
            input.placeholder = 'например 3500';
        }
        saveBoxesToStorage();
    });

    input.addEventListener('input', () => saveBoxesToStorage());

    if (saved) {
        buranSelect.value = saved.buran || '';
        if (buranSelect.value) {
            boxSelect.disabled = false;
            updateBoxOptions(buranSelect, boxSelect);
            if (saved.box) {
                boxSelect.value = saved.box;
                updatePlaceholderForSelections(buranSelect, boxSelect, input);
                showAlertsForBox(saved.box); // <-- добавлено при восстановлении
            }
        }
        // сохранение показаний более не используется
    }

    const removeBtn = boxDiv.querySelector('.remove-box');
    removeBtn.addEventListener('click', () => {
        if (document.querySelectorAll('.box-item').length <= 1) {
            alert('Должен быть хотя бы один бокс');
            return;
        }
        boxDiv.remove();
        saveBoxesToStorage();
    });

    return boxDiv;
}

function saveBoxesToStorage() {
    const boxes = document.querySelectorAll('.box-item');
    const savedList = [];
    boxes.forEach(box => {
        const buranSelect = box.querySelector('.buran-select');
        const boxSelect = box.querySelector('.box-select');
        savedList.push({
            buran: buranSelect.value || '',
            box: boxSelect.value || ''
        });
    });
    localStorage.setItem('selectedBoxes', JSON.stringify(savedList));
}

function loadBoxesFromStorage() {
    const saved = localStorage.getItem('selectedBoxes');
    let boxesToRestore = [];
    if (saved) {
        try {
            boxesToRestore = JSON.parse(saved);
        } catch(e) { console.warn(e); }
    }
    boxesContainer.innerHTML = '';
    if (boxesToRestore.length === 0) {
        const firstBox = createBoxItem(0, null);
        boxesContainer.appendChild(firstBox);
    } else {
        boxesToRestore.forEach((state, idx) => {
            const box = createBoxItem(idx, state);
            boxesContainer.appendChild(box);
        });
    }
}

// ===================== ОБЩИЙ РАСЧЁТ =====================

async function calculateTotal() {
    const boxes = document.querySelectorAll('.box-item');
    const results = [];
    let totalConsumption = 0;
    let totalAccrued = 0;
    let totalDebtBefore = 0;

    for (let i = 0; i < boxes.length; i++) {
        const boxDiv = boxes[i];
        const buranSelect = boxDiv.querySelector('.buran-select');
        const boxSelect = boxDiv.querySelector('.box-select');
        const input = boxDiv.querySelector('.new-reading');

        const buran = buranSelect.value;
        const box = boxSelect.value;
        const newReading = parseFloat(input.value);

        if (!buran || !box) {
            alert(`В блоке ${i+1} не выбран Буран или Бокс`);
            return;
        }
        if (isNaN(newReading) || newReading <= 0) {
            alert(`В блоке ${i+1} введите корректное показание (положительное число)`);
            return;
        }

        const буранNum = parseInt(buran);
        let боксNorm;
        if (буранNum === 1) боксNorm = Number(box);
        else боксNorm = String(box);

        const lastRecord = getLastReading(буранNum, боксNorm);
        if (!lastRecord) {
            alert(`Для бокса ${box} (Буран ${buran}) нет истории показаний`);
            return;
        }
        if (newReading <= lastRecord.Показания) {
            alert(`Для бокса ${box} (Буран ${buran}) новые показания (${newReading}) должны быть больше последних (${lastRecord.Показания} от ${lastRecord.Дата})`);
            return;
        }

        const consumption = newReading - lastRecord.Показания;
        const today = new Date();
        const tarifsSorted = [...tarifsData.tarifs].sort((a,b) => parseDateRu(a.Дата) - parseDateRu(b.Дата));
        const tariff = getTariffForDate(today, tarifsSorted);
        const accrued = consumption * tariff;
        const debtHistory = getDebt(буранNum, боксNorm);
        const currentDebt = debtHistory.length ? debtHistory[debtHistory.length-1].сальдо : 0;

        totalConsumption += consumption;
        totalAccrued += accrued;
        totalDebtBefore += currentDebt;

        results.push({
            name: `Буран ${buran}, Бокс ${box}`,
            consumption,
            accrued,
            debt: currentDebt
        });
    }

    const modalBody = document.getElementById('modalBody');
    let html = `<div style="margin-bottom:16px;"><strong>Общий расчёт по ${results.length} боксам</strong></div>`;
    results.forEach(r => {
        html += `
            <div style="background:#f8fafc; border-radius:16px; padding:12px; margin-bottom:12px;">
                <div><strong>📌 ${r.name}</strong></div>
                <div class="result-line"><span>📉 Расход:</span><span>${r.consumption.toFixed(1)} кВт·ч</span></div>
                <div class="result-line"><span>💰 Начислено:</span><span>${r.accrued.toFixed(2)} руб</span></div>
                <div class="result-line"><span>💳 Текущий долг (до новых показаний):</span><span>${r.debt.toFixed(2)} руб</span></div>
            </div>
        `;
    });
    html += `
        <div class="result-total">
            <div>📊 Итого расход: ${totalConsumption.toFixed(1)} кВт·ч</div>
            <div>💰 Итого начислено: ${totalAccrued.toFixed(2)} руб</div>
            <div>💳 Общий долг (был): ${totalDebtBefore.toFixed(2)} руб</div>
            <div style="margin-top:10px; font-size:1.1rem;">🔁 К оплате с новыми начислениями: <strong>${(totalDebtBefore + totalAccrued).toFixed(2)} руб</strong></div>
        </div>
        <div style="margin-top:12px; font-size:0.8rem; color:#475569;">ℹ️ Новые показания не сохранены. Это демонстрационный расчёт.</div>
    `;
    modalBody.innerHTML = html;
    document.getElementById('resultModal').style.display = 'flex';
}

// ===================== ИНИЦИАЛИЗАЦИЯ =====================

async function init() {
    const ok = await loadAllData();
    if (!ok) return;

    loadBoxesFromStorage();

    addBoxBtn.addEventListener('click', () => {
        const newBox = createBoxItem(document.querySelectorAll('.box-item').length, null);
        boxesContainer.appendChild(newBox);
        saveBoxesToStorage();
    });

    clearStorageBtn.addEventListener('click', () => {
        localStorage.removeItem('selectedBoxes');
        boxesContainer.innerHTML = '';
        const firstBox = createBoxItem(0, null);
        boxesContainer.appendChild(firstBox);
        saveBoxesToStorage();
    });

    calcAllBtn.addEventListener('click', calculateTotal);

    const allDates = [];
    countsData.counts.forEach(r => allDates.push(parseDateRu(r.Дата)));
    tarifsData.tarifs.forEach(r => allDates.push(parseDateRu(r.Дата)));
    payData.pay.forEach(r => allDates.push(parseDateRu(r.Дата)));
    const lastDate = new Date(Math.max(...allDates));
    const footer = document.querySelector('footer');
    if (footer) {
        footer.innerHTML = `📅 Данные обновлены на ${lastDate.toLocaleDateString('ru-RU')} • Автоматический расчёт по текущему тарифу`;
    }

    const sortedTar = [...tarifsData.tarifs].sort((a,b)=>parseDateRu(a.Дата)-parseDateRu(b.Дата));
    const latestTariff = sortedTar[sortedTar.length-1];
    const tariffInfo = document.getElementById('tariffInfo');
    if (tariffInfo) {
        tariffInfo.innerHTML = `⚡ Актуальный тариф: ${latestTariff.Тариф} руб/кВт·ч (с ${latestTariff.Дата})`;
    }

    const modal = document.getElementById('resultModal');
    const closeModal = () => { modal.style.display = 'none'; };
    const closeBtn = document.querySelector('.close-modal');
    if (closeBtn) closeBtn.onclick = closeModal;
    window.onclick = (e) => { if (e.target === modal) closeModal(); };
}

init();