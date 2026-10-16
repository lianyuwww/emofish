const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { categories: [], records: [] };
    this.nextCategoryId = 1;
    this.nextRecordId = 1;
  }

  init(presetCategories) {
    if (fs.existsSync(this.filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.nextCategoryId = (this.data.categories.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
        this.nextRecordId = (this.data.records.reduce((m, r) => Math.max(m, r.id), 0)) + 1;
        return;
      } catch (e) {
        // 文件损坏则重新初始化
      }
    }
    this.data = { categories: [], records: [] };
    this.nextCategoryId = 1;
    this.nextRecordId = 1;
    for (const p of presetCategories) {
      this.addCategory(p.type, p.name);
    }
    this.save();
  }

  save() {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  getCategories() {
    return this.data.categories;
  }

  // 存钱目标（存进 data.json，主窗口与桌面挂件共用）
  getGoal() {
    const t = this.data.goal && Number(this.data.goal.target);
    return t > 0 ? t : 500000;
  }

  setGoal(target) {
    const v = Math.round((Number(target) || 0) * 100) / 100;
    if (v > 0) {
      this.data.goal = { target: v };
      this.save();
    }
    return this.getGoal();
  }

  addCategory(type, name) {
    const cat = { id: this.nextCategoryId++, type, name };
    this.data.categories.push(cat);
    this.save();
    return cat;
  }

  renameCategory(id, name) {
    const cat = this.data.categories.find(c => c.id === id);
    if (cat) { cat.name = name; this.save(); }
    return cat;
  }

  removeCategory(id) {
    this.data.categories = this.data.categories.filter(c => c.id !== id);
    this.save();
  }

  categoryRecordCount(id) {
    return this.data.records.filter(r => r.categoryId === id).length;
  }

  // 分类月度预算：>0 写入，<=0 视为取消
  setCategoryBudget(id, budget) {
    const cat = this.data.categories.find(c => c.id === id);
    if (cat) {
      const v = Math.round((Number(budget) || 0) * 100) / 100;
      if (v > 0) cat.budget = v;
      else delete cat.budget;
      this.save();
    }
    return cat;
  }

  // 当月各预算分类的已用金额，按使用率降序（超支排前面）
  budgetStats(year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const spent = {};
    for (const r of this.data.records) {
      if (r.type !== 'expense' || !r.date.startsWith(ym)) continue;
      spent[r.categoryId] = (spent[r.categoryId] || 0) + r.amount;
    }
    return this.data.categories
      .filter(c => c.type === 'expense' && c.budget > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        budget: c.budget,
        spent: Math.round((spent[c.id] || 0) * 100) / 100
      }))
      .sort((a, b) => (b.spent / b.budget) - (a.spent / a.budget));
  }

  addRecord({ type, categoryId, amount, date, remark }) {
    const record = {
      id: this.nextRecordId++,
      type,
      categoryId,
      amount,
      date,
      remark: remark || '',
      createdAt: Date.now()
    };
    this.data.records.push(record);
    this.save();
    return record;
  }

  updateRecord(id, { type, categoryId, amount, date, remark }) {
    const record = this.data.records.find(r => r.id === id);
    if (record) {
      record.type = type;
      record.categoryId = categoryId;
      record.amount = amount;
      record.date = date;
      record.remark = remark || '';
      this.save();
    }
    return record;
  }

  removeRecord(id) {
    this.data.records = this.data.records.filter(r => r.id !== id);
    this.save();
  }

  listRecords(filter = {}) {
    const { startDate, endDate, type, categoryId, keyword } = filter;
    let list = this.data.records.slice();
    if (startDate) list = list.filter(r => r.date >= startDate);
    if (endDate) list = list.filter(r => r.date <= endDate);
    if (type) list = list.filter(r => r.type === type);
    if (categoryId) list = list.filter(r => r.categoryId === categoryId);
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(r => (r.remark || '').toLowerCase().includes(kw));
    }
    const catMap = {};
    for (const c of this.data.categories) catMap[c.id] = c;
    list.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
    return list.map(r => ({ ...r, categoryName: catMap[r.categoryId] ? catMap[r.categoryId].name : '已删除' }));
  }

  netStats() {
    const income = this.data.records.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = this.data.records.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
    return { income, expense, balance: income - expense };
  }

  monthlyStats(year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const monthRecords = this.data.records.filter(r => r.date.startsWith(ym));
    const income = monthRecords.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    const expense = monthRecords.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

    const catMap = {};
    for (const c of this.data.categories) catMap[c.id] = c.name;
    const pieMap = {};
    for (const r of monthRecords) {
      if (r.type !== 'expense') continue;
      const name = catMap[r.categoryId] || '已删除';
      pieMap[name] = (pieMap[name] || 0) + r.amount;
    }
    const categoryPie = Object.entries(pieMap)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);

    return { income, expense, balance: income - expense, categoryPie };
  }

  yearStats(year) {
    const prefix = `${year}-`;
    const catMap = {};
    for (const c of this.data.categories) catMap[c.id] = c.name;
    const monthly = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    const pieMap = {};
    let income = 0, expense = 0;
    for (const r of this.data.records) {
      if (!r.date.startsWith(prefix)) continue;
      const m = parseInt(r.date.slice(5, 7), 10) - 1;
      if (!(m >= 0 && m < 12)) continue;
      if (r.type === 'income') {
        monthly[m].income += r.amount;
        income += r.amount;
      } else {
        monthly[m].expense += r.amount;
        expense += r.amount;
        const name = catMap[r.categoryId] || '已删除';
        pieMap[name] = (pieMap[name] || 0) + r.amount;
      }
    }
    const categoryPie = Object.entries(pieMap)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
    return { income, expense, balance: income - expense, monthly, categoryPie };
  }

  dailyStats(year, month) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const dates = [];
    const inc = {};
    const exp = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`;
      dates.push(date);
      inc[date] = 0;
      exp[date] = 0;
    }
    for (const r of this.data.records) {
      if (!(r.date in inc)) continue;
      if (r.type === 'income') inc[r.date] += r.amount;
      else exp[r.date] += r.amount;
    }
    return {
      dates,
      income: dates.map(d => Math.round(inc[d] * 100) / 100),
      expense: dates.map(d => Math.round(exp[d] * 100) / 100)
    };
  }
}

module.exports = Store;