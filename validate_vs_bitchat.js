/* =====================================================================
   VALIDAÇÃO ponta a ponta: extrai o motor de cálculo REAL de cada site
   direto dos arquivos e compara os resultados.

   Fonte bitchat : bitchat-calc-reference.js  (calc.js baixado do ar)
   Fonte Neppo   : index.html                 (a página desta pasta)

   Nenhuma lógica é reescrita aqui — as funções (AGENT_PRESETS, CHARGED,
   CATS, agentRateUsd, rateUsd, computeTotals) são fatiadas do texto de
   cada arquivo e executadas. Se os dados gerados divergirem, aparece.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const bitchatSrc = fs.readFileSync(path.join(DIR, 'bitchat-calc-reference.js'), 'utf8');
const neppoSrc   = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

/* Fatia uma declaração balanceada ({...} ou [...] ou corpo de função) a
   partir de um cabeçalho, contando o tipo de delimitador de abertura. */
function grab(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error('Não encontrado: ' + header);
  let b = i;
  while (b < src.length && src[b] !== '{' && src[b] !== '[') b++;
  const open = src[b], close = open === '{' ? '}' : ']';
  let depth = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(i, j) + ';';
}

/* Monta um motor executável a partir do texto-fonte de um arquivo. */
function buildEngine(src, label) {
  const parts = [
    grab(src, 'var AGENT_PRESETS'),
    grab(src, 'var CHARGED'),
    grab(src, 'var CATS'),
    grab(src, 'function agentRateUsd'),
    grab(src, 'function rateUsd'),
    grab(src, 'function computeTotals'),
  ];
  const factory = new Function(
    'var state;\n' + parts.join('\n') +
    '\nreturn { setState:function(s){state=s;}, compute:function(p){return computeTotals(p);}, AGENT_PRESETS:AGENT_PRESETS, CHARGED:CHARGED, CATS:CATS };'
  );
  const eng = factory();
  eng.label = label;
  return eng;
}

/* Lê o objeto `state` default (tarifas, câmbio, complexidade) de um arquivo. */
function defaultState(src) {
  const txt = grab(src, 'var state =').replace(/^var state =\s*/, '').replace(/;$/, '');
  return new Function('return (' + txt + ');')();
}

const bit = buildEngine(bitchatSrc, 'bitchat');
const nep = buildEngine(neppoSrc, 'neppo');

console.log('======================================================');
console.log(' VALIDAÇÃO: calculadora Neppo  vs  calculadora bitchat');
console.log('======================================================\n');

/* 1) As TARIFAS e constantes shipadas são as mesmas? -------------------- */
const bState = defaultState(bitchatSrc), nState = defaultState(neppoSrc);
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
console.log('1) Constantes/tarifas embarcadas nos dois arquivos');
const checks = [
  ['Tarifas (rates)',        bState.rates,        nState.rates],
  ['Tokens por complexidade',bit.AGENT_PRESETS,   nep.AGENT_PRESETS],
  ['Matriz de cobrança',     bit.CHARGED,         nep.CHARGED],
  ['Flags FEP (CTWA) das categorias', bit.CATS.map(c=>({k:c.key,fep:c.fep})), nep.CATS.map(c=>({k:c.key,fep:c.fep}))],
];
let allEqual = true;
checks.forEach(([name, a, b]) => {
  const ok = eq(a, b);
  if (!ok) allEqual = false;
  console.log('   ' + (ok ? '✅' : '❌') + ' ' + name + (ok ? ' — idênticas' : '\n     bitchat: ' + JSON.stringify(a) + '\n     neppo  : ' + JSON.stringify(b)));
});
console.log('   → tarifa marketing: US$', bState.rates.marketing, '| utilidade/auth/serviço: US$', bState.rates.utility, '| agente: US$', bState.rates.agentPerM, '/1M tokens\n');

