// ===== 测试插桩：附加在游戏脚本之后，与其共享全局作用域 =====
playSound = function(){}; // 静音

const __T = globalThis.__T = {
  illegal: [],        // 违规/异常记录
  errors: [],         // 捕获的运行时错误
  rounds: [],         // 每局记录
  curTricks: [],      // 当前局各墩数据
  playsThisRound: 0,
  throwsLed: 0,
  throwFollows: 0,
  bottomEvents: [],
};

function __T_swap(idx, fn){
  // validateFollow/validateFollowThrow 内部硬编码检查 HUMAN_INDEX 的手牌，
  // 通过换手技巧复用游戏原代码验证 AI 座位
  const h0 = state.players[HUMAN_INDEX].hand;
  state.players[HUMAN_INDEX].hand = state.players[idx].hand;
  try { return fn(); }
  finally { state.players[HUMAN_INDEX].hand = h0; }
}

function __T_checkPlay(idx, cards, info){
  const T = globalThis.__T;
  if(T.illegal.length > 100) return; // 防刷屏上限
  T.playsThisRound++;
  const tag = {round: state.roundNumber, trick: state.trickCount + 1, seat: idx};
  try{
    if(!Array.isArray(cards) || cards.length === 0){ T.illegal.push({...tag, type: 'emptyPlay'}); return; }
    const hand = state.players[idx].hand;
    for(const c of cards){
      if(!hand.includes(c)) T.illegal.push({...tag, type: 'notInHand', card: cardText(c)});
    }
    const ids = cards.map(c => c.id);
    if(new Set(ids).size !== ids.length) T.illegal.push({...tag, type: 'dupCardInPlay'});
    const lead = state.currentTrick[0];
    if(!lead){
      const v = validateLead(cards);
      if(!v.ok) T.illegal.push({...tag, type: 'illegalLead', msg: v.msg || ('throwFailed=' + v.throwFailed), cards: cards.map(cardText)});
      if(info && info.type === 'throw') T.throwsLed++;
    } else {
      if(cards.length !== lead.cards.length) T.illegal.push({...tag, type: 'wrongCount', leadLen: lead.cards.length, got: cards.length});
      if(lead.type === 'throw'){
        T.throwFollows++;
        const v = __T_swap(idx, () => validateFollowThrow(cards, lead));
        if(!v.ok) T.illegal.push({...tag, type: 'illegalThrowFollow', msg: v.msg, lead: lead.cards.map(cardText), cards: cards.map(cardText)});
      } else {
        const v = __T_swap(idx, () => validateFollow(cards, lead));
        if(!v.ok) T.illegal.push({...tag, type: 'illegalFollow', msg: v.msg, lead: lead.cards.map(cardText), cards: cards.map(cardText)});
      }
    }
  }catch(e){ T.illegal.push({...tag, type: 'checkError', err: String((e && e.stack) || e)}); }
}

// ---- 包装：把人类座位交给 AI 驱动 ----
// 游戏所有“等待人类输入”的分支都会调用 showPanel('bid'|'exchange'|'play')，
// 在此统一接管，可保证恰好驱动一次（驱动后出牌同步入列，状态随即改变）
const __W_showPanel = showPanel;
showPanel = function(name){
  __W_showPanel(name);
  if(name === 'bid' && state.phase === 'bidding' && state.turn === HUMAN_INDEX){
    aiBid(HUMAN_INDEX);
  } else if(name === 'exchange' && state.phase === 'exchange' && state.dealerIndex === HUMAN_INDEX){
    aiExchangeAndTrump();
  } else if(name === 'play' && state.phase === 'play' && state.turn === HUMAN_INDEX && state.currentTrick.length < 4){
    aiTurn();
  }
};
const __W_startTrick = startTrick;
startTrick = function(){
  if(state.phase === 'play' && state.turn !== state.currentLeader){
    __T.illegal.push({type: 'badLeader', turn: state.turn, leader: state.currentLeader, trick: state.trickCount + 1, round: state.roundNumber});
  }
  __W_startTrick();
};
const __W_startNewRound = startNewRound;
startNewRound = function(p){
  const T = globalThis.__T;
  T.playsThisRound = 0; T.throwsLed = 0; T.throwFollows = 0; T.curTricks = [];
  __W_startNewRound(p);
};

// ---- 包装：出牌校验 ----
const __W_playCards = playCards;
playCards = async function(idx, cards, info){
  __T_checkPlay(idx, cards, info);
  return __W_playCards(idx, cards, info);
};

