/* ==========================================================================
   SERVIDOR DO MOTOR — Sobras de Capa
   Recebe as planilhas do app, devolve os encaixes prontos.

   A regra de encaixe mora AQUI. Nunca é enviada ao navegador — por isso
   uma cópia do site não consegue calcular.

   Só responde a pedidos vindos dos endereços da lista ORIGENS_PERMITIDAS.
   Uma cópia aberta em file:///C:/... é recusada.
   ========================================================================== */

"use strict";

const http = require("http");
const { calcular } = require("./motor.js");
const { conferirCracha } = require("./cracha.js");

const PORTA = process.env.PORT || 3000;

// Endereços autorizados. O site oficial e o computador local para testes.
// ---------------------------------------------------------------------------
// QUAL VERSAO DO MOTOR ESTA NO AR
//
// Em 14/10/2026 nao deu para saber de fora se o motor publicado era o novo:
// o /calcular exige cracha e nenhuma resposta dizia a versao. Ficamos no
// "acho que subiu". Agora /acordar e /saude dizem, e a conferencia leva um
// segundo.
//
// SUBIR ESTE NUMERO a cada publicacao do motor, igual ao CACHE_NAME do sw.js.
// ---------------------------------------------------------------------------
const VERSAO_MOTOR = "m11-camada-a-menos";

const ORIGENS_PERMITIDAS = (
  process.env.ORIGENS ||
  "https://furlaneto1995.github.io,http://localhost:8000,http://127.0.0.1:8000"
).split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// EXIGIR O CRACHÁ DO APP CHECK
//
// "nao"  -> só observa e anota no log. O app funciona igual para todos.
// "sim"  -> quem não tiver crachá válido recebe 403.
//
// Começa em "nao" de propósito: primeiro a gente olha o log por alguns dias
// e confirma que TODOS os aparelhos estão mandando crachá válido. Só depois
// vira "sim". Para ligar, é só trocar a variável EXIGIR_CRACHA no Render
// para "sim" — não precisa mexer em código nem republicar.
// ---------------------------------------------------------------------------
const EXIGIR_CRACHA =
  String(process.env.EXIGIR_CRACHA || "nao").trim().toLowerCase() === "sim";

// Contagem simples do que passou por aqui, para o painel /saude.
const placar = { comCracha: 0, semCracha: 0, crachaRuim: 0, falhaGoogle: 0 };
const inicioServidor = Date.now();
let inicioContagem = Date.now();

// A planilha inteira pode ser grande; acima disso é abuso.
const TAMANHO_MAXIMO = 12 * 1024 * 1024; // 12 MB

// Trava simples de excesso de pedidos, por endereço de rede.
const LIMITE_POR_MINUTO = 30;
const contador = new Map();

function excedeuLimite(ip) {
  const agora = Date.now();
  const janela = 60 * 1000;
  const reg = contador.get(ip) || { inicio: agora, n: 0 };
  if (agora - reg.inicio > janela) { reg.inicio = agora; reg.n = 0; }
  reg.n++;
  contador.set(ip, reg);
  // limpeza para a memória não crescer sem parar
  if (contador.size > 5000) {
    for (const [k, v] of contador) if (agora - v.inicio > janela) contador.delete(k);
  }
  return reg.n > LIMITE_POR_MINUTO;
}

function origemPermitida(origem) {
  if (!origem) return false;
  // Comparação EXATA, de propósito.
  //
  // Antes usávamos origem.startsWith(o), e isso abria um buraco: um domínio
  // como "https://furlaneto1995.github.io.site-pirata.com" começa com o
  // endereço oficial e passava na trava. Qualquer pessoa poderia registrar
  // esse domínio e usar o motor de dentro do navegador.
  //
  // Comprovado em teste: com startsWith o motor devolvia HTTP 200 para
  // "furlaneto1995.github.io.site-pirata.com". Agora devolve 403.
  return ORIGENS_PERMITIDAS.indexOf(origem) > -1;
}

function responder(res, codigo, corpo, origem) {
  const texto = JSON.stringify(corpo);
  const cabecalhos = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texto),
    "Cache-Control": "no-store",
  };
  if (origem && origemPermitida(origem)) {
    cabecalhos["Access-Control-Allow-Origin"] = origem;
    cabecalhos["Vary"] = "Origin";
  }
  res.writeHead(codigo, cabecalhos);
  res.end(texto);
}

