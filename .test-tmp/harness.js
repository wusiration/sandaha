'use strict';
// 三打哈 AI 修复复测 —— 无头测试驱动
// 用法: node .test-tmp/harness.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const DIR = __dirname;
const ROOT = path.join(DIR, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if(blocks.length < 2) throw new Error('未找到游戏脚本块');
const gameCode = blocks.reduce((a, b) => (a.length >= b.length ? a : b));

// ---------------- DOM 桩 ----------------
class El {
  constructor(id){
    this.id = id;
    this._tc = '';
    this._html = '';
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.classList = { add(){}, remove(){}, toggle(){}, contains: () => false };
    this.onclick = null;
    this.onchange = null;
    this.scrollTop = 0;
  }
  set textContent(v){ this._tc = String(v); }
  get textContent(){ return this._tc; }
  set innerHTML(v){ this._html = String(v); if(v === '') this.children = []; }
  get innerHTML(){ return this._html; }
  get scrollHeight(){ return 0; }
  appendChild(c){ this.children.push(c); return c; }
  get lastElementChild(){ return this.children.length ? this.children[this.children.length - 1] : null; }
  querySelector(){ return new El('q'); }
  querySelectorAll(){ return []; }
  addEventListener(){}
}
const elCache = new Map();
globalThis.document = {
  getElementById(id){ if(!elCache.has(id)) elCache.set(id, new El(id)); return elCache.get(id); },
  createElement(){ return new El('anon'); },
  querySelectorAll(){ return []; },
  addEventListener(){},
};
globalThis.window = { innerWidth: 1280, innerHeight: 800 };
globalThis.location = { search: '' };
// 游戏内所有 setTimeout 改为微任务：游戏异步函数在 await 处让出栈，不会栈溢出
globalThis.setTimeout = (fn) => { queueMicrotask(fn); return 0; };
globalThis.clearTimeout = () => {};

// ---------------- 载入游戏 + 插桩 ----------------
const instr = fs.readFileSync(path.join(DIR, 'instr.js'), 'utf8');
vm.runInThisContext(gameCode + '\n;\n' + instr, { filename: 'index-game.js' });

const g = (code) => vm.runInThisContext(code, { filename: 'driver.js' });
const tick = () => new Promise(r => setImmediate(r));

const uncaught = [];
process.on('uncaughtException', (e) => { uncaught.push('EXC: ' + String((e && e.stack) || e)); });
process.on('unhandledRejection', (e) => { uncaught.push('REJ: ' + String((e && e.stack) || e)); });

// ---------------- 单元测试 ----------------
console.log('================ 单元测试 ================');
const unit = JSON.parse(g(fs.readFileSync(path.join(DIR, 'unit.js'), 'utf8')));
function printCases(arr){
  for(const c of arr){
    console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.case}${c.got ? '  出: ' + c.got.join(' ') : ''}`);
    if(!c.ok) console.log('       详情: ' + JSON.stringify(c));
  }
}
console.log(' aiChooseFollowThrow 跟甩牌:');
printCases(unit.followThrow);
console.log(' dealerKeepValue:');
printCases(unit.keepValue);
console.log(' aiExchangeAndTrump 埋底:');
printCases(unit.bury);

// ---------------- 集成测试 ----------------
async function playOneRound(first){
  const startIllegal = g('__T.illegal.length');
  const startErr = uncaught.length;
  g(first ? 'startNewRound(false)' : 'startNewRound(true)');
  let last = '', same = 0;
  for(let i = 0; i < 200000; i++){
    const s = g('JSON.stringify({phase:state.phase,turn:state.turn,tr:state.trickCount,ct:state.currentTrick.length,h:state.players.reduce((a,p)=>a+p.hand.length,0)})');
    if(JSON.parse(s).phase === 'finished'){
      return { ok: true, illegalDelta: g('__T.illegal.length') - startIllegal, errDelta: uncaught.length - startErr };
    }
    if(s === last){ if(++same > 3000) break; }
    else { same = 0; last = s; }
    await tick();
  }
  const diag = JSON.parse(g('JSON.stringify({phase:state.phase,turn:state.turn,tr:state.trickCount,ct:state.currentTrick.length,hands:state.players.map(p=>p.hand.length),trick:state.currentTrick.map(p=>({seat:p.playerIndex,n:p.cards.length})),illegalTail:__T.illegal.slice(-3)})'));
  return { ok: false, stall: diag, illegalDelta: g('__T.illegal.length') - startIllegal, errDelta: uncaught.length - startErr };
}

console.log('\n================ 集成测试（3 难度 × 20 局，全部 AI 代打）================');
const summary = {};
const t0 = Date.now();
(async () => {
for(const diff of ['easy', 'medium', 'hard']){
  g(`state.difficulty = ${JSON.stringify(diff)}`);
  const recs = [];
  let bad = 0;
  for(let r = 0; r < 20; r++){
    const res = await playOneRound(r === 0);
    const rec = JSON.parse(g('JSON.stringify(__T.rounds[__T.rounds.length-1] || null)'));
    if(!res.ok || !rec || res.illegalDelta > 0 || res.errDelta > 0){
      bad++;
      recs.push({ no: r + 1, ok: false, illegalDelta: res.illegalDelta, errDelta: res.errDelta, rec });
    } else recs.push({ no: r + 1, ok: true, rec });
  }
  const okRecs = recs.filter(x => x.ok).map(x => x.rec);
  const agg = {
    total: 20, failed: bad,
    dealerWins: okRecs.filter(x => x.dealerWin).length,
    defenderWins: okRecs.filter(x => !x.dealerWin).length,
    avgBid: +(okRecs.reduce((s, x) => s + x.bid, 0) / Math.max(1, okRecs.length)).toFixed(1),
    avgScore: +(okRecs.reduce((s, x) => s + x.score, 0) / Math.max(1, okRecs.length)).toFixed(1),
    results: okRecs.reduce((m, x) => { m[x.result] = (m[x.result] || 0) + 1; return m; }, {}),
    throwsLed: okRecs.reduce((s, x) => s + x.throwsLed, 0),
    throwFollows: okRecs.reduce((s, x) => s + x.throwFollows, 0),
    koudi: okRecs.filter(x => x.koudi).length,
    bottomAKRounds: okRecs.filter(x => x.bottomAK > 0).length,
    dealerSeats: okRecs.reduce((m, x) => { m[x.dealer] = (m[x.dealer] || 0) + 1; return m; }, {}),
  };
  summary[diff] = { agg, recs };
  console.log(`\n--- 难度: ${diff} ---`);
  console.log(`  完成 ${20 - bad}/20 局` + (bad ? `  ⚠ ${bad} 局异常` : ''));
  console.log(`  庄家胜 ${agg.dealerWins} / 闲家胜 ${agg.defenderWins}  (庄胜率 ${(agg.dealerWins / Math.max(1, agg.dealerWins + agg.defenderWins) * 100).toFixed(0)}%)`);
  console.log(`  平均庄分 ${agg.avgBid}  平均闲家得分 ${agg.avgScore}`);
  console.log(`  结果分布: ${JSON.stringify(agg.results)}`);
  console.log(`  甩牌 ${agg.throwsLed} 次, 跟甩 ${agg.throwFollows} 次, 抠底 ${agg.koudi} 次, 底牌含A/K局数 ${agg.bottomAKRounds}, 庄家座位分布 ${JSON.stringify(agg.dealerSeats)}`);
  for(const x of recs.filter(x => !x.ok)){
    console.log(`  [异常局 #${x.no}] illegalDelta=${x.illegalDelta} errDelta=${x.errDelta} stall=${JSON.stringify(x.stall || x.rec)}`);
  }
}
console.log(`\n(集成测试耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// ---------------- 汇总输出 ----------------
const allIllegal = JSON.parse(g('JSON.stringify(__T.illegal)'));const allRounds = JSON.parse(g('JSON.stringify(__T.rounds)'));
const bottomEvents = JSON.parse(g('JSON.stringify(__T.bottomEvents)'));
console.log('\n================ 全局校验汇总 ================');
console.log(`总局数: ${allRounds.length}  总出牌次数: ${allRounds.reduce((s, r) => s + r.plays, 0)}`);
console.log(`每局墩数全部=21: ${allRounds.every(r => r.tricks === 21)}`);
console.log(`每局出牌总数全部=84: ${allRounds.every(r => r.plays === 84)}`);
console.log(`每局正常结算(dealerWin 字段存在): ${allRounds.every(r => typeof r.dealerWin === 'boolean')}`);
console.log(`违规记录数: ${allIllegal.length}`);
if(allIllegal.length) console.log('  前 10 条: ' + JSON.stringify(allIllegal.slice(0, 10), null, 1));
console.log(`未捕获异常数: ${uncaught.length}`);
if(uncaught.length) console.log('  ' + uncaught.slice(0, 5).join('\n  '));
console.log(`抠底事件: ${JSON.stringify(bottomEvents)}`);

fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify({ unit, summary, allIllegal, uncaught, allRounds, bottomEvents }, null, 2));
console.log('\n详细结果已写入 .test-tmp/results.json');
})().catch(e => { console.error('驱动崩溃:', e); process.exit(1); });