// ---- 包装：独立重算每墩赢家与分值，并核对游戏本墩的得分增量 ----
const __W_finishTrick = finishTrick;
finishTrick = async function(){
  const T = globalThis.__T;
  const trick = state.currentTrick.slice();
  try{
    const lead = trick[0];
    let winner = lead;
    if(lead.type !== 'throw'){
      for(let i = 1; i < trick.length; i++){
        const p = trick[i];
        if(playBeats(p, winner.category, winner.maxRank, winner.effectiveType, lead.category)) winner = p;
      }
    }
    let pts = 0;
    for(const p of trick) for(const c of p.cards) pts += scoreValue(c);
    if(trick.length !== 4) T.illegal.push({type: 'trickSize', val: trick.length, round: state.roundNumber, trick: state.trickCount + 1});
    const before = state.defenderPoints;
    const r = await __W_finishTrick();
    const delta = state.defenderPoints - before;
    // 按游戏规则文本重算本墩期望增量（含抠底）
    let expDelta = (winner.playerIndex !== state.dealerIndex) ? pts : 0;
    let koudiModel = null;
    if(allHandsEmpty() && winner.category === 'trump'){
      let mult = 1;
      if(lead.type === 'throw'){
        const hasPair = lead.units && lead.units.some(u => u.type === 'pair');
        const hasTractor = lead.units && lead.units.some(u => u.type === 'tractor');
        if(hasTractor) mult = 4; else if(hasPair) mult = 2;
      } else if(lead.type === 'pair') mult = 2;
      else if(lead.type === 'tractor') mult = 4;
      expDelta += state.bottomScore * mult;
      koudiModel = {mult, bottomScore: state.bottomScore};
    }
    const rec = {winner: winner.playerIndex, winnerTrump: winner.category === 'trump', pts, delta, expDelta,
      leadType: lead.type, leadUnits: lead.units ? lead.units.map(u => u.type) : null, koudiModel};
    if(delta !== expDelta) T.illegal.push({type: 'trickDelta', round: state.roundNumber, trick: state.trickCount, rec});
    T.curTricks.push(rec);
    return r;
  }catch(e){
    T.illegal.push({type: 'trickCheckError', err: String((e && e.stack) || e)});
    return __W_finishTrick();
  }
};

// ---- 包装：埋底详情 ----
const __W_aiExchange = aiExchangeAndTrump;
aiExchangeAndTrump = function(){
  __W_aiExchange();
  const T = globalThis.__T;
  T.lastBury = {
    trump: state.trumpSuit,
    bottom: state.bottom.map(cardText),
    bottomAK: state.bottom.filter(c => c.rank === 'A' || c.rank === 'K').map(cardText),
    dealerHandAK: state.players[state.dealerIndex].hand.filter(c => c.rank === 'A' || c.rank === 'K').length,
  };
};

// ---- 包装：局末一致性核对 ----
const __W_endRound = endRound;
endRound = function(){
  const T = globalThis.__T;
  try{
    const tricks = T.curTricks;
    let exp = 0, totPts = 0, trickDeltaBad = 0;
    for(const t of tricks){
      totPts += t.pts; exp += t.expDelta;
      if(t.delta !== t.expDelta) trickDeltaBad++;
    }
    const last = tricks[tricks.length - 1];
    let koudi = last && last.koudiModel ? last.koudiModel : null;
    if(koudi) T.bottomEvents.push({round: state.roundNumber, mult: koudi.mult, score: koudi.bottomScore});
    if(exp !== state.defenderPoints) T.illegal.push({type: 'scoreMismatch', exp, actual: state.defenderPoints, round: state.roundNumber, trickDeltaBad});
    if(totPts !== 200 - state.bottomScore) T.illegal.push({type: 'pointsNotConserved', totPts, bottom: state.bottomScore, round: state.roundNumber});
    if(!allHandsEmpty()) T.illegal.push({type: 'handsNotEmpty', hands: state.players.map(p => p.hand.length), round: state.roundNumber});
    if(state.memory.playedCards.size !== 84) T.illegal.push({type: 'playedCount', val: state.memory.playedCards.size, round: state.roundNumber});
    if(state.bottom.length !== 8) T.illegal.push({type: 'bottomCount', val: state.bottom.length, round: state.roundNumber});
    if(state.bid == null || state.dealerIndex == null) T.illegal.push({type: 'noBid', round: state.roundNumber});
    const score = state.defenderPoints, bid = state.bid;
    const dealerWin = score < bid;
    let result;
    if(dealerWin) result = score === 0 ? '大光' : (score <= 30 ? '小光' : '过庄');
    else { const over = score - bid; result = over >= 70 ? '大倒' : (over >= 40 ? '小倒' : '垮庄'); }
    T.rounds.push({
      round: state.roundNumber, difficulty: getDifficulty(),
      dealer: state.dealerIndex, bid, score, dealerWin, result, koudi,
      tricks: state.trickCount,
      bottomAK: state.bottom.filter(c => c.rank === 'A' || c.rank === 'K').length,
      plays: T.playsThisRound, throwsLed: T.throwsLed, throwFollows: T.throwFollows,
    });
  }catch(e){ T.illegal.push({type: 'endRoundCheckError', err: String((e && e.stack) || e), round: state.roundNumber}); }
  return __W_endRound();
};
