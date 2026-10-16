const $ = sel => document.querySelector(sel);

let categories = [];
let recordType = 'expense';
let selectedCategory = null;
let goalTarget = 500000;

function fmtMoney(n) {
  const neg = n < 0;
  return (neg ? '-' : '') + '¥' + Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function renderGoal() {
  const net = await window.api.netStats();
  const pct = Math.min(100, Math.max(0, goalTarget > 0 ? (net.balance / goalTarget) * 100 : 0));
  animateWater(184 - 170 * (pct / 100));
  $('#bottle-caption').textContent = pct.toFixed(0) + '%';
  if (net.balance >= goalTarget) {
    $('#goal-cap').textContent = '已达成目标，超出';
    $('#goal-remain').textContent = fmtMoney(net.balance - goalTarget);
  } else {
    $('#goal-cap').textContent = '离目标还差';
    $('#goal-remain').textContent = fmtMoney(goalTarget - net.balance);
  }
  $('#goal-balance').textContent = fmtMoney(net.balance);
  $('#goal-mini-fill').style.width = pct + '%';
  $('#goal-mini-pct').textContent = pct.toFixed(0) + '%';
}

let currentWaterY = 184;
let waterRaf = null;
function animateWater(targetY) {
  if (waterRaf) cancelAnimationFrame(waterRaf);
  const start = currentWaterY;
  const t0 = performance.now();
  const dur = 1200;
  const water = document.getElementById('water');
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    currentWaterY = start + (targetY - start) * e;
    water.setAttribute('transform', `translate(0 ${currentWaterY.toFixed(2)})`);
    if (p < 1) waterRaf = requestAnimationFrame(step);
  };
  waterRaf = requestAnimationFrame(step);
}

// ---------- 工具 ----------
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}

function openModal(title, bodyHtml, onOk, okText = '确定') {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-ok').textContent = okText;
  $('#modal-mask').classList.remove('hidden');
  $('#modal-cancel').onclick = closeModal;
  $('#modal-ok').onclick = () => { onOk(); closeModal(); };
}
function closeModal() { $('#modal-mask').classList.add('hidden'); }

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateStr, days) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  if (isNaN(d.getTime())) return today();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bindDateStepper(inputId, prevId, nextId) {
  const input = $('#' + inputId);
  if (!input) return;
  $('#' + prevId).onclick = () => { input.value = shiftDate(input.value, -1); };
  $('#' + nextId).onclick = () => { input.value = shiftDate(input.value, 1); };
}

// ---------- 导航 ----------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
    if (view === 'stats') refreshStats();
    if (view === 'trend') refreshTrend();
    if (view === 'history') refreshHistory();
    if (view === 'categories') renderCategories();
  };
});

// ---------- 记账 ----------
async function loadCategories() {
  categories = await window.api.listCategories();
  renderCategoryPicker();
  renderHistoryCatPick();
}

function renderCategoryPicker() {
  const list = categories.filter(c => c.type === recordType);
  const box = $('#category-picker');
  box.innerHTML = '';
  list.forEach(c => {
    const item = document.createElement('button');
    item.className = 'cat-pick' + (c.id === selectedCategory ? ' active' : '');
    const m = categoryMeta(c.name, c.type);
    item.innerHTML = `<span class="cat-pick-icon" style="background:${m.color}">${iconSvg(c.name, c.type)}</span><span class="cat-pick-name">${esc(c.name)}</span>`;
    item.onclick = () => {
      selectedCategory = c.id;
      renderCategoryPicker();
    };
    box.appendChild(item);
  });
}

document.querySelectorAll('.type-btn').forEach(btn => {
  btn.onclick = () => {
    recordType = btn.dataset.type;
    selectedCategory = null;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderCategoryPicker();
  };
});

$('#btn-save').onclick = async () => {
  const amount = parseFloat($('#rec-amount').value);
  const date = $('#rec-date').value;
  const remark = $('#rec-remark').value.trim();
  if (!selectedCategory) return toast('请先选择分类');
  if (!amount || amount <= 0) return toast('请输入正确的金额');
  if (!date) return toast('请选择日期');
  await window.api.addRecord({ type: recordType, categoryId: selectedCategory, amount, date, remark });
  $('#rec-amount').value = '';
  $('#rec-remark').value = '';
  toast('已记一笔');
  renderGoal();
};

// ---------- 统计 ----------
let statRange = 'month';
let statYear = new Date().getFullYear();
let statMonth = new Date().getMonth() + 1;
let pieChart = null, trendChart = null;

function initCharts() {
  if (!pieChart) {
    pieChart = echarts.init($('#chart-pie'));
    pieChart.on('click', onPieClick);
  }
}

