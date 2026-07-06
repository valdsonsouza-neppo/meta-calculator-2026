/* ===================================================================
   BitChat — Calculadora da Nova Precificação do WhatsApp (Meta 2026)
   Motor de cálculo compartilhado entre a calculadora pública e as
   páginas por cliente (que definem window.BITCALC_PRESET).
   Tarifas oficiais Meta para o Brasil (USD) — editáveis no painel avançado:
   - Marketing (template): 0.0625/msg — sempre cobrado
   - Utility / Autenticação / Serviço: 0.0068/msg
   - Meta Business Agent: US$ 2.00 / 1M tokens (a partir de 01/08/2026)
   - Serviço e utility dentro da janela 24h: grátis até 30/09/2026
   - Janela FEP 72h (Click-to-WhatsApp): entrega grátis (MBA paga tokens)
   =================================================================== */
(function () {
  'use strict';

  var AGENT_PRESETS = {
    baixa:  { tokens: 15000, label: 'Baixa complexidade' },
    tipica: { tokens: 22500, label: 'Complexidade típica' },
    alta:   { tokens: 30000, label: 'Alta complexidade' }
  };

  // Em quais períodos cada categoria é cobrada
  var CHARGED = {
    today: { marketing: true, utilityOut: true, auth: true, service: false, utilityIn: false, agent: false },
    aug:   { marketing: true, utilityOut: true, auth: true, service: false, utilityIn: false, agent: true  },
    oct:   { marketing: true, utilityOut: true, auth: true, service: true,  utilityIn: true,  agent: true  }
  };
  var PERIOD_LABEL = {
    today: 'Hoje (jul/2026)',
    aug:   'Ago–Set/2026',
    oct:   'A partir de Out/2026'
  };

  var CATS = [
    { key: 'marketing',  name: 'Marketing (template)',              fep: false },
    { key: 'utilityOut', name: 'Utilidade (template)',              fep: false },
    { key: 'auth',       name: 'Autenticação (OTP)',                fep: false },
    { key: 'service',    name: 'Atendimento humano / IA própria',   fep: true  },
    { key: 'utilityIn',  name: 'Utilidade na janela 24h',           fep: true  },
    { key: 'agent',      name: 'Meta Business Agent',               fep: false }
  ];

  // volumes típicos por porte de operação (calculadora pública)
  var PORTES = {
    pequena:    { label: 'Pequena',    hint: 'até ~500 conversas/mês',   volumes: { marketing: 500,   utilityOut: 200,   auth: 0,    service: 1500,   utilityIn: 100,   agent: 0 } },
    media:      { label: 'Média',      hint: '~3–5 mil conversas/mês',   volumes: { marketing: 4000,  utilityOut: 1000,  auth: 200,  service: 8000,   utilityIn: 500,   agent: 0 } },
    grande:     { label: 'Grande',     hint: '~20–30 mil conversas/mês', volumes: { marketing: 20000, utilityOut: 4000,  auth: 1000, service: 40000,  utilityIn: 3000,  agent: 0 } },
    enterprise: { label: 'Enterprise', hint: '100 mil+ conversas/mês',   volumes: { marketing: 80000, utilityOut: 20000, auth: 5000, service: 150000, utilityIn: 10000, agent: 0 } }
  };

  var state = {
    period: 'today',
    agentComplexity: 'tipica',
    volumes: { marketing: 0, utilityOut: 0, auth: 0, service: 0, utilityIn: 0, agent: 0 },
    rates: { marketing: 0.0625, utility: 0.0068, auth: 0.0068, service: 0.0068, agentPerM: 2.0 },
    ctwaPct: 0,
    bspPct: 0,
    fx: { rate: 5.16, live: false, manual: false, when: null, source: null }
  };

  var preset = window.BITCALC_PRESET || null;
  var presetVolumes = null;
  if (preset && preset.volumes) {
    presetVolumes = {};
    Object.keys(state.volumes).forEach(function (k) {
      presetVolumes[k] = typeof preset.volumes[k] === 'number' ? Math.round(preset.volumes[k]) : 0;
      state.volumes[k] = presetVolumes[k];
    });
  }

  // ---------- formatação ----------
  var fmtInt = new Intl.NumberFormat('pt-BR');
  function brl(v, decimals) {
    return v.toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL',
      minimumFractionDigits: decimals == null ? 2 : decimals,
      maximumFractionDigits: decimals == null ? 2 : decimals
    });
  }
  function usd(v, decimals) {
    return 'US$ ' + v.toLocaleString('pt-BR', {
      minimumFractionDigits: decimals == null ? 2 : decimals,
      maximumFractionDigits: decimals == null ? 2 : decimals
    });
  }

  function agentRateUsd() {
    return AGENT_PRESETS[state.agentComplexity].tokens / 1000000 * state.rates.agentPerM;
  }
  function rateUsd(key) {
    if (key === 'agent') return agentRateUsd();
    if (key === 'marketing') return state.rates.marketing;
    if (key === 'auth') return state.rates.auth;
    if (key === 'service') return state.rates.service;
    return state.rates.utility; // utilityOut / utilityIn
  }

  function computeTotals(periodKey) {
    var charged = CHARGED[periodKey];
    var totalUsd = 0, totalMsgs = 0;
    var rows = CATS.map(function (c) {
      var qty = state.volumes[c.key] || 0;
      var isCharged = charged[c.key];
      var r = rateUsd(c.key);
      // Janela FEP 72h (CTWA): entrega grátis p/ serviço e utility na janela; MBA segue pagando tokens
      var freeFepQty = c.fep ? Math.round(qty * state.ctwaPct / 100) : 0;
      var billedQty = isCharged ? qty - freeFepQty : 0;
      var t = billedQty * r;
      // Markup do BSP incide sobre a entrega, nunca sobre tokens do MBA
      if (c.key !== 'agent') t *= 1 + state.bspPct / 100;
      totalUsd += t;
      totalMsgs += qty;
      return { key: c.key, name: c.name, qty: qty, freeFepQty: freeFepQty, rateUsd: r, charged: isCharged, totalUsd: t };
    });
    return { rows: rows, totalUsd: totalUsd, totalBrl: totalUsd * state.fx.rate, totalMsgs: totalMsgs };
  }

  // ---------- DOM ----------
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function paintRange(input) {
    var min = +input.min || 0, max = +input.max || 100;
    var pct = Math.min(100, Math.max(0, ((+input.value - min) / (max - min)) * 100));
    input.style.background = 'linear-gradient(90deg, #2563eb 0%, #7c3aed ' + pct + '%, #e2e8f0 ' + pct + '%)';
  }

  function syncVolumeInputs() {
    CATS.forEach(function (c) {
      var row = $('[data-vol-row="' + c.key + '"]');
      if (!row) return;
      var range = row.querySelector('input[type=range]');
      var num = row.querySelector('input[type=number]');
      num.value = state.volumes[c.key];
      range.value = Math.min(state.volumes[c.key], +range.max);
      paintRange(range);
    });
  }

  function updateFreeBadges() {
    var charged = CHARGED[state.period];
    CATS.forEach(function (c) {
      var row = $('[data-vol-row="' + c.key + '"]');
      if (!row) return;
      row.classList.toggle('is-free-now', !charged[c.key]);
      var badge = row.querySelector('[data-badge]');
      if (badge) {
        if (charged[c.key]) {
          badge.className = 'paid-badge'; badge.textContent = 'Cobrado';
        } else {
          badge.className = 'free-badge';
          badge.textContent = c.key === 'agent' ? 'Grátis até 31/07/2026' : 'Grátis até 30/09/2026';
        }
      }
      var rateEl = row.querySelector('[data-rate]');
      if (rateEl) {
        var r = rateUsd(c.key);
        rateEl.textContent = brl(r * state.fx.rate, 4) + ' / msg (' + usd(r, 4) + ')';
      }
    });
  }

  function render() {
    var res = computeTotals(state.period);

    $('#rTotal').textContent = brl(res.totalBrl);
    $('#rTotalUsd').textContent = usd(res.totalUsd) + ' antes da conversão';
    $('#rPeriod').textContent = PERIOD_LABEL[state.period];
    var chargedMsgs = res.rows.reduce(function (s, r) { return s + (r.charged ? r.qty - r.freeFepQty : 0); }, 0);
    $('#rPerMsg').textContent = chargedMsgs > 0
      ? 'Custo médio de ' + brl(res.totalBrl / chargedMsgs, 4) + ' por mensagem cobrada'
      : 'Nenhuma mensagem cobrada neste cenário';

    // breakdown
    var bd = $('#rBreakdown');
    bd.innerHTML = '';
    res.rows.forEach(function (r) {
      if (r.qty === 0) return;
      var div = document.createElement('div');
      div.className = 'r-row' + (r.charged ? '' : ' dim');
      var fepNote = (r.charged && r.freeFepQty > 0) ? ' <span class="r-qty">(' + fmtInt.format(r.freeFepQty) + ' grátis via CTWA)</span>' : '';
      div.innerHTML =
        '<span class="r-name">' + r.name + ' <span class="r-qty">× ' + fmtInt.format(r.qty) + '</span>' + fepNote + '</span>' +
        (r.charged
          ? '<span class="r-val">' + brl(r.totalUsd * state.fx.rate) + '</span>'
          : '<span class="r-val free">grátis</span>');
      bd.appendChild(div);
    });
    if (!bd.children.length) {
      bd.innerHTML = '<div class="r-row dim"><span class="r-name">Ajuste os volumes ao lado para simular</span></div>';
    }

    $('#rAnnual').textContent = brl(res.totalBrl * 12);
    $('#rMsgs').textContent = fmtInt.format(res.totalMsgs);

    // comparação entre os três períodos (+ delta vs hoje)
    var totals = { today: computeTotals('today'), aug: computeTotals('aug'), oct: computeTotals('oct') };
    var maxV = Math.max(totals.today.totalBrl, totals.aug.totalBrl, totals.oct.totalBrl, 0.01);
    ['today', 'aug', 'oct'].forEach(function (p) {
      var fill = $('[data-cfill="' + p + '"]');
      var val = $('[data-cval="' + p + '"]');
      var row = $('[data-crow="' + p + '"]');
      var delta = $('[data-cdelta="' + p + '"]');
      if (fill) fill.style.width = (totals[p].totalBrl / maxV * 100) + '%';
      if (val) val.textContent = brl(totals[p].totalBrl);
      if (row) row.classList.toggle('current', p === state.period);
      if (delta) {
        var d = totals[p].totalBrl - totals.today.totalBrl;
        delta.textContent = (p !== 'today' && d > 0.005) ? '+' + brl(d) + '/mês vs hoje' : '';
      }
    });

    updateFreeBadges();
    renderFxNote();
    renderTips(totals);
  }

  // ---------- dicas estratégicas dinâmicas ----------
  function renderTips(totals) {
    var el = $('#tipsList');
    if (!el) return;
    var fx = state.fx.rate;
    var tips = [];
    var v = state.volumes;

    if (v.service > 0) {
      var svcBilled = v.service - Math.round(v.service * state.ctwaPct / 100);
      var svcCost = svcBilled * state.rates.service * (1 + state.bspPct / 100) * fx;
      tips.push({
        icon: '✂️',
        title: 'Consolide as respostas do atendimento',
        body: 'A partir de out/2026 suas ' + fmtInt.format(v.service) + ' mensagens de atendimento passam a custar ' + brl(svcCost) + '/mês. Cada mensagem separada ("olá", "tudo bem?", "segue…") vira uma cobrança — consolidar em respostas mais completas reduzindo ~20% do volume economiza ' + brl(svcCost * 0.2) + '/mês.'
      });
    }
    if (v.marketing > 0) {
      var mktCost = v.marketing * state.rates.marketing * (1 + state.bspPct / 100) * fx;
      var asUtil = v.marketing * state.rates.utility * (1 + state.bspPct / 100) * fx;
      tips.push({
        icon: '🏷️',
        title: 'Revise a categoria dos seus templates',
        body: 'Marketing é a tarifa mais cara (' + brl(state.rates.marketing * fx, 4) + '/msg). Avisos transacionais (confirmações, status, lembretes) podem ser aprovados como utilidade, que custa ~9× menos. Se todos os seus ' + fmtInt.format(v.marketing) + ' disparos fossem utilidade, o custo cairia de ' + brl(mktCost) + ' para ' + brl(asUtil) + '/mês.'
      });
    }
    if (v.service + v.utilityIn > 0) {
      var fepQty = Math.round((v.service + v.utilityIn) * 0.15);
      var fepSave = fepQty * state.rates.service * (1 + state.bspPct / 100) * fx;
      tips.push({
        icon: '📢',
        title: 'Tráfego via anúncio Click-to-WhatsApp continua grátis',
        body: 'A janela de 72h aberta por anúncios CTWA mantém a entrega gratuita mesmo depois de outubro — inclusive para mensagens de atendimento. Levar 15% das suas conversas para essa origem economizaria ~' + brl(fepSave) + '/mês. Ajuste o campo "Conversas via anúncio" para simular.'
      });
    }
    if (totals.oct.totalBrl > 0) {
      tips.push({
        icon: '📅',
        title: 'Marque na agenda: 01/09/2026',
        body: 'A Meta publica até essa data as tarifas definitivas que valem a partir de 01/10/2026 (incluindo a tarifa final de serviço). Todos os valores desta calculadora são editáveis no painel de ajustes — refaça a simulação quando saírem. Sua projeção anual no cenário de outubro: ' + brl(totals.oct.totalBrl * 12) + '.'
      });
    }
    el.innerHTML = '';
    tips.slice(0, 4).forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'tip-card';
      d.innerHTML = '<div class="tip-icon">' + t.icon + '</div><div><h3>' + t.title + '</h3><p>' + t.body + '</p></div>';
      el.appendChild(d);
    });
    var wrap = $('#tipsSection');
    if (wrap) wrap.style.display = tips.length ? '' : 'none';
  }

  function renderFxNote() {
    var fxRateEl = $('#fxRate');
    var fxMetaEl = $('#fxMeta');
    if (fxRateEl) fxRateEl.textContent = brl(state.fx.rate, 4);
    if (fxMetaEl) {
      if (state.fx.manual) {
        fxMetaEl.innerHTML = '<span class="ok">Cotação manual</span> definida por você';
      } else if (state.fx.live) {
        fxMetaEl.innerHTML = '<span class="ok">● Cotação online</span> ' + state.fx.source + ' · ' + state.fx.when;
      } else {
        fxMetaEl.innerHTML = '<span class="err">Cotação de referência</span> (falha ao consultar online)';
      }
    }
    var star = $('#fxStarNote');
    if (star) {
      var src = state.fx.manual
        ? 'ajustada manualmente pelo usuário'
        : (state.fx.live
            ? 'obtida automaticamente em ' + state.fx.when + ' via <a href="https://docs.awesomeapi.com.br/api-de-moedas" target="_blank" rel="noopener">AwesomeAPI — API de Moedas</a> (economia.awesomeapi.com.br, cotação comercial USD/BRL)'
            : 'valor de referência estático (não foi possível consultar a cotação online neste acesso)');
      star.innerHTML = '<strong>* Cotação do dólar utilizada: ' + brl(state.fx.rate, 4) + '</strong> — ' + src + '.';
    }
  }

  // ---------- câmbio online ----------
  function nowStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fetchFx() {
    var input = $('#fxInput');
    return fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (j) {
        var bid = parseFloat(j && j.USDBRL && j.USDBRL.bid);
        if (!bid || !isFinite(bid)) throw new Error('parse');
        state.fx = { rate: bid, live: true, manual: false, when: nowStamp(), source: 'AwesomeAPI (USD/BRL comercial)' };
      })
      .catch(function () {
        return fetch('https://open.er-api.com/v6/latest/USD')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            var v = j && j.rates && j.rates.BRL;
            if (!v || !isFinite(v)) throw new Error('parse2');
            state.fx = { rate: v, live: true, manual: false, when: nowStamp(), source: 'open.er-api.com (USD/BRL)' };
          });
      })
      .catch(function () {
        state.fx.live = false; state.fx.manual = false;
      })
      .then(function () {
        if (input) input.value = state.fx.rate.toFixed(4).replace('.', ',');
        render();
      });
  }

  // ---------- bindings ----------
  function bindPct(id, prop) {
    var input = $(id);
    if (!input) return;
    input.addEventListener('input', function () {
      var v = Math.min(100, Math.max(0, parseFloat(String(input.value).replace(',', '.')) || 0));
      state[prop] = v;
      render();
    });
  }

  function bind() {
    // atalho: porte da operação (pública) ou restaurar médias reais (página de cliente)
    var quick = $('#quickFill');
    if (quick) {
      if (presetVolumes) {
        var rb = document.createElement('button');
        rb.type = 'button';
        rb.className = 'chip-btn restore';
        rb.innerHTML = '<strong>↺ Restaurar minhas médias reais</strong><span>volumes de abr–jun/2026</span>';
        rb.addEventListener('click', function () {
          Object.keys(presetVolumes).forEach(function (k) { state.volumes[k] = presetVolumes[k]; });
          syncVolumeInputs(); render();
        });
        quick.appendChild(rb);
      } else {
        Object.keys(PORTES).forEach(function (k) {
          var p = PORTES[k];
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip-btn';
          b.setAttribute('data-porte', k);
          b.innerHTML = '<strong>' + p.label + '</strong><span>' + p.hint + '</span>';
          b.addEventListener('click', function () {
            Object.keys(p.volumes).forEach(function (vk) { state.volumes[vk] = p.volumes[vk]; });
            $all('[data-porte]').forEach(function (x) { x.classList.toggle('active', x === b); });
            syncVolumeInputs(); render();
          });
          quick.appendChild(b);
        });
      }
    }

    // períodos
    $all('[data-period]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.period = btn.getAttribute('data-period');
        $all('[data-period]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        render();
      });
    });

    // volumes: slider + número
    CATS.forEach(function (c) {
      var row = $('[data-vol-row="' + c.key + '"]');
      if (!row) return;
      var range = row.querySelector('input[type=range]');
      var num = row.querySelector('input[type=number]');
      range.value = Math.min(state.volumes[c.key], +range.max);
      num.value = state.volumes[c.key];
      paintRange(range);
      range.addEventListener('input', function () {
        state.volumes[c.key] = +range.value;
        num.value = range.value;
        paintRange(range);
        render();
      });
      num.addEventListener('input', function () {
        var v = Math.max(0, Math.round(+num.value || 0));
        state.volumes[c.key] = v;
        range.value = Math.min(v, +range.max);
        paintRange(range);
        render();
      });
    });

    // complexidade do agente
    $all('[data-agent-cx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.agentComplexity = btn.getAttribute('data-agent-cx');
        $all('[data-agent-cx]').forEach(function (b) { b.classList.toggle('active', b === btn); });
        var hint = $('#agentTokenHint');
        if (hint) {
          var p = AGENT_PRESETS[state.agentComplexity];
          hint.textContent = p.label + ': ~' + fmtInt.format(p.tokens) + ' tokens por mensagem → ' +
            usd(agentRateUsd(), 3) + ' / msg (tarifa Meta de ' + usd(state.rates.agentPerM, 2) + ' por 1 milhão de tokens)';
        }
        render();
      });
    });

    // câmbio manual + refresh
    var fxInput = $('#fxInput');
    if (fxInput) {
      fxInput.addEventListener('input', function () {
        var v = parseFloat(String(fxInput.value).replace(',', '.'));
        if (v && isFinite(v) && v > 0) {
          state.fx.rate = v; state.fx.manual = true;
          render();
        }
      });
    }
    var fxRefresh = $('#fxRefresh');
    if (fxRefresh) {
      fxRefresh.addEventListener('click', function () {
        fxRefresh.textContent = 'Atualizando…';
        fetchFx().then(function () { fxRefresh.textContent = 'Atualizar cotação'; });
      });
    }

    // CTWA (janela 72h) e markup BSP
    bindPct('#ctwaInput', 'ctwaPct');
    bindPct('#bspInput', 'bspPct');

    // tarifas avançadas
    [['#rateMkt', 'marketing'], ['#rateUtil', 'utility'], ['#rateAuth', 'auth'], ['#rateSvc', 'service'], ['#rateAgent', 'agentPerM']].forEach(function (pair) {
      var input = $(pair[0]);
      if (!input) return;
      input.addEventListener('input', function () {
        var v = parseFloat(String(input.value).replace(',', '.'));
        if (v >= 0 && isFinite(v)) { state.rates[pair[1]] = v; render(); }
      });
    });

    // relatório PDF
    var printBtn = $('#printBtn');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    render();
    fetchFx();
    if (window.bitchatTrack) window.bitchatTrack('page_view', { page: 'calculadora_whatsapp' + (preset ? '_cliente' : '') });
  });
})();