const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || "";
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
             req.socket.remoteAddress || "?";

  // O navegador pergunta antes se pode enviar (preflight)
  if (req.method === "OPTIONS") {
    if (!origemPermitida(origem)) { res.writeHead(403); res.end(); return; }
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origem,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      // Content-Type e o crachá do App Check. Sem listar o crachá aqui, o
      // navegador cancela o envio antes mesmo de sair ("failed to fetch").
      "Access-Control-Allow-Headers": "Content-Type, X-Firebase-AppCheck",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    });
    res.end();
    return;
  }

  // Toque de despertar: o app chama isto ao abrir, para o servidor já estar
  // acordado quando o operador for calcular.
  if (req.method === "GET" && (req.url === "/acordar" || req.url === "/")) {
    responder(res, 200, { pronto: true, hora: Date.now(), versao: VERSAO_MOTOR }, origem);
    return;
  }

  // Zera a contagem, para conferir só os pedidos de agora em diante.
  // Não mexe em nada do cálculo — é só o placar.
  if (req.method === "GET" && req.url === "/saude/zerar") {
    placar.comCracha = 0;
    placar.semCracha = 0;
    placar.crachaRuim = 0;
    placar.falhaGoogle = 0;
    inicioContagem = Date.now();
    responder(res, 200, { zerado: true, quando: new Date().toISOString() }, origem);
    return;
  }

  // Painel simples para acompanhar a adoção do crachá sem caçar log.
  if (req.method === "GET" && req.url === "/saude") {
    const total = placar.comCracha + placar.semCracha + placar.crachaRuim;
    responder(res, 200, {
      versao: VERSAO_MOTOR,
      exigindoCracha: EXIGIR_CRACHA,
      modo: EXIGIR_CRACHA ? "exigindo" : "observando",
      totalPedidos: total,
      comCrachaValido: placar.comCracha,
      semCracha: placar.semCracha,
      crachaInvalido: placar.crachaRuim,
      googleIndisponivel: placar.falhaGoogle,
      porcentagemComCracha: total ? Math.round((placar.comCracha / total) * 100) : null,
      desdeQuando: new Date(inicioContagem).toISOString(),
    }, origem);
    return;
  }

  if (req.method !== "POST" || req.url !== "/calcular") {
    responder(res, 404, { erro: "Endereço não encontrado" }, origem);
    return;
  }

  // A trava principal: pedido que não vem do site oficial é recusado.
  if (!origemPermitida(origem)) {
    responder(res, 403, {
      erro: "Este cálculo só funciona no site oficial.",
      detalhe: "Origem não autorizada.",
    }, origem);
    return;
  }

  if (excedeuLimite(ip)) {
    responder(res, 429, { erro: "Muitos pedidos seguidos. Aguarde um minuto." }, origem);
    return;
  }

  // ---- O crachá do App Check -------------------------------------------
  // Um programa fora do navegador consegue escrever o endereço do site
  // oficial no pedido, mas não consegue forjar a assinatura do Google.
  //
  // CUIDADO: conferir o crachá leva um instante (pode precisar falar com o
  // Google). Nesse intervalo o navegador já está mandando a planilha. Sem
  // ninguém escutando, o Node joga esses pedaços fora e a planilha chega
  // pela metade — uma falha intermitente e muito difícil de achar depois.
  // Por isso pausamos a leitura aqui e retomamos assim que a conferência
  // termina.
  req.pause();
  const cracha = req.headers["x-firebase-appcheck"] || "";
  let conferencia;
  try {
    conferencia = await conferirCracha(cracha);
  } catch (e) {
    conferencia = { valido: false, motivo: "erro inesperado", falhaGoogle: true };
  }
  req.resume();

  if (conferencia.valido) {
    placar.comCracha++;
  } else if (conferencia.falhaGoogle) {
    // O Google não respondeu. Não é culpa de quem está chamando — nunca
    // recusamos por isso, senão uma instabilidade do Google derrubaria o
    // chão de fábrica inteiro.
    placar.falhaGoogle++;
    console.warn("cracha: Google indisponivel, deixando passar —", conferencia.motivo);
  } else if (!cracha) {
    placar.semCracha++;
    console.log("cracha: pedido SEM cracha" + (EXIGIR_CRACHA ? " — RECUSADO" : " — deixando passar (modo observacao)"));
  } else {
    placar.crachaRuim++;
    console.log("cracha: cracha INVALIDO (" + conferencia.motivo + ")" + (EXIGIR_CRACHA ? " — RECUSADO" : " — deixando passar (modo observacao)"));
  }

  if (EXIGIR_CRACHA && !conferencia.valido && !conferencia.falhaGoogle) {
    responder(res, 403, {
      erro: "Este cálculo só funciona no site oficial.",
      detalhe: "Sem prova de autenticidade.",
    }, origem);
    return;
  }

  let bruto = "";
  let tamanho = 0;
  let abortado = false;

  req.on("data", (pedaco) => {
    if (abortado) return;
    tamanho += pedaco.length;
    if (tamanho > TAMANHO_MAXIMO) {
      abortado = true;
      responder(res, 413, { erro: "Planilhas grandes demais." }, origem);
      req.destroy();
      return;
    }
    bruto += pedaco;
  });

  req.on("end", () => {
    if (abortado) return;
    const inicio = Date.now();
    try {
      const entrada = JSON.parse(bruto);
      const saida = calcular(entrada);
      if (saida.erro) { responder(res, 400, saida, origem); return; }
      saida.ms = Date.now() - inicio;
      console.log(
        `calculo ok — ${saida.encaixes.length} encaixes, ` +
        `${saida.resumo.bobinas} bobinas, ${saida.ms}ms`
      );
      responder(res, 200, saida, origem);
    } catch (e) {
      console.error("falha no calculo:", e && e.message);
      responder(res, 500, { erro: "Não consegui calcular. Confira as planilhas." }, origem);
    }
  });

  req.on("error", () => {
    if (!abortado) responder(res, 400, { erro: "Envio interrompido" }, origem);
  });
});

servidor.listen(PORTA, () => {
  console.log("motor no ar na porta " + PORTA);
  console.log("origens permitidas: " + ORIGENS_PERMITIDAS.join(", "));
  console.log(
    "cracha do App Check: " +
      (EXIGIR_CRACHA
        ? "EXIGINDO — quem nao tiver cracha valido recebe 403"
        : "so observando — todos passam, o resultado sai no log")
  );
});