function monthRange(year, month) {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

// 点击环图扇区 → 跳到该分类在当前统计区间（月/年）的支出明细
function onPieClick(params) {
  if (params.seriesType !== 'pie') return;
  const cat = categories.find(c => c.type === 'expense' && c.name === params.name);
  if (!cat) return;
  const range = statRange === 'month'
    ? monthRange(statYear, statMonth)
    : { start: `${statYear}-01-01`, end: `${statYear}-12-31` };
  historyFilter = { startDate: range.start, endDate: range.end, type: 'expense', categoryId: cat.id, keyword: null };
  syncHistoryControls();
  document.querySelector('.nav-btn[data-view="history"]').click();
}

document.querySelectorAll('.range-btn[data-range]').forEach(btn => {
  btn.onclick = () => {
    statRange = btn.dataset.range;
    document.querySelectorAll('.range-btn[data-range]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#month-nav').classList.toggle('hidden', statRange !== 'month');
    refreshStats();
  };
});

$('#prev-month').onclick = () => {
  statMonth--;
  if (statMonth < 1) {
    statMonth = 12;
    statYear--;
  }
  refreshStats();
};

$('#next-month').onclick = () => {
  statMonth++;
  if (statMonth > 12) {
    statMonth = 1;
    statYear++;
  }
  refreshStats();
};

// ---------- 分类图标 / 配色（彩色圆底 + 白色线性图标） ----------
const CATEGORY_META = {
  expense: {
    餐饮: { color: '#FF6B6B', icon: '<path d="M6.5 3v6.5a1.8 1.8 0 0 0 3.6 0V3"/><path d="M8.3 3v3.2"/><path d="M8.3 11.3V21"/><path d="M17.7 3c-1.7 2-2.3 4.6-2.3 7.2 0 1.2.6 2 2.3 2V21"/>' },
    交通: { color: '#4CAF50', icon: '<rect x="6" y="3.5" width="12" height="12.5" rx="2.5"/><path d="M6 10.5h12"/><circle cx="9.3" cy="13.4" r="0.9" fill="#fff" stroke="none"/><circle cx="14.7" cy="13.4" r="0.9" fill="#fff" stroke="none"/><path d="M7.5 19l-2 2M16.5 19l2 2"/>' },
    购物: { color: '#2196F3', icon: '<path d="M3.5 4h2l2.2 10.6a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.3L20.5 8H6.3"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>' },
    娱乐: { color: '#AB47BC', icon: '<path d="M7.5 9.5h9a4 4 0 0 1 3.9 4.6l-.4 2.2a2.6 2.6 0 0 1-4.6 1L14 15.5h-4l-1.4 1.8a2.6 2.6 0 0 1-4.6-1l-.4-2.2A4 4 0 0 1 7.5 9.5z"/><path d="M7.8 12.6v2.2M6.7 13.7h2.2"/><circle cx="16.3" cy="13" r="0.8" fill="#fff" stroke="none"/><circle cx="17.6" cy="15" r="0.8" fill="#fff" stroke="none"/>' },
    居住: { color: '#8D6E63', icon: '<path d="M4 10.5L12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>' },
    医疗: { color: '#FFB300', icon: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.6v6.8M8.6 12h6.8"/>' },
    学习: { color: '#3F51B5', icon: '<path d="M5 4.5h10.5A2.5 2.5 0 0 1 18 7v13l-3.2-2.2L12 19.5l-2.8-1.7L6 20V5.5A1 1 0 0 1 5 4.5z"/><path d="M8.5 9h6M8.5 12h6"/>' },
    其他: { color: '#8A97A8', icon: '<path d="M4.5 4.5h6l9 9-6 6-9-9z"/><circle cx="8.6" cy="8.6" r="1.2"/>' }
  },
  income: {
    工资: { color: '#26A69A', icon: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10.5h17"/><circle cx="16.3" cy="14.8" r="1.3"/>' },
    奖金: { color: '#FB8C00', icon: '<circle cx="12" cy="9" r="5"/><path d="M9.2 13.4L8 20.5l4-2.2 4 2.2-1.2-7.1"/>' },
    理财: { color: '#5C6BC0', icon: '<path d="M4.5 19V5.5"/><path d="M4.5 19h15"/><path d="M8.5 15.5l3-4 2.8 2 3.7-5.5"/>' },
    兼职: { color: '#29B6F6', icon: '<rect x="3.5" y="8" width="17" height="12" rx="2.5"/><path d="M9 8V6.5A2 2 0 0 1 11 4.5h2a2 2 0 0 1 2 2V8"/><path d="M3.5 13h17"/>' },
    其他: { color: '#9AA5B1', icon: '<ellipse cx="12" cy="7" rx="6" ry="3"/><path d="M6 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M6 12.5c0 1.7 2.7 3 6 3s6-1.3 6-3"/>' }
  }
};

// 自定义分类（名字不在内置表里）走这组色板，色相刻意避开内置分类；按列表次序取色保证相邻不撞色
const FALLBACK_COLORS = ['#EC407A', '#26C6DA', '#9CCC65', '#FF7043', '#7E57C2', '#7986CB', '#A1887F', '#00897B'];
const DEFAULT_ICON = {
  expense: '<path d="M4.5 4.5h6l9 9-6 6-9-9z"/><circle cx="8.6" cy="8.6" r="1.2"/>',
  income: '<ellipse cx="12" cy="7" rx="6" ry="3"/><path d="M6 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M6 12.5c0 1.7 2.7 3 6 3s6-1.3 6-3"/>'
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function categoryMeta(name, type) {
  const table = CATEGORY_META[type] || CATEGORY_META.expense;
  if (table[name]) return table[name];
  // 自定义分类：优先按在分类列表中的位置取色（相邻分类不撞色），找不到再用名字哈希
  let idx = categories.findIndex(c => c.name === name && c.type === type);
  if (idx < 0) idx = hashStr(String(name));
  return {
    color: FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
    icon: DEFAULT_ICON[type] || DEFAULT_ICON.expense
  };
}

function categoryColor(name, type = 'expense') {
  return categoryMeta(name, type).color;
}

function iconSvg(name, type) {
  const m = categoryMeta(name, type);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${m.icon}</svg>`;
}

async function refreshStats() {
  initCharts();
  renderGoal();
  const scope = statRange === 'month' ? `${statMonth}月` : `${statYear}年`;
  $('#label-income').textContent = scope + '收入';
  $('#label-expense').textContent = scope + '支出';
  $('#label-balance').textContent = scope + '结余';
  let pie, total;
  if (statRange === 'month') {
    $('#month-display').textContent = `${statYear}年${statMonth}月`;
    const s = await window.api.monthlyStats({ year: statYear, month: statMonth });
    $('#card-income').textContent = fmtMoney(s.income);
    $('#card-expense').textContent = fmtMoney(s.expense);
    $('#card-balance').textContent = fmtMoney(s.balance);
    pie = s.categoryPie;
    total = s.expense;
  } else {
    const s = await window.api.yearStats(statYear);
    $('#card-income').textContent = fmtMoney(s.income);
    $('#card-expense').textContent = fmtMoney(s.expense);
    $('#card-balance').textContent = fmtMoney(s.balance);
    pie = s.categoryPie;
    total = s.expense;
  }
  const range = statRange === 'month'
    ? monthRange(statYear, statMonth)
    : { start: `${statYear}-01-01`, end: `${statYear}-12-31` };
  const counts = await countExpenseByCategory(range);
  renderPie(pie, total, scope);
  renderDetailList(pie, total, counts);
  pieChart.resize();
  renderBudgets();
}

// 统计区间内各支出分类的笔数（按分类名汇总，和环图对齐）
async function countExpenseByCategory(range) {
  const records = await window.api.listRecords({ startDate: range.start, endDate: range.end, type: 'expense' });
  const counts = {};
  records.forEach(r => { counts[r.categoryName] = (counts[r.categoryName] || 0) + 1; });
  return counts;
}

// 支出详情排行：彩色图标 + 名称占比 + 彩色进度条 + 金额笔数
function renderDetailList(pie, total, counts) {
  const box = $('#detail-list');
  if (!pie || !pie.length) {
    box.innerHTML = '<div class="detail-empty">还没有支出记录</div>';
    return;
  }
  box.innerHTML = pie.map(d => {
    const pct = total > 0 ? (d.value / total) * 100 : 0;
    const color = categoryColor(d.name, 'expense');
    const cat = categories.find(c => c.type === 'expense' && c.name === d.name);
    return `
      <div class="detail-row" data-cat-id="${cat ? cat.id : ''}">
        <span class="detail-icon" style="background:${color}">${iconSvg(d.name, 'expense')}</span>
        <span class="detail-main">
          <span class="detail-line1">
            <span class="detail-name">${esc(d.name)}</span>
            <span class="detail-pct">${pct.toFixed(2)}%</span>
          </span>
          <span class="detail-bar"><span class="detail-fill" style="width:${pct.toFixed(2)}%;background:${color}"></span></span>
        </span>
        <span class="detail-right">
          <span class="detail-amount">${fmtMoney(d.value)}</span>
          <span class="detail-count">${counts[d.name] || 0}笔</span>
        </span>
        <span class="detail-arrow">›</span>
      </div>`;
  }).join('');
  box.querySelectorAll('.detail-row').forEach(row => {
    row.onclick = () => {
      const id = parseInt(row.dataset.catId);
      if (!id) return;
      const r = statRange === 'month' ? monthRange(statYear, statMonth) : { start: `${statYear}-01-01`, end: `${statYear}-12-31` };
      historyFilter = { startDate: r.start, endDate: r.end, type: 'expense', categoryId: id, keyword: null };
      syncHistoryControls();
      document.querySelector('.nav-btn[data-view="history"]').click();
    };
  });
}

// 分类月预算进度（仅月视图）
async function renderBudgets() {
  const card = $('#budget-card');
  if (statRange !== 'month') {
    card.classList.add('hidden');
    return;
  }
  const list = await window.api.budgetStats({ year: statYear, month: statMonth });
  if (!list.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const totalBudget = list.reduce((s, b) => s + b.budget, 0);
  const totalSpent = list.reduce((s, b) => s + b.spent, 0);
  $('#budget-tip').textContent = `${statMonth}月已用 ${fmtMoney(totalSpent)} / ${fmtMoney(totalBudget)}`;
  $('#budget-list').innerHTML = list.map(b => {
    const pct = Math.min(100, (b.spent / b.budget) * 100);
    const over = b.spent > b.budget;
    const remain = b.budget - b.spent;
    return `
      <div class="budget-row${over ? ' over' : ''}">
        <div class="budget-name">${esc(b.name)}</div>
        <div class="budget-bar"><div class="budget-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="budget-num">${fmtMoney(b.spent)}<span class="sl">/</span>${fmtMoney(b.budget)}</div>
        <div class="budget-rest">${over ? '超 ' + fmtMoney(-remain) : '剩 ' + fmtMoney(remain)}</div>
      </div>`;
  }).join('');
}

// 支出占比：环心报总额，外侧引线标签显示分类名+百分比，悬停放大
function renderPie(data, total, scope) {
  const hasData = data && data.length > 0;
  pieChart.setOption({
    title: {
      text: hasData ? fmtMoney(total) : '—',
      subtext: hasData ? '总支出' : '暂无支出记录',
      left: 'center',
      top: '43%',
      textAlign: 'center',
      textStyle: { color: '#2d3a45', fontSize: 20, fontWeight: 700, fontFamily: '"Microsoft YaHei", sans-serif' },
      subtextStyle: { color: '#a0adb8', fontSize: 11 }
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: ¥{c} ({d}%)',
      backgroundColor: 'rgba(255,255,255,.96)',
      borderColor: '#e2e8ee',
      borderWidth: 1,
      textStyle: { color: '#33414d', fontSize: 13 },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 14px rgba(47,62,78,.12);'
    },
    series: [{
      type: 'pie',
      cursor: hasData ? 'pointer' : 'default',
      radius: ['56%', '80%'],
      center: ['50%', '50%'],
      padAngle: hasData ? 2.5 : 0,
      data: hasData ? data : [{ name: '暂无支出', value: 1 }],
      label: { show: false },
      labelLine: { show: false },
      avoidLabelOverlap: false,
      minAngle: 3,
      itemStyle: { borderRadius: 5, borderColor: '#ffffff', borderWidth: 2.5 },
      emphasis: {
        scale: true,
        scaleSize: 6,
        itemStyle: { shadowBlur: 18, shadowOffsetX: 0, shadowColor: 'rgba(47,62,78,.2)' }
      },
      color: hasData ? data.map(d => categoryColor(d.name, 'expense')) : ['#e6ecf1']
    }]
  }, true);
}

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 走势图：单序列（默认支出，可切收入）；周=柱形，月/年=面积
function renderTrendChart(t, mode) {
  const isDay = mode !== 'year';
  const isWeek = mode === 'week';
  const wantIncome = trendSeries === 'income';
  const seriesName = wantIncome ? '收入' : '支出';
  const data = wantIncome ? t.income : t.expense;
  const hasData = data.some(v => v > 0);
  const axisData = isWeek
    ? WEEK_LABELS.slice()
    : mode === 'year'
      ? t.dates.map(d => parseInt(d.slice(5), 10) + '月')
      : t.dates.map((_, i) => i);
  const todayIdx = t.dates.indexOf(mode === 'year' ? today().slice(0, 7) : today());
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spans = mode === 'year' ? 12 : data.length;
  const avg = spans ? data.reduce((s, v) => s + v, 0) / spans : 0;

  const capTop = wantIncome ? '#8fdba9' : '#f2a7a2';
  const capBottom = wantIncome ? '#3f9e66' : '#cd5b56';
  const lineColor = wantIncome ? '#4a9a6e' : '#cf6b68';
  const areaTop = wantIncome ? 'rgba(74,154,110,.34)' : 'rgba(207,107,104,.34)';
  const areaBottom = wantIncome ? 'rgba(74,154,110,.02)' : 'rgba(207,107,104,.02)';
  const shadow = wantIncome ? 'rgba(74,154,110,.28)' : 'rgba(207,107,104,.28)';

  // 均值虚线 + 今天竖线：同一条 markLine 里各自带样式
  const markData = [];
  if (hasData && avg > 0) {
    markData.push({
      yAxis: avg,
      lineStyle: { color: lineColor, type: 'dashed', width: 1, opacity: .4 },
      label: {
        show: true, position: 'insideEndTop', color: lineColor, fontSize: 10,
        formatter: `${mode === 'year' ? '月均' : '日均'} ${fmtMoney(avg)}`
      }
    });
  }
  if (todayIdx >= 0) {
    markData.push({
      xAxis: todayIdx,
      lineStyle: { color: '#c08b50', type: 'dashed', width: 1.2, opacity: .8 },
      label: { show: true, formatter: '今天', position: 'end', color: '#b07b34', fontSize: 10, fontWeight: 'bold' }
    });
  }

  let series;
  if (isWeek) {
    series = {
      name: seriesName,
      type: 'bar',
      data,
      barMaxWidth: 34,
      barMinHeight: 3,
      animationDuration: reduceMotion ? 0 : 600,
      animationEasing: 'cubicOut',
      animationDelay: reduceMotion ? 0 : idx => idx * 16,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: capTop }, { offset: 1, color: capBottom }]
        }
      },
      emphasis: { focus: 'series', itemStyle: { shadowBlur: 14, shadowColor: shadow } }
    };
  } else {
    series = {
      name: seriesName,
      type: 'line',
      data,
      smooth: .35,
      symbol: 'circle',
      symbolSize: 7,
      showSymbol: false,
      lineStyle: { width: 2.6, color: lineColor, shadowBlur: 10, shadowColor: shadow, shadowOffsetY: 4 },
      itemStyle: { color: lineColor, borderColor: '#fff', borderWidth: 1.5 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: areaTop }, { offset: 1, color: areaBottom }]
        }
      },
      emphasis: { focus: 'series', itemStyle: { shadowBlur: 12, shadowColor: shadow } },
      animationDuration: reduceMotion ? 0 : 700,
      animationEasing: 'cubicOut'
    };
  }
  if (markData.length) series.markLine = { silent: true, symbol: 'none', data: markData };

  trendChart.setOption({
    textStyle: { fontFamily: '"Microsoft YaHei", sans-serif' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(251,252,253,.97)',
      borderColor: '#dde5ec',
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: '#33414d', fontSize: 13 },
      extraCssText: 'border-radius:10px;box-shadow:0 6px 20px rgba(47,62,78,.14);',
      axisPointer: {
        type: isWeek ? 'shadow' : 'line',
        shadowStyle: { color: 'rgba(192,139,80,.07)' },
        lineStyle: { color: 'rgba(192,139,80,.4)', type: 'dashed' }
      },
      formatter: (ps) => {
        const p = ps[0];
        const full = t.dates[p.dataIndex];
        const head = isDay
          ? `${parseInt(full.slice(5, 7), 10)}月${parseInt(full.slice(8), 10)}日`
          : `${parseInt(full.slice(5, 7), 10)}月`;
        return `<div style="font-weight:700;margin-bottom:6px">${head}</div>` +
          `${p.marker}${p.seriesName}` +
          `<span style="float:right;margin-left:24px;font-weight:700">¥${Number(p.value).toFixed(2)}</span>`;
      }
    },
    grid: { left: 56, right: 18, top: 22, bottom: 28 },
    xAxis: {
      type: 'category',
      data: axisData,
      boundaryGap: isWeek,
      axisLabel: {
        fontSize: 10, color: '#a8b4bf', margin: 10,
        interval: mode === 'month' ? 2 : 0,
        formatter: mode === 'month' ? v => Number(v) + 1 : undefined
      },
      axisLine: { lineStyle: { color: '#eef2f6' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitNumber: 5,
      ...(hasData ? {} : { max: 100, interval: 20 }),
      axisLabel: {
        color: '#a8b4bf', fontSize: 10, margin: 12,
        formatter: v => (v >= 10000 ? (Math.round(v / 1000) / 10) + '万' : v)
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(90,110,130,.07)', type: 'dashed' } }
    },
    graphic: hasData ? [] : [{
      type: 'text', left: 'center', top: 'middle',
      style: { text: `${mode === 'week' ? '本周' : mode === 'month' ? '本月' : '这一年'}还没有${seriesName}记录`, fill: '#a8b4bf', fontSize: 14 }
    }],
    series: [series]
  }, true);
}

// ---------- 收支走势（按周 / 按月 / 按年） ----------
let trendRange = 'month';
let trendSeries = 'expense';
let trendAnchor = new Date();

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// 周一为一周的第一天
function startOfWeek(anchor) {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

function initTrendChart() {
  if (!trendChart) trendChart = echarts.init($('#chart-trend'));
}

document.querySelectorAll('.range-btn[data-trange]').forEach(btn => {
  btn.onclick = () => {
    trendRange = btn.dataset.trange;
    document.querySelectorAll('.range-btn[data-trange]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trendAnchor = new Date();
    refreshTrend();
  };
});

document.querySelectorAll('.series-btn[data-series]').forEach(btn => {
  btn.onclick = () => {
    trendSeries = btn.dataset.series;
    document.querySelectorAll('.series-btn[data-series]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    refreshTrend();
  };
});

function shiftTrend(dir) {
  const d = new Date(trendAnchor);
  if (trendRange === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (trendRange === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  trendAnchor = d;
  refreshTrend();
}
$('#trend-prev').onclick = () => shiftTrend(-1);
$('#trend-next').onclick = () => shiftTrend(1);

async function refreshTrend() {
  initTrendChart();
  const seriesName = trendSeries === 'income' ? '收入' : '支出';
  let t, income, expense, title, period, rows;

  if (trendRange === 'week') {
    const start = startOfWeek(trendAnchor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const recs = await window.api.listRecords({ startDate: ymd(start), endDate: ymd(end) });
    const inc = {}, exp = {}, dates = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(start);
      dd.setDate(start.getDate() + i);
      const k = ymd(dd);
      dates.push(k); inc[k] = 0; exp[k] = 0;
    }
    recs.forEach(r => { if (r.type === 'income') inc[r.date] += r.amount; else exp[r.date] += r.amount; });
    income = dates.reduce((s, k) => s + inc[k], 0);
    expense = dates.reduce((s, k) => s + exp[k], 0);
    t = {
      dates,
      income: dates.map(k => Math.round(inc[k] * 100) / 100),
      expense: dates.map(k => Math.round(exp[k] * 100) / 100)
    };
    rows = dates.map((k, i) => ({
      label: k.slice(5), sub: WEEK_LABELS[i],
      income: t.income[i], expense: t.expense[i], today: k === today()
    }));
    title = '本周每日' + seriesName;
    period = `${start.getMonth() + 1}月${start.getDate()}日 - ${end.getMonth() + 1}月${end.getDate()}日`;
  } else if (trendRange === 'month') {
    const y = trendAnchor.getFullYear(), m = trendAnchor.getMonth() + 1;
    const s = await window.api.monthlyStats({ year: y, month: m });
    const d = await window.api.dailyStats({ year: y, month: m });
    income = s.income; expense = s.expense;
    t = { dates: d.dates, income: d.income, expense: d.expense };
    rows = d.dates.map((k, i) => ({
      label: k.slice(5), sub: weekday(k),
      income: t.income[i], expense: t.expense[i], today: k === today()
    })).filter(r => r.income > 0 || r.expense > 0);
    title = `${m}月每日${seriesName}`;
    period = `${y}年${m}月`;
  } else {
    const y = trendAnchor.getFullYear();
    const s = await window.api.yearStats(y);
    income = s.income; expense = s.expense;
    t = {
      dates: s.monthly.map((_, i) => `${y}-${pad2(i + 1)}`),
      income: s.monthly.map(m => Math.round(m.income * 100) / 100),
      expense: s.monthly.map(m => Math.round(m.expense * 100) / 100)
    };
    rows = t.dates.map((k, i) => ({
      label: `${i + 1}月`, sub: '',
      income: t.income[i], expense: t.expense[i], today: false
    }));
    title = `${y}年每月${seriesName}`;
    period = `${y}年`;
  }

  $('#trend-title').textContent = title;
  $('#trend-period').textContent = period;
  $('#t-card-income').textContent = fmtMoney(income);
  $('#t-card-expense').textContent = fmtMoney(expense);
  $('#t-card-balance').textContent = fmtMoney(income - expense);

  const seriesTotal = trendSeries === 'income' ? income : expense;
  const seriesVals = trendSeries === 'income' ? t.income : t.expense;
  const spans = trendRange === 'year' ? 12 : t.dates.length;
  const peak = seriesVals.length ? Math.max(...seriesVals) : 0;
  $('#trend-sub').innerHTML =
    `${trendRange === 'year' ? '月均' : '日均'}${seriesName} <b>${fmtMoney(spans ? seriesTotal / spans : 0)}</b>` +
    `<span style="opacity:.5;margin:0 8px">·</span>最高 <b>${fmtMoney(peak)}</b>`;

  renderTrendTable(rows, income, expense, trendRange);
  renderTrendChart(t, trendRange);
  trendChart.resize();
}

// 周期明细表：周/月按天、年按月，直接把金额列成数字，一眼可读
function renderTrendTable(rows, income, expense, mode) {
  const box = $('#trend-table');
  const titleEl = $('#trend-table-title');
  if (titleEl) titleEl.textContent = (mode === 'year' ? '每月' : '每日') + '明细';
  const emptyWord = mode === 'week' ? '本周' : mode === 'month' ? '本月' : '这一年';
  if (!rows || !rows.length || (income === 0 && expense === 0)) {
    box.innerHTML = `<div class="trend-table-empty">${emptyWord}还没有记录</div>`;
    return;
  }
  const signed = v => (v > 0 ? '+' : '') + fmtMoney(v);
  const netCls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
  const rowsHtml = rows.map(r => {
    const b = r.income - r.expense;
    return `<tr class="${r.today ? 'today' : ''}">` +
      `<td class="tt-date">${r.label}${r.sub ? `<span class="tt-wd">${r.sub}</span>` : ''}</td>` +
      `<td class="tt-inc">${r.income ? fmtMoney(r.income) : '—'}</td>` +
      `<td class="tt-exp">${r.expense ? fmtMoney(r.expense) : '—'}</td>` +
      `<td class="tt-net ${netCls(b)}">${b ? signed(b) : '—'}</td>` +
      `</tr>`;
  }).join('');
  const total = income - expense;
  box.innerHTML =
    `<div class="trend-table-scroll"><table class="trend-table-el">` +
    `<thead><tr><th class="tt-date">日期</th><th class="tt-inc">收入</th><th class="tt-exp">支出</th><th class="tt-net">结余</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody>` +
    `<tfoot><tr>` +
    `<td class="tt-date">合计</td>` +
    `<td class="tt-inc">${fmtMoney(income)}</td>` +
    `<td class="tt-exp">${fmtMoney(expense)}</td>` +
    `<td class="tt-net ${netCls(total)}">${total ? signed(total) : '—'}</td>` +
    `</tr></tfoot></table></div>`;
}

// ---------- 历史 ----------
let historyFilter = {};
let historySort = 'date-desc';

// 类别：图标按钮（随「类型」联动）
function renderHistoryCatPick() {
  const box = $('#his-catpick');
  if (!box) return;
  const type = $('#his-type').value;
  const list = categories.filter(c => !type || c.type === type);
  const cur = historyFilter.categoryId || null;
  box.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'cat-pick sm' + (!cur ? ' active' : '');
  all.innerHTML = '<span class="cat-pick-icon" style="background:#8A97A8;color:#fff;font-size:14px;font-weight:700">全</span><span class="cat-pick-name">全部</span>';
  all.onclick = () => setHistoryCategory(null);
  box.appendChild(all);
  list.forEach(c => {
    const m = categoryMeta(c.name, c.type);
    const item = document.createElement('button');
    item.className = 'cat-pick sm' + (c.id === cur ? ' active' : '');
    item.innerHTML = `<span class="cat-pick-icon" style="background:${m.color}">${iconSvg(c.name, c.type)}</span><span class="cat-pick-name">${esc(c.name)}</span>`;
    item.onclick = () => setHistoryCategory(c.id);
    box.appendChild(item);
  });
}

function setHistoryCategory(id) {
  historyFilter = { ...historyFilter, categoryId: id };
  renderHistoryCatPick();
  refreshHistory();
}

// 把当前筛选条件回填到控件（从统计页跳转过来时用）
function syncHistoryControls() {
  $('#his-start').value = historyFilter.startDate || '';
  $('#his-end').value = historyFilter.endDate || '';
  $('#his-type').value = historyFilter.type || '';
  $('#his-keyword').value = historyFilter.keyword || '';
  markRangeChip(null);
  renderHistoryCatPick();
}

function markRangeChip(key) {
  document.querySelectorAll('#his-ranges .chip').forEach(b => b.classList.toggle('active', b.dataset.range === key));
}

// 快捷时间范围；'all' 返回空（不限日期）
function quickRange(key) {
  const now = new Date();
  if (key === 'month') {
    return { start: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, end: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  if (key === 'lastMonth') {
    return { start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (key === 'last7') {
    const s = new Date(now);
    s.setDate(s.getDate() - 6);
    return { start: ymd(s), end: ymd(now) };
  }
  if (key === 'year') {
    return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
  }
  return { start: null, end: null };
}

document.querySelectorAll('#his-ranges .chip').forEach(btn => {
  btn.onclick = () => {
    const r = quickRange(btn.dataset.range);
    $('#his-start').value = r.start || '';
    $('#his-end').value = r.end || '';
    historyFilter = { ...historyFilter, startDate: r.start, endDate: r.end };
    markRangeChip(btn.dataset.range);
    refreshHistory();
  };
});

$('#his-type').onchange = () => {
  const t = $('#his-type').value || null;
  let catId = historyFilter.categoryId;
  if (catId) {
    const cat = categories.find(c => c.id === catId);
    if (cat && t && cat.type !== t) catId = null;
  }
  historyFilter = { ...historyFilter, type: t, categoryId: catId };
  renderHistoryCatPick();
  refreshHistory();
};

$('#his-sort').onchange = () => { historySort = $('#his-sort').value; refreshHistory(); };

['#his-start', '#his-end'].forEach(sel => {
  $(sel).onchange = () => {
    historyFilter = { ...historyFilter, startDate: $('#his-start').value || null, endDate: $('#his-end').value || null };
    markRangeChip(null);
    refreshHistory();
  };
});

$('#his-search').onclick = () => {
  historyFilter = { ...historyFilter, keyword: $('#his-keyword').value.trim() || null };
  refreshHistory();
};
$('#his-keyword').onkeydown = (e) => { if (e.key === 'Enter') $('#his-search').click(); };

// 排序：listRecords 默认已是「日期 新→旧」，其余在前端排
function sortRecords(list) {
  const arr = list.slice();
  if (historySort === 'date-asc') {
    arr.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  } else if (historySort === 'amount-desc') {
    arr.sort((a, b) => b.amount - a.amount);
  } else if (historySort === 'amount-asc') {
    arr.sort((a, b) => a.amount - b.amount);
  }
  return arr;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function weekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

// 用 innerHTML 拼记录行；备注/分类名可能含尖括号，先转义防串版
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function recordRow(r, showDate) {
  const item = document.createElement('div');
  item.className = 'his-item';
  const meta = categoryMeta(r.categoryName, r.type);
  item.innerHTML = `
    <div class="his-cat-icon" style="background:${meta.color}">${iconSvg(r.categoryName, r.type)}</div>
    <div class="his-cat">${esc(r.categoryName)}</div>
    ${showDate ? `<div class="his-date">${esc(r.date)}</div>` : ''}
    <div class="his-remark">${esc(r.remark)}</div>
    <div class="his-amount ${r.type}">${r.type === 'expense' ? '-' : '+'}${fmtMoney(r.amount)}</div>
    <div class="his-op">
      <button class="icon-btn">编辑</button>
      <button class="icon-btn danger">删除</button>
    </div>`;
  item.querySelectorAll('.icon-btn')[0].onclick = () => openEditRecord(r);
  item.querySelectorAll('.icon-btn')[1].onclick = () => confirmDeleteRecord(r);
  return item;
}

async function refreshHistory() {
  renderGoal();
  const records = sortRecords(await window.api.listRecords(historyFilter));
  const list = $('#history-list');
  const summary = $('#his-summary');

  if (!records.length) {
    const hasFilter = !!(historyFilter.startDate || historyFilter.endDate || historyFilter.type || historyFilter.categoryId || historyFilter.keyword);
    summary.classList.add('hidden');
    summary.innerHTML = '';
    list.innerHTML = `<div class="empty">${hasFilter ? '没有符合条件的记录' : '还没有记录，先去"记一笔"吧'}</div>`;
    return;
  }
  let totalIncome = 0, totalExpense = 0;
  records.forEach(r => { if (r.type === 'income') totalIncome += r.amount; else totalExpense += r.amount; });
  summary.classList.remove('hidden');
  summary.innerHTML = `
    <div class="sum-item"><span class="k">共</span><span class="v">${records.length}</span><span class="u">笔</span></div>
    <div class="sum-item income"><span class="k">收入</span><span class="v">${fmtMoney(totalIncome)}</span></div>
    <div class="sum-item expense"><span class="k">支出</span><span class="v">${fmtMoney(totalExpense)}</span></div>
    <div class="sum-item balance"><span class="k">结余</span><span class="v">${fmtMoney(totalIncome - totalExpense)}</span></div>`;

  list.innerHTML = '';
  const grouped = historySort === 'date-desc' || historySort === 'date-asc';
  if (grouped) {
    // 一次分组（不再每条都全表 filter）
    const groups = new Map();
    for (const r of records) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    for (const [date, dayRecords] of groups) {
      let dInc = 0, dExp = 0;
      for (const x of dayRecords) { if (x.type === 'income') dInc += x.amount; else dExp += x.amount; }
      const day = document.createElement('div');
      day.className = 'his-day';
      day.innerHTML =
        `<span class="d">${esc(date)}</span><span class="wd">${weekday(date)}</span>` +
        `<span class="sub">${dayRecords.length} 笔 · 收 ${fmtMoney(dInc)} · 支 ${fmtMoney(dExp)}</span>`;
      list.appendChild(day);
      dayRecords.forEach(r => list.appendChild(recordRow(r, false)));
    }
  } else {
    records.forEach(r => list.appendChild(recordRow(r, true)));
  }
}

function openEditRecord(r) {
  const cats = categories.filter(c => c.type === r.type);
  const options = cats.map(c => `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''}>${c.name}</option>`).join('');
  openModal('编辑记录', `
    <div class="form-row"><label>类型</label>
      <select id="ed-type">
        <option value="expense" ${r.type === 'expense' ? 'selected' : ''}>支出</option>
        <option value="income" ${r.type === 'income' ? 'selected' : ''}>收入</option>
      </select>
    </div>
    <div class="form-row"><label>分类</label><select id="ed-category">${options}</select></div>
    <div class="form-row"><label>金额</label><input id="ed-amount" type="number" step="0.01" value="${r.amount}"></div>
    <div class="form-row"><label>日期</label>
      <div class="date-stepper">
        <input id="ed-date" type="date" value="${r.date}">
        <div class="step-btns">
          <button type="button" id="ed-date-prev" class="step-btn" title="前一天">▲</button>
          <button type="button" id="ed-date-next" class="step-btn" title="后一天">▼</button>
        </div>
      </div>
    </div>
    <div class="form-row"><label>备注</label><input id="ed-remark" type="text" value="${r.remark || ''}"></div>`,
    async () => {
      const type = $('#ed-type').value;
      const amount = parseFloat($('#ed-amount').value);
      const date = $('#ed-date').value;
      if (!amount || amount <= 0) return toast('请输入正确的金额');
      if (!date) return toast('请选择日期');
      await window.api.updateRecord({
        id: r.id,
        record: { type, categoryId: parseInt($('#ed-category').value), amount, date, remark: $('#ed-remark').value.trim() }
      });
      toast('已保存');
      refreshHistory();
    });
  bindDateStepper('ed-date', 'ed-date-prev', 'ed-date-next');
  $('#ed-type').onchange = () => {
    const t = $('#ed-type').value;
    const cats2 = categories.filter(c => c.type === t);
    $('#ed-category').innerHTML = cats2.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  };
}

function confirmDeleteRecord(r) {
  openModal('删除记录',
    `<p style="color:var(--muted);font-size:14px;">确定删除这条记录吗？<br>${esc(r.date)} ${esc(r.categoryName)} ${fmtMoney(r.amount)}</p>`,
    async () => {
      await window.api.removeRecord(r.id);
      toast('已删除');
      refreshHistory();
    });
}

// ---------- 分类管理 ----------
function renderCategories() {
  const exp = categories.filter(c => c.type === 'expense');
  const inc = categories.filter(c => c.type === 'income');
  const draw = (list, boxId) => {
    const box = $(boxId);
    const type = list.length ? list[0].type : (boxId === '#cat-expense' ? 'expense' : 'income');
    box.innerHTML = '';
    list.forEach(c => {
      const item = document.createElement('div');
      item.className = 'cat-item';
      const budgetHtml = c.type === 'expense'
        ? `<label class="cat-budget" title="每月预算，留空表示不限">预算
             <input type="number" min="0" step="0.01" value="${c.budget || ''}" placeholder="不限">
           </label>`
        : '';
      item.innerHTML = `<span class="name">${esc(c.name)}</span>${budgetHtml}<button class="icon-btn del">删除</button>`;
      const budgetInput = item.querySelector('.cat-budget input');
      if (budgetInput) {
        budgetInput.onchange = async () => {
          const val = parseFloat(budgetInput.value);
          await window.api.setCategoryBudget({ id: c.id, budget: isNaN(val) ? 0 : val });
          categories = await window.api.listCategories();
          renderCategories();
          toast(val > 0 ? '预算已更新' : '已取消预算');
        };
      }
      item.querySelector('.name').onclick = () => {
        openModal('重命名分类',
          `<div class="form-row"><input id="ren-name" type="text" value="${c.name}" maxlength="10"></div>`,
          async () => {
            const name = $('#ren-name').value.trim();
            if (!name) return toast('名称不能为空');
            await window.api.renameCategory({ id: c.id, name });
            categories = await window.api.listCategories();
            renderCategories();
            toast('已改名');
          });
      };
      item.querySelector('.del').onclick = async () => {
        const res = await window.api.removeCategory(c.id);
        if (!res.ok) return toast(`该分类下还有 ${res.inUse} 条记录，无法删除`);
        categories = await window.api.listCategories();
        renderCategories();
        toast('已删除');
      };
      box.appendChild(item);
    });
    const add = document.createElement('button');
    add.className = 'add-cat';
    add.textContent = '+ 新增分类';
    add.onclick = () => {
      openModal('新增分类',
        `<div class="form-row"><input id="new-cat-name" type="text" maxlength="10" placeholder="分类名称"></div>`,
        async () => {
          const name = $('#new-cat-name').value.trim();
          if (!name) return toast('名称不能为空');
          await window.api.addCategory({ type, name });
          categories = await window.api.listCategories();
          renderCategories();
          toast('已添加');
        });
    };
    box.appendChild(add);
  };
  draw(exp, '#cat-expense');
  draw(inc, '#cat-income');
}

// ---------- 初始化 ----------
async function init() {
  $('#rec-date').value = today();
  bindDateStepper('rec-date', 'rec-date-prev', 'rec-date-next');
  $('#month-display').textContent = `${statYear}年${statMonth}月`;
  goalTarget = await window.api.getGoal();
  // 迁移旧版存在 localStorage 的目标值（target==默认值时才迁移，避免覆盖已改过的）
  const legacyTarget = parseInt(localStorage.getItem('goalTarget'));
  if (legacyTarget > 0 && legacyTarget !== goalTarget && goalTarget === 500000) {
    goalTarget = legacyTarget;
    await window.api.setGoal(legacyTarget);
    localStorage.removeItem('goalTarget');
  }
  $('#goal-target').value = goalTarget;
  $('#goal-target').onchange = async () => {
    const v = parseInt($('#goal-target').value);
    if (v && v > 0) {
      goalTarget = v;
      await window.api.setGoal(v);
      renderGoal();
      toast('目标已更新');
    }
  };
  await loadCategories();
  refreshStats();
}
init();