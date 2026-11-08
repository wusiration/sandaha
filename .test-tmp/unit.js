// ===== 单元测试：在与游戏相同的作用域内执行，返回 JSON =====
JSON.stringify((function(){
  const R = { followThrow: [], bury: [], keepValue: [] };
  let nextId = 100000;
  function mk(suit, rank){ return { id: nextId++, suit: suit, rank: rank, copy: 0 }; }
  function texts(cards){ return cards.map(cardText); }
  function setup(){
    state = initState();
    state.phase = 'play';
    state.trumpSuit = 's';
    state.dealerIndex = 1;
    state.bid = 80;
    state.memory.totalTrumps = totalTrumpCount('s');
  }
  function leadThrow(cards){
    const units = splitToUnits(cards, 'trump');
    return { playerIndex: 1, type: 'throw', category: 'trump', cards: cards, units: units,
      maxRank: Math.max(...units.map(u => u.maxRank)), effectiveType: 'throw' };
  }
  function typesOf(cards){ return splitToUnits(cards, 'trump').map(u => u.type); }
  function push(arr, name, ok, extra){
    const o = { case: name, ok: !!ok };
    if(extra) Object.assign(o, extra);
    arr.push(o);
    return o;
  }

  // ---------- aiChooseFollowThrow ----------
  // A1: 首甩含拖拉机+对子，跟家拖拉机/对子齐全 → 必须跟出拖拉机(对子可被拖拉机吸收)
  setup();
  const leadA1 = leadThrow([mk('s','A'),mk('s','A'),mk('s','K'),mk('s','K'),mk('s','Q'),mk('s','Q'),mk('s','J'),mk('s','10')]);
  state.currentTrick = [leadA1];
  state.players[0].hand = [mk('s','A'),mk('s','A'),mk('s','K'),mk('s','K'),mk('s','Q'),mk('s','Q'),mk('s','9'),mk('s','8')];
  let res = aiChooseFollowThrow(0, leadA1);
  let v = validateFollowThrow(res.cards, leadA1);
  let types = typesOf(res.cards);
  push(R.followThrow, 'A1 有拖拉机必须跟拖拉机(对子可被吸收)', v.ok && types.includes('tractor'),
    { got: texts(res.cards), unitTypes: types });

  // A2: 跟家全是单主 → 允许全单主
  setup();
  const leadA2 = leadA1;
  state.currentTrick = [leadA2];
  state.players[0].hand = [mk('s','J'),mk('s','10'),mk('s','9'),mk('s','8'),mk('h','7'),mk('c','7'),mk('s','6'),mk('s','5')];
  res = aiChooseFollowThrow(0, leadA2);
  v = validateFollowThrow(res.cards, leadA2);
  types = typesOf(res.cards);
  push(R.followThrow, 'A2 全单主可跟', v.ok && res.cards.length === 8 && !types.includes('pair') && !types.includes('tractor'),
    { got: texts(res.cards), unitTypes: types });

  // A3: 跟家只有 5 张主(含对子) + 3 张副牌 → 全主+垫牌
  setup();
  state.currentTrick = [leadA1];
  state.players[0].hand = [mk('s','Q'),mk('s','Q'),mk('s','J'),mk('s','10'),mk('s','9'),mk('h','5'),mk('h','6'),mk('h','8')];
  res = aiChooseFollowThrow(0, leadA1);
  v = validateFollowThrow(res.cards, leadA1);
  push(R.followThrow, 'A3 主牌不足时全主+垫牌', v.ok && res.cards.length === 8,
    { got: texts(res.cards), category: res.category });

  // A4: 首甩需要对子(无拖拉机单元)，跟家无拖拉机但有对子 → 必须跟对子
  setup();
  const leadA4 = leadThrow([mk('s','Q'),mk('s','Q'),mk('s','J'),mk('s','10'),mk('s','9'),mk('s','8'),mk('s','6'),mk('s','5')]);
  state.currentTrick = [leadA4];
  state.players[0].hand = [mk('s','J'),mk('s','J'),mk('s','10'),mk('s','9'),mk('s','8'),mk('s','6'),mk('s','5'),mk('h','7')];
  res = aiChooseFollowThrow(0, leadA4);
  v = validateFollowThrow(res.cards, leadA4);
  types = typesOf(res.cards);
  push(R.followThrow, 'A4 有对子必须跟对子', v.ok && types.includes('pair'),
    { got: texts(res.cards), unitTypes: types });

  // A5: 首甩 8 张含拖拉机+对子，跟家仅 2 张主(对子)+6 张副牌
  setup();
  state.currentTrick = [leadA1];
  state.players[0].hand = [mk('s','Q'),mk('s','Q'),mk('h','5'),mk('h','6'),mk('h','8'),mk('h','9'),mk('c','5'),mk('c','6')];
  res = aiChooseFollowThrow(0, leadA1);
  v = validateFollowThrow(res.cards, leadA1);
  push(R.followThrow, 'A5 仅2主(对子)+6垫牌', v.ok && res.cards.length === 8 && res.category === 'discard',
    { got: texts(res.cards) });

  // A6: 跟家 10 张主，结构齐全 → 恰好出 8 张且合法
  setup();
  state.currentTrick = [leadA1];
  state.players[0].hand = [mk('s','A'),mk('s','A'),mk('s','K'),mk('s','K'),mk('s','Q'),mk('s','Q'),mk('s','J'),mk('s','10'),mk('s','9'),mk('s','8')];
  res = aiChooseFollowThrow(0, leadA1);
  v = validateFollowThrow(res.cards, leadA1);
  push(R.followThrow, 'A6 主牌富余取8张', v.ok && res.cards.length === 8, { got: texts(res.cards) });

  // ---------- dealerKeepValue ----------
  setup();
  const vA = dealerKeepValue(mk('h','A'), 2);
  const vK = dealerKeepValue(mk('h','K'), 2);
  const vQ = dealerKeepValue(mk('h','Q'), 2);
  const v10 = dealerKeepValue(mk('h','10'), 2);
  const v5 = dealerKeepValue(mk('h','5'), 2);
  push(R.keepValue, 'A>K>Q>10>5 排序', vA > vK && vK > vQ && vQ > v10 && v10 > v5,
    { A: vA, K: vK, Q: vQ, '10': v10, '5': v5 });
  push(R.keepValue, 'A 显著高于 10 分牌(修复点)', (vA - v10) >= 15, { diff: +(vA - v10).toFixed(1) });

  // ---------- aiExchangeAndTrump 埋底 ----------
  setup();
  state.dealerIndex = 2;
  state.players[2].hand = [
    // 强主套 s（含 77、22 拖拉机）
    mk('s','A'), mk('s','K'), mk('s','Q'), mk('s','J'), mk('s','10'), mk('s','9'),
    mk('s','7'), mk('s','7'), mk('s','2'), mk('s','2'),
    // 副牌：含 hA(副A)、dK(副K) 与大量低牌（合计 29 张）
    mk('h','A'), mk('h','5'), mk('h','9'), mk('h','9'), mk('h','8'), mk('h','6'),
    mk('d','K'), mk('d','9'), mk('d','9'), mk('d','8'), mk('d','6'), mk('d','5'),
    mk('c','10'), mk('c','9'), mk('c','8'), mk('c','8'), mk('c','6'), mk('c','5'),
    mk('h','J'),
  ];
  state.bottom = [];
  const __f = finishExchangeAndTrump;
  finishExchangeAndTrump = function(t){ state.trumpSuit = t; };
  aiExchangeAndTrump();
  finishExchangeAndTrump = __f;
  const akBuried = state.bottom.filter(c => c.rank === 'A' || c.rank === 'K');
  push(R.bury, '副牌 A/K 不入底', state.bottom.length === 8 && akBuried.length === 0 && state.players[2].hand.length === 21,
    { trump: state.trumpSuit, bottom: texts(state.bottom), akBuried: texts(akBuried),
      keptAK: texts(state.players[2].hand.filter(c => c.rank === 'A' || c.rank === 'K')) });

  state = initState(); // 恢复干净状态
  return R;
})())
