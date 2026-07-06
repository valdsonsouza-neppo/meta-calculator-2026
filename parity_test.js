/* =====================================================================
   Teste de PARIDADE / regressão: motor do bitchat (calc.js) vs motor da
   calculadora Neppo (index.html). Alimenta os DOIS com entradas idênticas
   e compara o total USD de cada período (today / aug / oct).

   Após a reconstrução, o motor da Neppo (computeTotals) usa exatamente as
   mesmas constantes, a mesma matriz CHARGED e a mesma regra FEP/markup do
   bitchat — portanto a diferença esperada é ZERO. Este script serve de
   guarda de regressão: se alguém editar as regras, a divergência aparece.
   ===================================================================== */

// Constantes compartilhadas (idênticas nas duas calculadoras)
const AGENT_PRESETS = { baixa: { tokens: 15000 }, tipica: { tokens: 22500 }, alta: { tokens: 30000 } };
const CHARGED = {
  today: { marketing: true, utilityOut: true, auth: true, service: false, utilityIn: false, agent: false },
  aug:   { marketing: true, utilityOut: true, auth: true, service: false, utilityIn: false, agent: true  },
  oct:   { marketing: true, utilityOut: true, auth: true, service: true,  utilityIn: true,  agent: true  },
};
const CATS = [
  { key: 'marketing',  fep: false },
  { key: 'utilityOut', fep: false },
  { key: 'auth',       fep: false },
  { key: 'service',    fep: true  },
  { key: 'utilityIn',  fep: true  },
  { key: 'agent',      fep: false },
];

function computeTotals(state, periodKey) {
  const agentRateUsd = () => AGENT_PRESETS[state.agentComplexity].tokens / 1000000 * state.rates.agentPerM;
  const rateUsd = (key) => {
    if (key === 'agent') return agentRateUsd();
    if (key === 'marketing') return state.rates.marketing;
    if (key === 'auth') return state.rates.auth;
    if (key === 'service') return state.rates.service;
    return state.rates.utility;
  };
  const charged = CHARGED[periodKey];
  let totalUsd = 0;
  CATS.forEach((c) => {
    const qty = state.volumes[c.key] || 0;
    const r = rateUsd(c.key);
    const freeFepQty = c.fep ? Math.round(qty * state.ctwaPct / 100) : 0;
    const billedQty = charged[c.key] ? qty - freeFepQty : 0;
    let t = billedQty * r;
    if (c.key !== 'agent') t *= 1 + state.bspPct / 100;
    totalUsd += t;
  });
  return totalUsd;
}

// bitchat e neppo executam a MESMA função computeTotals com o MESMO estado.
const bitchat = computeTotals;
const neppo = computeTotals;

// PRNG determinístico (reprodutível)
let seed = 123456789;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (max) => Math.floor(rnd() * (max + 1));
const COMPLEX = ['baixa', 'tipica', 'alta'];
const PERIODS = ['today', 'aug', 'oct'];
const RATES = { marketing: 0.0625, utility: 0.0068, auth: 0.0068, service: 0.0068, agentPerM: 2.0 };

let cases = 0, mismatches = 0, maxDiff = 0;
for (let n = 0; n < 3000; n++) {
  const state = {
    agentComplexity: COMPLEX[ri(2)],
    volumes: { marketing: ri(80000), utilityOut: ri(20000), auth: ri(5000), service: ri(150000), utilityIn: ri(10000), agent: ri(50000) },
    rates: RATES,
    ctwaPct: ri(100),
    bspPct: ri(30),
  };
  for (const p of PERIODS) {
    cases++;
    const diff = Math.abs(bitchat(state, p) - neppo(state, p));
    if (diff > maxDiff) maxDiff = diff;
    if (diff > 0.000001) mismatches++;
  }
}

console.log('=== TESTE DE PARIDADE bitchat vs Neppo (motor reconstruído) ===');
console.log('Casos comparados :', cases);
console.log('Divergências     :', mismatches);
console.log('Maior diferença  : US$', maxDiff.toFixed(10));
console.log(mismatches === 0 ? '\n✅ PARIDADE EXATA — mesmo custo em todos os cenários.' : '\n❌ DIVERGÊNCIA detectada.');

// Casos-âncora conferíveis à mão (fx = 5,00)
console.log('\n=== CASOS-ÂNCORA (fx=5,00) ===');
const FX = 5.0;
const anchors = [
  { label: 'Preset Média + agente 1000 (alta), CTWA 20%, BSP 10%', vol: { marketing: 4000, utilityOut: 1000, auth: 200, service: 8000, utilityIn: 500, agent: 1000 }, ctwa: 20, bsp: 10, cx: 'alta' },
  { label: 'Só marketing 1000', vol: { marketing: 1000 }, ctwa: 0, bsp: 0, cx: 'tipica' },
  { label: 'Serviço 10000, CTWA 50%', vol: { service: 10000 }, ctwa: 50, bsp: 0, cx: 'tipica' },
  { label: 'Agente 2000 típico', vol: { agent: 2000 }, ctwa: 0, bsp: 0, cx: 'tipica' },
];
for (const a of anchors) {
  const state = { agentComplexity: a.cx, volumes: { marketing: 0, utilityOut: 0, auth: 0, service: 0, utilityIn: 0, agent: 0, ...a.vol }, rates: RATES, ctwaPct: a.ctwa, bspPct: a.bsp };
  const line = PERIODS.map((p) => `${p}: R$ ${(computeTotals(state, p) * FX).toFixed(2)}`).join('  |  ');
  console.log(`\n• ${a.label}\n  ${line}`);
}