/* 2) Os RESULTADOS batem em muitas combinações aleatórias? -------------- */
let seed = 20260703;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const ri = (m) => Math.floor(rnd() * (m + 1));
const COMPLEX = ['baixa', 'tipica', 'alta'];
const PERIODS = ['today', 'aug', 'oct'];
const RATES = { marketing: 0.0625, utility: 0.0068, auth: 0.0068, service: 0.0068, agentPerM: 2.0 };

let cases = 0, mismatch = 0, maxDiff = 0;
for (let n = 0; n < 5000; n++) {
  const st = {
    agentComplexity: COMPLEX[ri(2)],
    volumes: { marketing: ri(80000), utilityOut: ri(20000), auth: ri(5000), service: ri(150000), utilityIn: ri(10000), agent: ri(50000) },
    rates: RATES, ctwaPct: ri(100), bspPct: ri(30), fx: { rate: 1 },
  };
  bit.setState(st); nep.setState(st);
  for (const p of PERIODS) {
    cases++;
    const d = Math.abs(bit.compute(p).totalUsd - nep.compute(p).totalUsd);
    if (d > maxDiff) maxDiff = d;
    if (d > 1e-9) mismatch++;
  }
}
console.log('2) Resultados em ' + cases + ' cenários aleatórios');
console.log('   ' + (mismatch === 0 ? '✅' : '❌') + ' divergências: ' + mismatch + ' | maior diferença: US$ ' + maxDiff.toFixed(10) + '\n');

/* 3) Casos-âncora lado a lado, em reais (fx = 5,00) --------------------- */
console.log('3) Casos-âncora — bitchat vs Neppo (câmbio R$ 5,00)');
const FX = 5.0;
const anchors = [
  { label: 'Preset Média + agente 1000 (alta), CTWA 20%, BSP 10%', vol: { marketing:4000, utilityOut:1000, auth:200, service:8000, utilityIn:500, agent:1000 }, ctwa:20, bsp:10, cx:'alta' },
  { label: 'Preset Grande, sem agente',                            vol: { marketing:20000, utilityOut:4000, auth:1000, service:40000, utilityIn:3000, agent:0 }, ctwa:0, bsp:0, cx:'tipica' },
  { label: 'Só atendimento 10.000, CTWA 50%',                      vol: { service:10000 }, ctwa:50, bsp:0, cx:'tipica' },
  { label: 'Só agente 2.000 (típico)',                             vol: { agent:2000 }, ctwa:0, bsp:0, cx:'tipica' },
  { label: 'Utilidade 500 fora + 500 na janela, CTWA 100%',        vol: { utilityOut:500, utilityIn:500 }, ctwa:100, bsp:0, cx:'tipica' },
];
let anchorOK = true;
for (const a of anchors) {
  const st = { agentComplexity: a.cx, volumes: { marketing:0, utilityOut:0, auth:0, service:0, utilityIn:0, agent:0, ...a.vol }, rates: RATES, ctwaPct: a.ctwa, bspPct: a.bsp, fx: { rate: 1 } };
  bit.setState(st); nep.setState(st);
  console.log('\n • ' + a.label);
  PERIODS.forEach((p) => {
    const b = bit.compute(p).totalUsd * FX, e = nep.compute(p).totalUsd * FX;
    const ok = Math.abs(b - e) <= 0.005; if (!ok) anchorOK = false;
    const lbl = { today: 'Hoje    ', aug: 'Ago–Set ', oct: 'Out/26+ ' }[p];
    console.log('    ' + lbl + ' bitchat R$ ' + b.toFixed(2).padStart(10) + '   |   Neppo R$ ' + e.toFixed(2).padStart(10) + '   ' + (ok ? '✅' : '❌ DIFERE'));
  });
}

console.log('\n======================================================');
console.log(allEqual && mismatch === 0 && anchorOK
  ? ' RESULTADO: ✅ dados VÁLIDOS — a calculadora Neppo gera exatamente\n            os mesmos valores que a calculadora do bitchat.'
  : ' RESULTADO: ❌ há divergência — revisar acima.');
console.log('======================================================');
