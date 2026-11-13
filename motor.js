/* ==========================================================================
   MOTOR DE ENCAIXE — Sobras de Capa
   Este é o cérebro do aplicativo. Fica aqui no servidor, NUNCA no navegador.

   Quem copiar o site leva só a casca: as telas abrem, mas o botão Calcular
   não funciona, porque as regras de encaixe não vão junto.

   As funções abaixo saíram do app original SEM alteração de regra — só foi
   removido o que mexia na tela (toast, modal, console).
   ========================================================================== */

"use strict";

// O motor original lia estas variáveis globais; são preenchidas a cada pedido.
var estoque = [], fila = [], filaLaminacao = [], filaImpressao = [];
var toleranciaFilme = 10, toleranciaSaco = 0;
var ultimosProblemasImportacaoEstoque = [];

// No app cada bobina tem um identificador; aqui ele vem pronto do navegador.
function getUidEstoque(e) {
  return String((e && (e.__uid || e.UID || e.uid)) || "").trim();
}

// O catálogo de fórmulas foi removido do app; a composição já vem na linha.
function buscarFormulaDoItem() { return ""; }

function normalizarTexto(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extrairLargura(d) {
  try {
    var m = d
      .toLowerCase()
      .replace(/\s/g, "")
      .match(/\(([0-9.,]+)cm/);
    if (m) return parseFloat(m[1].replace(",", "."));
  } catch (e) {}
  return 0;
}

function extrairEspessura(d) {
  try {
    var m = d
      .toLowerCase()
      .replace(/\s/g, "")
      .match(/x([0-9.,]+)mu/);
    if (m) return parseFloat(m[1].replace(",", "."));
  } catch (e) {}
  return 0;
}


function temCapa(ic) {
  return /-2$/.test(String(ic || "").trim());
}

function isMetalizado(cod) {
  return /-4$/.test(String(cod || "").trim());
}

/* --------------------------------------------------------------------------
   BOBINA IMPRESSA / LAMINADA

   O processo tem tres saidas de sobra:
     extrusao  -> bobina LISA      (a impressao nao usou)   <- o de sempre
     impressao -> bobina IMPRESSA  (a laminacao nao usou)
     laminacao -> bobina LAMINADA  (a refiladeira nao usou)

   A lisa e generica: serve em qualquer OP que bata composicao, espessura,
   pigmento e largura. Por isso o motor procura por CARACTERISTICA.

   A impressa ja tem a arte do cliente; a laminada ja tem a estrutura
   montada. Nenhuma das duas serve em outro produto - so na mesma OP do
   mesmo item e da mesma versao. Por isso aqui a busca e por IDENTIDADE.

   Marca no Estoque de Capas (informada pelo usuario em 13/10/2026):
   MATERIAL, PIGMENTADO e CLIENTE vem VAZIAS. A lisa sempre traz as tres.
   -------------------------------------------------------------------------- */
// "-" na planilha e o mesmo que vazio: e assim que o relatorio escreve
// "nao se aplica". O motor ja tratava assim em outros lugares; o app nao.
function vazioOuTraco(v) {
  var t = String(v === undefined || v === null ? "" : v).trim();
  return t === "" || t === "-";
}


// Le a coluna pelo nome EXATO do cabecalho.
//
// A busca aproximada que o resto do motor usa NAO serve aqui: ela casa
// quando um nome contem o outro, entao "CLIENTE" acharia "COD CLIENTE" e a
// bobina deixaria de ser impressa - enquanto o app, que le exato, diria que
// e. As duas pontas tem de responder a mesma coisa sobre a mesma bobina.
// Nao e so do estoque: a fila tambem precisa, para FORMULA_PADRAO nao ser
// confundida com DESC_FORMULA_PADRAO pela busca aproximada.
function colunaExata(linha, nome) {

  if (!linha) return "";
  var cab = linha.c || linha.cabecalho || [];
  var val = linha.v || linha.valores || [];
  for (var i = 0; i < cab.length; i++) {
    if (String(cab[i]).toUpperCase().trim() === nome) {
      var t = String(val[i] === undefined || val[i] === null ? "" : val[i]).trim();
      return t === "-" ? "" : t;
    }
  }
  return "";
}


function eImpressaOuLaminada(e) {
  if (!e) return false;
  // Com a linha crua, le exato. Sem ela (testes antigos), usa o que tem.
  if (e.__crua) {
    return (
      colunaExata(e.__crua, "MATERIAL") === "" &&
      colunaExata(e.__crua, "PIGMENTADO") === "" &&
      colunaExata(e.__crua, "CLIENTE") === ""
    );
  }
  return (
    vazioOuTraco(e["MATERIAL"]) &&
    vazioOuTraco(e["PIGMENTADO"]) &&
    vazioOuTraco(e["CLIENTE"])
  );
}


// O MESMO item aparece escrito de tres jeitos:
//   estoque: 81169        fila: 181169, 181169-1 ou 181169-2
//
// A primeira versao disto arrancava o 1 dos DOIS lados. Parecia esperto e
// estava errado: item de estoque que JA comeca com 1 (128727) virava 28727
// e deixava de achar a OP 1128727. Agora so se tira o sufixo, e o 1 da
// frente vira uma POSSIBILIDADE a mais na comparacao.
// A fila de IMPRESSAO traz o produto igual ao do Estoque de Capas.
// Comparacao direta: so tira espaco e diferenca de maiuscula.
function chaveItemImpressao(v) {
  return String(v || "").trim().toUpperCase().replace(/\s+/g, "");
}


function baseItemImpressa(v) {
  return String(v || "").trim().toUpperCase().replace(/\s+/g, "").replace(/-\d+$/, "");
}


// As formas sob as quais o mesmo item pode estar escrito na fila.
function chavesItemImpressa(v) {
  var a = baseItemImpressa(v);
  if (!a) return [];
  var ks = [a, "1" + a];
  // Se ja comeca com 1, a fila pode ser a forma sem ele.
  if (a.charAt(0) === "1" && a.length > 1) ks.push(a.slice(1));
  return ks;
}


// A coluna H da fila traz a medida grudada: "70 - 18 X 33.5 X 85".
// A versao e o que vem antes do traco.
function chaveVersaoImpressa(v) {
  var t = String(v || "").trim().toUpperCase();
  if (t.indexOf(" - ") > -1) t = t.split(" - ")[0];
  t = t.replace(/\s*[0-9.,]+\s*X\s*[0-9.,]+\s*$/, "");
  t = t.trim().replace(/^V/, "").trim();
  return t;
}


// "01" e "1" sao a mesma versao; "05.0" e "5" NAO sao.
//
// O zero a esquerda so e ignorado quando os dois lados sao numero puro.
// Versao aceita letra e ponto (v1, v61, vT, 05.0), e nesses casos completar
// com zero mudaria a versao - por isso a comparacao solta vale so no caso
// em que nao ha o que confundir.
function versoesIguaisImpressa(a, b) {
  var x = chaveVersaoImpressa(a),
    y = chaveVersaoImpressa(b);
  if (x === y) return true;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    return parseInt(x, 10) === parseInt(y, 10);
  }
  return false;
}


function temFundo(descricao) {
  return /\bFUNDO\b/.test(normalizarTexto(descricao || ""));
}


function normalizarPigmentado(v) {
  var t = normalizarTexto(v);
  if (t === "S" || t === "SIM" || t === "PIGMENTADO") return "S";
  if (
    t === "N" ||
    t === "NAO" ||
    t === "NAO PIGMENTADO" ||
    t === "TRANSPARENTE"
  )
    return "N";
  if (t === "") return "";
  return t;
}


function normalizarProgramada(v) {
  var t = normalizarTexto(v);
  if (t === "S" || t === "SIM") return "S";
  if (t === "N" || t === "NAO") return "N";
  return t;
}

function normalizarSN(v) {
  var s = String(v === undefined || v === null ? "" : v).trim().toUpperCase();
  if (!s) return "";
  if (s === "S" || s === "SIM" || s === "1" || s === "TRUE" || s === "X") return "S";
  if (s === "N" || s === "NAO" || s === "NÃO" || s === "0" || s === "FALSE") return "N";
  // Qualquer outro texto: usa a primeira letra se for S ou N
  var c = s.charAt(0);
  if (c === "S") return "S";
  if (c === "N") return "N";
  return "";
}


function normalizarComposicao(v) {
  var t = normalizarTexto(v);
  if (!t) return "";
  var m = t.match(/^(\d+)/);
  return m ? m[1] : t.split("-")[0].trim();
}

function normalizarEstruturaLam(texto) {
  if (!texto) return "";
  var t = String(texto).toUpperCase().trim();
  t = t.replace(/^\d+[\s\-]*/, ""); // remove código numérico do início (ex: "521-")
  t = t.replace(/\s+/g, " ");
  // METALIZADO e METAL viram MET. A ordem importa: METALIZADO primeiro,
  // senão "METAL" casaria com o começo de "METALIZADO" e sobraria "IZADO".
  t = t.replace(/\bMETALIZADO\b/g, "MET");
  t = t.replace(/\bMETALIZADA\b/g, "MET");
  t = t.replace(/\bMETAL\b/g, "MET");
  // "PET MET" e "PET METALIZADO" viram uma coisa só: PETMET.
  t = t.replace(/PET\s*MET\b/g, "PETMET");
  t = t.replace(/BOPP\s*MET\b/g, "BOPPMET");
  return t.trim();
}


function extrairComponentesEstrutura(texto) {
  var normalizado = normalizarEstruturaLam(texto);
  if (!normalizado) return [];

  var partes = normalizado
    .split(/[\+\/]/)
    .map(function (p) {
      return p.trim().replace(/\s+/g, "");
    })
    .filter(function (p) {
      return p.length > 0;
    });

  // remove duplicados
  var unicas = [];
  for (var i = 0; i < partes.length; i++) {
    if (unicas.indexOf(partes[i]) === -1) unicas.push(partes[i]);
  }

  // Se existe PETMET, remove PET solto
  if (unicas.indexOf("PETMET") > -1) {
    unicas = unicas.filter(function (p) {
      return p !== "PET";
    });
  }

  // Se existir BOPPMET no futuro, remove BOPP solto
  if (unicas.indexOf("BOPPMET") > -1) {
    unicas = unicas.filter(function (p) {
      return p !== "BOPP";
    });
  }

  unicas.sort();
  return unicas;
}


// A SOBRA PODE TER MENOS CAMADAS QUE A OP.
//
// Confirmado pelo usuario em 27/07/2026. Uma sobra de
// "PET METAL + PE" serve numa OP que vai fazer
// "566-BOPP MATE + PET METAL + PE": a OP so acrescenta uma camada
// por cima do que a sobra ja tem.
//
// O que NAO pode e a sobra ter camada que a OP nao vai ter. Uma
// sobra de "PET + PP" nao serve numa OP de "511-BOPP + PP", porque
// o PET nao aparece na OP - seria material errado, nao camada a
// menos.
//
// Ate 27/07 a regra exigia o MESMO numero de camadas, e as duas
// situacoes acima eram recusadas juntas.
//
// extrairComponentesEstrutura devolve a lista ORDENADA e sem
// repetidos, entao a ordem das camadas nao entra na conta.
function estruturasCompativeis(materialEstoque, familiaFila) {
  if (!materialEstoque || !familiaFila) return false;

  var compEst = extrairComponentesEstrutura(materialEstoque);
  var compFila = extrairComponentesEstrutura(familiaFila);

  if (compEst.length === 0 || compFila.length === 0) return false;

  // Mais camadas na sobra do que na OP: nao tem como.
  if (compEst.length > compFila.length) return false;

  for (var i = 0; i < compEst.length; i++) {
    if (compFila.indexOf(compEst[i]) === -1) return false;
  }

  return true;
}

function limparVersao(v) {
  var s = String(v || "").trim();
  if (!s) return "";
  if (s.indexOf(" - ") > -1) s = s.split(" - ")[0];
  // Remove um eventual resto de medida colado (ex.: "71 44.9 X 90")
  s = s.replace(/\s*[0-9.,]+\s*[xX]\s*[0-9.,]+\s*$/, "");
  return s.trim();
}

// A OP de destino não pode ser versão LP. A bobina de sobra LP continua
// procurando encaixe normalmente — só não pode CAIR numa OP LP.
// A versão vem crua da planilha ("LP", "lp1", " LP-2 "), por isso comparamos
// sem espaços e sem diferenciar maiúscula de minúscula.
function versaoEhLP(v) {
  return /^LP/i.test(String(v == null ? "" : v).trim());
}

function limparPosicaoFila(v) {
  var s = String(v === undefined || v === null ? "" : v).trim();
  if (!s) return "";
  var m = s.match(/-?\d+(?:[.,]\d+)?/);
  return m ? m[0] : "";
}


function parseDataBR(v) {
  if (!v) return null;
  var t = String(v).trim();
  if (t.indexOf(" ") > -1) t = t.split(" ")[0];
  var p = t.split(/[\/\-]/);
  if (p.length === 3) {
    var d, m, a;
    // Aceita tanto DD/MM/AAAA quanto AAAA-MM-DD.
    if (String(p[0]).length === 4) {
      a = parseInt(p[0], 10);
      m = parseInt(p[1], 10) - 1;
      d = parseInt(p[2], 10);
    } else {
      d = parseInt(p[0], 10);
      m = parseInt(p[1], 10) - 1;
      a = parseInt(p[2], 10);
    }
    if (a < 100) a += 2000;
    var dt = new Date(a, m, d);
    if (
      !isNaN(dt.getTime()) &&
      dt.getFullYear() === a &&
      dt.getMonth() === m &&
      dt.getDate() === d
    )
      return dt;
  }
  var serial = parseFloat(v);
  if (!isNaN(serial) && serial > 30000) {
    var utc_days = Math.floor(serial - 25569);
    var dtExcel = new Date(utc_days * 86400 * 1000);
    return new Date(dtExcel.getUTCFullYear(), dtExcel.getUTCMonth(), dtExcel.getUTCDate());
  }
  var d2 = new Date(t);
  if (!isNaN(d2.getTime())) return d2;
  return null;
}


function diferencaDiasHoje(v) {
  var d = parseDataBR(v);
  if (!d) return 999999;
  var h = new Date();
  h.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.abs((d.getTime() - h.getTime()) / 86400000);
}

function calcPrioridade(s, p, f) {
  // 99 significa "não serve para encaixe".
  //
  // A regra de corte é a mesma para todo mundo, interrompida ou não:
  //   PROGRAMADA = S  ->  só vale se a posição na fila for 10 ou mais
  //   PROGRAMADA = N  ->  vale em qualquer posição
  //
  // OP programada que está quase entrando na máquina (fila abaixo de 10) não
  // dá tempo de receber sobra. Isso vale igual para a interrompida.
  var programadaCedoDemais = p === "S" && f < 10;
  if (programadaCedoDemais) return 99;

  var ps = p === "S",   // aqui já se sabe que a fila é 10 ou mais
    pn = p === "N";
  if (!ps && !pn) return 99;   // PROGRAMADA em branco ou inesperado

  // Passou no corte. Agora a ordem de preferência:
  //
  // A interrompida vem na frente de todas. Se já existe uma OP parada que
  // serve para esta bobina, é melhor mandar a bobina para lá do que abrir
  // mais uma e deixar duas paradas. Concentra em vez de espalhar.
  if (s === "interrompida") return 1;

  if (ps) return 2;
  return 4;
}

// Resume uma OP candidata no formato enxuto que o app precisa para o
// botão de trocar. Só o necessário para redesenhar o cartão — nada de
// regra de negócio vai junto.
function resumirAlternativa(o, saldoDisponivel) {
  return {
    op: String(o.op || ""),
    interrompida: !!o.interrompida,
    itemOP: o.itemFila || "",
    verOP: o.versao || "",
    largOP: String(o.largura || ""),
    apresentacao: o.apresentacao || "",
    posFila: o.posFila || "",
    recurso: o.recurso || "",
    flagFila: o.flagFila || "",
    largOPDestino: o.largJ || String(o.largura || ""),
    espOPDestino: o.espFila || String(o.espessura || ""),
    saldo: Math.round((saldoDisponivel || 0) * 100) / 100,
  };
}

// Monta a lista de OPs alternativas de uma bobina, já na ordem de
// preferência do motor e sem repetir a que foi escolhida.
// LIMITE_ALTERNATIVAS segura o tamanho da resposta: mais que isso
// ninguém fica clicando no chão de fábrica.
var LIMITE_ALTERNATIVAS = 8;

function montarAlternativas(candidatas, opEscolhida, mapaSaldo, pesoBobina) {
  var lista = [];
  var jaVistas = {};
  var escolhida = String(opEscolhida || "").trim();

  for (var i = 0; i < candidatas.length; i++) {
    if (lista.length >= LIMITE_ALTERNATIVAS) break;
    var c = candidatas[i];
    var nome = String(c.op || "").trim();
    if (!nome || nome === escolhida || jaVistas[nome]) continue;

    // Só entram as que aguentam a bobina inteira. O usuário pediu
    // "só as que passam em todas as regras" — OP sem saldo fica de fora.
    var disp = mapaSaldo[c.op] || 0;
    if (pesoBobina > disp) continue;

    jaVistas[nome] = true;
    lista.push(resumirAlternativa(c, disp));
  }

  return lista;
}

function ordenarCandidatas(a) {
  a.sort(function (x, y) {
    // 1) Interrompida sempre na frente. Concentrar as sobras numa OP que já
    //    está parada é melhor do que abrir mais uma e deixar duas paradas.
    if (x.prioridade !== y.prioridade) return x.prioridade - y.prioridade;

    // 2) Entre OPs do mesmo tipo, a mais próxima de zero na fila vem antes.
    //    Vale tanto para as interrompidas quanto para as em fila: a coluna A
    //    traz a posição das duas.
    if (x.filaNum !== y.filaNum) return posicaoParaOrdem(x.filaNum) - posicaoParaOrdem(y.filaNum);

    // 3) Critério de desempate: a de entrega mais próxima.
    return x.difData - y.difData;
  });
}


// A posição da fila, pronta para ordenar do menor para o maior.
//
// Quem não tem posição (célula vazia, traço) chega aqui como 0 — e 0 seria
// o primeiro lugar, na frente de quem está em 1º de verdade. Por isso quem
// não tem posição vai para o fim.
function posicaoParaOrdem(n) {
  var v = Number(n);
  if (!isFinite(v) || v <= 0) return Number.MAX_SAFE_INTEGER;
  return v;
}

function indiceParaLetraColuna(indice) {
  var n = Number(indice);
  if (isNaN(n) || n < 0) return "";
  var s = "";
  n = n + 1;
  while (n > 0) {
    var resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}


/* ==========================================================================
   LEITURA DA PLANILHA CRUA

   O app não mapeia mais nada: ele manda a planilha como veio do sistema,
   linha por linha, e quem descobre o que é cada coluna é este arquivo.

   Motivo: o mapeamento das colunas é conhecimento de quem conhece a
   fábrica — saber que a medida está escondida na coluna J, que a coluna AM
   traz o indicador S/N, que o produto da laminação vem antes do " - ".
   Enquanto isso morava no app, bastava abrir o arquivo para aprender.
   ========================================================================== */

// Posição de cada coluna que interessa, contando do zero.
// Só existe aqui dentro. O app não sabe destes números.
var COLUNA = {
  // ---- FILA DE EXTRUSÃO ----
  //
  // Estas cinco posições vêm da versão do app que funcionava há meses.
  // São as únicas colunas lidas por POSIÇÃO; todo o resto é procurado
  // pelo NOME do cabeçalho, que é como sempre funcionou.
  //
  // Regra aprendida da pior forma: não inventar posição de coluna. Já
  // custou três cálculos vazios num dia — inventei que a versão estava na
  // coluna M e a composição na P, quando as duas sempre foram lidas pelo
  // nome do cabeçalho.
  posicaoFila: 0,     // A  - FILA
  recurso: 2,         // C  - RECURSO
  produto: 8,         // I  - PRODUTO
  descricao: 9,       // J  - DESCRICAO, com as medidas "(58cm x 45mu)"
  indicadorSN: 38,    // AM - PROGRAMADA, o S/N do lado da fila

  // Quantidade produzida. Confirmada pelo usuário em 10/09/2026 na coluna
  // AN, cabeçalho "QNTD_PRODUZIDA". Mesmo assim é procurada pelo nome
  // primeiro — ver daLinhaPorNome.
  produzido: 39,      // AN - QNTD_PRODUZIDA

  // ---- FILA DE LAMINAÇÃO ----
  // Também da versão que funcionava.
  lamProduto: 10,     // K  - "185417-2 - BOBINA IMP"
  lamVersao: 11,      // L
  lamFamilia: 18,     // S  - a estrutura do material
};

// Nomes de cabeçalho aceitos para cada campo, quando a posição falha.
// Serve de rede de segurança: se um dia o sistema mudar a ordem das
// colunas, o motor ainda encontra pelo nome.
var NOMES = {
  op: ["OP_PRINCIPAL", "OP", "ORDEM"],
  produto: ["PRODUTO", "ITEM", "CODIGO", "CÓDIGO"],
  descricao: ["DESCRICAO", "DESCRIÇÃO"],
  versao: ["VERSAO", "VERSÃO"],
  composicao: ["COMPOSICAO", "COMPOSIÇÃO", "FORMULA", "FÓRMULA"],
  pigmentado: ["PIGMENTADO"],
  peso: ["PESO", "QTDE", "QUANTIDADE"],
  apresentacao: ["APRESENTACAO", "APRESENTAÇÃO"],
  situacao: ["SITUACAO", "SITUAÇÃO"],
  programada: ["PROGRAMADA"],
  posicaoFila: ["FILA", "POSICAO", "POSIÇÃO", "SEQ"],
  recurso: ["RECURSO", "REC", "MAQUINA", "MÁQUINA"],
  entrega: ["PREV ENTREGA", "PREV. ENTREGA", "ENTREGA"],
  familia: ["FAMILIA", "FAMÍLIA", "ESTRUTURA"],
  qtdeEstoque: ["QTDE_ESTOQUE", "QTDE ESTOQUE", "SALDO", "ESTOQUE"],
  material: ["MATERIAL"],
  cliente: ["CLIENTE"],
  // "QNTD_PRODUZIDA" é o nome que a informática entregou em 09/09/2026,
  // na coluna AN. Os outros ficam como rede de segurança.
  produzido: ["QNTD_PRODUZIDA", "QNTD PRODUZIDA",
              "QTDE PRODUZIDA", "QUANTIDADE PRODUZIDA", "QTD PRODUZIDA",
              "QTDE_PRODUZIDA", "QUANTIDADE_PRODUZIDA", "QTD_PRODUZIDA",
              "PRODUZIDO", "PRODUZIDA", "PESO PRODUZIDO", "PESO_PRODUZIDO",
              "REALIZADO", "QTDE REALIZADA", "QTD REALIZADA"],
};


// Uma linha crua chega como { cabecalho: [...], valores: [...] }.
// Esta função tira dela o valor de um campo, tentando nesta ordem:
//   1. a posição fixa da coluna
//   2. o nome do cabeçalho
// Igual à daLinha, mas procura PELO NOME primeiro e só depois pela posição.
//
// Usada na quantidade produzida, onde ler a coluna errada é grave: se
// pegasse a coluna da OP por engano, o motor entenderia que toda OP já
// produziu milhares de quilos e nenhuma bobina encaixaria em lugar nenhum.
// Com o nome na frente, um deslocamento de coluna não causa estrago.
function daLinhaPorNome(linha, posicao, nomes) {
  if (!linha) return "";

  var valores = linha.v || linha.valores || [];
  var cabecalho = linha.c || linha.cabecalho || [];

  // 1) pelo nome EXATO do cabeçalho
  var achou = buscarPorNome(cabecalho, valores, nomes, true);
  if (achou !== "") return achou;

  // 2) pelo nome aproximado — MAS só entre colunas que falem de
  //    PRODUÇÃO.
  //
  //    Em 27/07/2026 a OP 1108730 veio com a QNTD_PRODUZIDA vazia. A
  //    busca aproximada casou "QUANTIDADE PRODUZIDA" (um dos nomes
  //    alternativos desta função) com a coluna "QUANTIDADE", porque
  //    uma contém a outra, e devolveu 6000 — que é a quantidade da OP
  //    em metros, não o que já foi produzido.
  //
  //    O motor então calculava 728 kg de peso menos 6.000 kg já
  //    produzidos, dava a OP como cheia e nenhuma bobina podia cair
  //    nela. Silencioso: a OP sumia do cálculo sem aviso nenhum.
  //
  //    A proteção que já existia (nome com no mínimo 5 letras) não
  //    pega este caso — "QUANTIDADE" tem 10.
  var cabProducao = [];
  var valProducao = [];
  for (var ip = 0; ip < cabecalho.length; ip++) {
    var nomeCol = String(cabecalho[ip] || "").toUpperCase();
    if (nomeCol.indexOf("PRODUZ") > -1 || nomeCol.indexOf("REALIZ") > -1) {
      cabProducao.push(cabecalho[ip]);
      valProducao.push(valores[ip]);
    }
  }
  achou = buscarPorNome(cabProducao, valProducao, nomes, false);
  if (achou !== "") return achou;

  // 3) pela posição, só se o cabeçalho não trouxer nada — e só quando a
  //    linha tem o tamanho da planilha original.
  var valores2 = linha.v || linha.valores || [];
  if (valores2.length >= COLUNAS_FILA_ORIGINAL &&
      posicao !== undefined && posicao !== null && posicao >= 0) {
    var v = valores[posicao];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }

  return "";
}


// Quantas colunas a fila de extrusão tem de verdade. Serve para saber se
// a linha veio da planilha original ou de um resumo salvo.
var COLUNAS_FILA_ORIGINAL = 40;

function daLinha(linha, posicao, nomes) {
  if (!linha) return "";

  var valores = linha.v || linha.valores || [];
  var cabecalho = linha.c || linha.cabecalho || [];

  // A posição da coluna só vale se a linha realmente veio da planilha.
  //
  // Quando a fila é recarregada de um backup ou da nuvem, ela chega como
  // um resumo com 13 campos em vez das 46 colunas originais. Aí a posição
  // 22 não é mais a coluna W — é qualquer outra coisa. Já aconteceu: o
  // motor leu "filme" como código do produto e "aberta" como descrição,
  // não achou medida nenhuma e devolveu zero encaixes sem explicação.
  //
  // Com poucas colunas, confiamos só no nome do cabeçalho.
  var temPlanilhaCompleta = valores.length >= COLUNAS_FILA_ORIGINAL;

  // 1) pela posição — só com a planilha completa
  if (temPlanilhaCompleta &&
      posicao !== undefined && posicao !== null && posicao >= 0) {
    var v = valores[posicao];
    if (v !== undefined && v !== null && String(v).trim() !== "" &&
        String(v).trim() !== "-") {
      return String(v).trim();
    }
  }

  // 2) pelo nome exato do cabeçalho
  var achou = buscarPorNome(cabecalho, valores, nomes, true);
  if (achou !== "") return achou;

  // 3) pelo nome aproximado — o cabeçalho pode vir com acento, underline,
  //    espaço a mais ou abreviado ("SITUAÇÃO", "SITUACAO", "SIT.").
  //    Sem esta etapa, uma diferença boba de escrita fazia o campo vir
  //    vazio e o motor descartava a OP inteira em silêncio.
  return buscarPorNome(cabecalho, valores, nomes, false);
}


// Procura um valor pelo nome da coluna.
// Com exato = true compara letra por letra; com false ignora acento,
// pontuação e espaços, e aceita que um nome contenha o outro.
function buscarPorNome(cabecalho, valores, nomes, exato) {
  if (!nomes || !nomes.length || !cabecalho || !cabecalho.length) return "";

  for (var i = 0; i < nomes.length; i++) {
    var alvo = exato
      ? String(nomes[i]).toUpperCase().trim()
      : simplificarNome(nomes[i]);
    if (!alvo) continue;

    for (var j = 0; j < cabecalho.length; j++) {
      var atual = exato
        ? String(cabecalho[j]).toUpperCase().trim()
        : simplificarNome(cabecalho[j]);
      if (!atual) continue;

      // Na busca aproximada, só aceita quando um nome CONTÉM o outro por
      // inteiro — e nunca quando o menor tem menos de 5 letras.
      //
      // Sem esse cuidado, "PESO PRODUZIDO" (um dos nomes alternativos da
      // quantidade produzida) casava com a coluna "PESO". O motor lia o
      // peso da OP como quantidade já produzida, concluía que estava
      // cheia, e nenhuma bobina encaixava em lugar nenhum.
      var bate;
      if (exato) {
        bate = atual === alvo;
      } else if (atual === alvo) {
        bate = true;
      } else {
        var menor = atual.length < alvo.length ? atual : alvo;
        var maior = atual.length < alvo.length ? alvo : atual;
        bate = menor.length >= 5 && maior.indexOf(menor) > -1;
      }

      if (bate) {
        var val = valores[j];
        if (val !== undefined && val !== null &&
            String(val).trim() !== "" && String(val).trim() !== "-") {
          return String(val).trim();
        }
      }
    }
  }
  return "";
}


// Tira acento, espaço, ponto e underline. "PREV. ENTREGA" vira "PREVENTREGA".
function simplificarNome(t) {
  return String(t === undefined || t === null ? "" : t)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "");
}


// Converte uma linha crua da FILA DE EXTRUSÃO no formato que o motor usa.
function lerLinhaFila(linha) {
  return {
    // A OP volta a ser lida como na versão que funcionava: pelo nome, com
    // OP_PRINCIPAL na frente de OP. Não mexer nisto.
    OP: daLinha(linha, null, NOMES.op),
    OP_PRINCIPAL: daLinha(linha, null, NOMES.op),

    // A OP da ETAPA - a coluna B.
    //
    // As duas de cima entregam a OP_PRINCIPAL (coluna E), que e a que o
    // card mostra. A coluna B e outra numeracao, a da etapa, e o usuario
    // pediu em 04/11/2026 para ela aparecer entre parenteses do lado.
    //
    // Lida pelo nome EXATO: a busca aproximada casaria "OP" dentro de
    // "OP_PRINCIPAL" e devolveria o mesmo numero das duas de cima.
    OP_ETAPA: colunaExata(linha, "OP"),

    // Estas cinco saem da posição da coluna, como sempre saíram.
    PRODUTO: daLinha(linha, COLUNA.produto, NOMES.produto),
    DESCRICAO: daLinha(linha, COLUNA.descricao, NOMES.descricao),
    FILA: daLinha(linha, COLUNA.posicaoFila, NOMES.posicaoFila),
    RECURSO: daLinha(linha, COLUNA.recurso, NOMES.recurso),
    INDICADOR: daLinha(linha, COLUNA.indicadorSN, NOMES.programada),

    // Todo o resto pelo nome do cabeçalho.
    VERSAO: daLinha(linha, null, NOMES.versao),
    COMPOSICAO: daLinha(linha, null, NOMES.composicao),
    PIGMENTADO: daLinha(linha, null, NOMES.pigmentado),
    MATERIAL: daLinha(linha, null, NOMES.material),
    PESO: daLinha(linha, null, NOMES.peso),
    APRESENTACAO: daLinha(linha, null, NOMES.apresentacao),
    SITUACAO: daLinha(linha, null, NOMES.situacao),
    PROGRAMADA: daLinha(linha, null, NOMES.programada),
    "PREV ENTREGA": daLinha(linha, null, NOMES.entrega),

    PRODUZIDO: daLinhaPorNome(linha, COLUNA.produzido, NOMES.produzido),

    // ----------------------------------------------------------------
    //   A FORMULA PADRAO DA OP
    //
    //   Descoberto em 15/10/2026 com a planilha real: a COMPOSICAO da
    //   sobra de capa corresponde ao FORMULA_PADRAO da OP, e nao a
    //   COMPOSICAO da OP. Em 93% das linhas as duas colunas dizem a
    //   mesma coisa - por isso passou meses sem aparecer. Nos outros 7%
    //   elas DIFEREM, e ali a bobina sumia sem encaixe e sem aviso.
    //
    //   Caso que trouxe o problema: bobina 1612035-2 v1, 250kg. A OP
    //   1100446 era do MESMO item, mesma versao, largura e espessura
    //   exatas - e nao encaixava porque a COMPOSICAO da OP era
    //   10001003-7C-1 enquanto a da bobina era 1000665, que e o
    //   FORMULA_PADRAO daquela OP. O texto da formula era identico nos
    //   dois lados.
    //
    //   Lido pelo nome EXATO: a busca aproximada casaria com
    //   DESC_FORMULA_PADRAO e devolveria o texto no lugar do numero.
    // ----------------------------------------------------------------
    FORMULA_PADRAO: colunaExata(linha, "FORMULA_PADRAO"),

    // A descrição entra também aqui porque é dela que saem as medidas.
    TEXTO_J: daLinha(linha, COLUNA.descricao, NOMES.descricao),

  };
}


/* ------------------------------------------------------------------------
   FILA DE IMPRESSAO

   Planilha separada, com cabecalho proprio (43 colunas, separador ";").
   E nela que as bobinas JA PRODUZIDAS (impressas/laminadas) procuram OP
   desde 16/10/2026 - antes procuravam na fila de extrusao, que e o lugar
   errado: elas ja sairam da extrusao.

   Diferente da extrusao, aqui o PRODUTO e o MESMO TEXTO do Estoque de
   Capas: nao tira o "1" da frente nem o sufixo "-N". Confirmado pelo
   usuario.

   Lida pelo NOME do cabecalho, nunca por posicao.
   ------------------------------------------------------------------------ */
function lerLinhaImpressao(linha) {
  return {
    OP: daLinha(linha, null, NOMES.op),
    PRODUTO: daLinha(linha, null, NOMES.produto),
    VERSAO: daLinha(linha, null, NOMES.versao),
    FILA: daLinha(linha, null, NOMES.posicaoFila),
    RECURSO: daLinha(linha, null, NOMES.recurso),
    APRESENTACAO: daLinha(linha, null, NOMES.apresentacao),
    DESCRICAO: daLinha(linha, null, ["DESC_PRODUTO", "DESCRICAO", "DESCRIÇÃO"]),
  };
}


// Converte uma linha crua da FILA DE LAMINAÇÃO.
function lerLinhaLaminacao(linha) {
  return {
    OP: daLinha(linha, null, NOMES.op),
    PRODUTO: daLinha(linha, COLUNA.lamProduto, NOMES.produto),
    VERSAO: daLinha(linha, COLUNA.lamVersao, NOMES.versao),
    FAMILIA: daLinha(linha, COLUNA.lamFamilia, NOMES.familia),
    PESO: daLinha(linha, null, NOMES.peso),
    "PREV ENTREGA": daLinha(linha, null, NOMES.entrega),
    PRODUZIDO: daLinhaPorNome(linha, COLUNA.produzido, NOMES.produzido),
    // A linha crua pega carona para a tela conseguir achar a posição na
    // fila (coluna A) e o recurso (coluna C) mais adiante.
    //
    // Não entra em nenhuma comparação de encaixe: é só para exibição.
    __crua: linha,
  };
}


// Converte uma linha crua do ESTOQUE.
function lerLinhaEstoque(linha) {
  return {
    ITEM: daLinha(linha, 0, NOMES.produto),
    VERSAO: daLinha(linha, null, NOMES.versao),
    DESCRICAO: daLinha(linha, null, NOMES.descricao),
    COMPOSICAO: daLinha(linha, null, NOMES.composicao),
    PIGMENTADO: daLinha(linha, null, NOMES.pigmentado),
    QTDE_ESTOQUE: daLinha(linha, null, NOMES.qtdeEstoque),
    MATERIAL: daLinha(linha, null, NOMES.material),
    // Usado só para reconhecer impressa/laminada: nelas as três vêm vazias.
    CLIENTE: daLinha(linha, null, NOMES.cliente),
    // A linha crua vai junto para a regra da impressa poder ler as três
    // colunas pelo nome EXATO, igual ao app.
    __crua: linha,
    __uid: linha && (linha.uid || linha.__uid) ? String(linha.uid || linha.__uid) : "",
  };
}


// Recebe a planilha crua e devolve as linhas prontas.
// Se vier no formato antigo (objeto por linha), passa direto — assim uma
// versão velha do app continua funcionando durante a transição.
function prepararPlanilha(linhas, leitor) {
  if (!Array.isArray(linhas)) return [];
  var saida = [];
  for (var i = 0; i < linhas.length; i++) {
    var l = linhas[i];
    if (!l) continue;
    // formato novo: { c: [cabeçalho], v: [valores] }
    if (l.v || l.valores) {
      saida.push(leitor(l));
    } else {
      saida.push(l);  // formato antigo
    }
  }
  return saida;
}


function getColunaFila(linha, indice, nomes) {
  if (!linha) return "";

  // 1) posicional já normalizado (aceita colunas de 2 letras: AM = 38)
  var letra = "__" + indiceParaLetraColuna(indice);
  if (linha[letra] !== undefined && String(linha[letra]).trim() !== "") {
    return String(linha[letra]).trim();
  }

  // 2) por nome de cabeçalho
  for (var i = 0; i < nomes.length; i++) {
    var v = linha[nomes[i]];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }

  // 3) pela ordem das colunas (ignora as chaves internas __X)
  var chaves = [];
  for (var k in linha) {
    if (Object.prototype.hasOwnProperty.call(linha, k) && k.indexOf("__") !== 0) {
      chaves.push(k);
    }
  }
  if (chaves.length > indice) {
    var val = linha[chaves[indice]];
    if (val !== undefined) return String(val).trim();
  }
  return "";
}

function getTextoColunaJ(linha) {
  if (linha && linha["TEXTO_J"]) return String(linha["TEXTO_J"]).trim();
  if (!linha) return "";
  var txt = getColunaFila(linha, 9, ["DESCRICAO", "DESCRIÇÃO", "PRODUTO"]);
  // Se a coluna J não tiver as medidas, tenta a descrição da linha
  if (txt && /\(\s*[0-9.,]+\s*cm/i.test(txt)) return txt;
  var alt = String(linha["DESCRICAO"] || linha["DESCRIÇÃO"] || "");
  if (alt && /\(\s*[0-9.,]+\s*cm/i.test(alt)) return alt;
  return txt || alt;
}


function extrairLarguraColunaJ(linha) {
  return extrairLargura(getTextoColunaJ(linha));
}


function extrairEspessuraColunaJ(linha) {
  return extrairEspessura(getTextoColunaJ(linha));
}


function getItemFila(f) {
  return String(f["PRODUTO"] || f["ITEM"] || "").trim();
}


function getItemEstoque(e) {
  return String(
    e["ITEM"] || e["CODIGO"] || e["CÓDIGO"] || "",
  ).trim();
}


// Quanto a OP já produziu.
//
// A planilha de hoje não traz isso: o peso da OP interrompida continua o
// original mesmo depois de a bobina ser encaixada. O usuário vai pedir à
// informática uma coluna com a quantidade produzida.
//
// Esta função aceita vários nomes possíveis para a coluna, para funcionar
// no dia em que ela aparecer sem precisar de ajuste. Enquanto não existir,
// devolve 0 e nada muda.
// Quanto a OP já produziu.
//
// A linha pode chegar de duas formas:
//   - do leitor da planilha crua, que já preencheu o campo PRODUZIDO
//   - como objeto pronto, quando o app é de uma versão anterior
// Por isso procura nos dois lugares.
function getProduzidoFila(f) {
  if (!f) return 0;

  // 1) o campo que o leitor da planilha crua preenche
  if (f["PRODUZIDO"] !== undefined && String(f["PRODUZIDO"]).trim() !== "") {
    return numeroProduzido(f["PRODUZIDO"]);
  }

  // 2) direto pelo nome do cabeçalho (linha em formato de objeto)
  for (var i = 0; i < NOMES.produzido.length; i++) {
    var v = f[NOMES.produzido[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return numeroProduzido(v);
    }
  }

  return 0;
}


// Converte o texto da célula em número de quilos.
// Aceita "4800", "4.800,50", "4,800.50", "4800 kg" e devolve 0 para
// qualquer coisa que não seja um peso válido.
function numeroProduzido(bruto) {
  if (bruto === undefined || bruto === null) return 0;
  var s = String(bruto).trim();
  if (!s || s === "-") return 0;

  // Tira tudo que não é dígito, vírgula, ponto ou sinal.
  s = s.replace(/[^0-9,.\-]/g, "");
  if (!s) return 0;

  var temVirgula = s.indexOf(",") > -1;
  var temPonto = s.indexOf(".") > -1;

  if (temVirgula && temPonto) {
    // O último separador que aparece é o decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");   // 4.800,50
    } else {
      s = s.replace(/,/g, "");                      // 4,800.50
    }
  } else if (temVirgula) {
    var depois = s.length - s.lastIndexOf(",") - 1;
    // "4,800" com 3 casas é separador de milhar; "4,8" é decimal.
    s = depois === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  }

  var n = parseFloat(s);
  if (isNaN(n) || n < 0) return 0;
  return n;
}


/* ------------------------------------------------------------------------
   AS DUAS FORMULAS DA OP

   Confirmado pelo laboratorio em 16/10/2026:

     coluna X - FORMULA_PADRAO -> a formula ORIGINAL. E ela que descreve o
                                  que a maquina vai extrudar naquela OP.
     coluna O - COMPOSICAO     -> uma formula EQUIVALENTE.

   Nas 1.427 OPs da planilha real, 575 tem as duas colunas iguais e 758
   mudam so o sufixo. Sobram 94 em que elas discordam de verdade - e so
   nessas a escolha muda alguma coisa.

   Historico: ate 15/10/2026 o motor comparava com a coluna O, a
   EQUIVALENTE. Por isso o encaixe que o usuario achava a mao nao
   aparecia no app. Em 15/10 passou a aceitar as duas sem distinguir.
   Agora procura primeiro pela ORIGINAL; a equivalente e a segunda
   tentativa e o encaixe sai marcado para quem le a tela saber.
   ------------------------------------------------------------------------ */

function listaComposicoes(fontes) {
  var lista = [];
  for (var i = 0; i < fontes.length; i++) {
    var c = normalizarComposicao(fontes[i] || "");
    if (c && lista.indexOf(c) === -1) lista.push(c);
  }
  return lista;
}

// A formula ORIGINAL: coluna X.
//
// Planilha sem a coluna X (export antigo) volta a valer como antes, e
// nada e marcado como equivalente - melhor o comportamento velho do que
// uma tela cheia de aviso errado.
function getComposicoesOriginais(f) {
  var orig = listaComposicoes([f["FORMULA_PADRAO"]]);
  if (orig.length) return orig;
  return getComposicoesFila(f);
}

// A formula EQUIVALENTE: coluna O e as redes de seguranca de nome.
// Vazia quando a OP nao tem coluna X, para nao marcar o que nao e.
function getComposicoesEquivalentes(f) {
  if (!listaComposicoes([f["FORMULA_PADRAO"]]).length) return [];
  var orig = getComposicoesOriginais(f);
  var todas = listaComposicoes([
    f["COMPOSICAO"],
    f["FORMULA"],
    f["FÓRMULA"],
    f["TEXTO_J"],
    f["DESCRICAO"],
  ]);
  var lista = [];
  for (var i = 0; i < todas.length; i++) {
    if (orig.indexOf(todas[i]) === -1) lista.push(todas[i]);
  }
  return lista;
}

// A uniao das duas. Serve so para o corte "OP sem composicao nenhuma".
function getComposicoesFila(f) {
  var fontes = [
    f["COMPOSICAO"],
    f["FORMULA_PADRAO"],
    f["FORMULA"],
    f["FÓRMULA"],
    f["TEXTO_J"],
    f["DESCRICAO"],
  ];
  return listaComposicoes(fontes);
}

function parseTabela(dados) {
  if (dados.length < 2) return [];
  var cab = dados[0].map(function (c) {
      return String(c).toUpperCase().trim();
    }),
    r = [];
  for (var i = 1; i < dados.length; i++) {
    var row = dados[i];
    if (!row || row.length === 0) continue;
    var obj = {};
    for (var j = 0; j < cab.length; j++)
      obj[cab[j]] = row[j] !== undefined ? String(row[j]).trim() : "";
    obj.__A = row[0] !== undefined ? String(row[0]).trim() : "";
    obj.__C = row[2] !== undefined ? String(row[2]).trim() : "";
    obj.__I = row[8] !== undefined ? String(row[8]).trim() : "";
    obj.__J = row[9] !== undefined ? String(row[9]).trim() : "";
    obj.__M = row[12] !== undefined ? String(row[12]).trim() : "";
    obj.__P = row[15] !== undefined ? String(row[15]).trim() : "";
    obj.__AM = row[38] !== undefined ? String(row[38]).trim() : "";
    r.push(obj);
  }
  return r;
}

function parseCSV(txt) {
  var ls = txt.split("\n").filter(function (l) {
    return l.trim() !== "";
  });
  var dados = ls.map(function (l) {
    var s = l.indexOf(";") > -1 ? ";" : "\t";
    if (s === "\t" && l.indexOf("\t") === -1) s = ",";
    return l.split(s).map(function (c) {
      return c.trim().replace(/^"|"$/g, "");
    });
  });
  return parseTabela(dados);
}

function extrairProdutoK(textoK) {
  if (!textoK) return "";
  var partes = String(textoK).split(" - ");
  return (partes[0] || "").trim().toUpperCase();
}


function extrairVersaoL(textoL) {
  if (!textoL) return "";
  var partes = String(textoL).split(" - ");
  return (partes[0] || "").trim();
}

function validarEstoqueImportado() {
  var problemas = [];
  for (var i = 0; i < estoque.length; i++) {
    var e = estoque[i],
      item = getItemEstoque(e),
      versao = String(e["VERSAO"] || "").trim();
    var desc = e["DESCRICAO"] || "",
      isMetal = /-4$/.test(item);
    var larg = extrairLargura(desc),
      esp = extrairEspessura(desc);
    var comp = normalizarComposicao(e["COMPOSICAO"] || ""),
      pig = normalizarPigmentado(e["PIGMENTADO"] || "");
    var qtde = parseFloat(e["QTDE_ESTOQUE"]) || 0,
      faltando = [];
    // A impressa/laminada NAO tem composicao, pigmento nem material: e
    // justamente isso que a identifica. Cobrar esses campos dela enchia o
    // relatorio de aviso falso.
    var ehImp = eImpressaOuLaminada(e);
    if (!item) faltando.push("Item");
    if (!desc) faltando.push("Descrição");
    if (!comp && !isMetal && !ehImp) faltando.push("Composição");
    if (larg === 0) faltando.push("Largura");
    if (esp === 0) faltando.push("Espessura");
    if (qtde === 0) faltando.push("Qtde");
    if (!pig && !/-4$/.test(item) && !ehImp) faltando.push("Pigmentado");
    if (faltando.length > 0)
      problemas.push({
        linha: i + 2,
        item: item || "(vazio)",
        versao: versao || "-",
        descricao: desc,
        motivo: faltando.join(", "),
      });
  }
  ultimosProblemasImportacaoEstoque = problemas;
  return problemas;
}

function executarCalculo() {

// Guardas herdadas do app. A segunda saía sem devolver nada quando só havia
// fila de laminação (bobina metalizada), e isso quebrava o servidor.
// Agora devolve o formato esperado em vez de "undefined".
var VAZIO = { res: [], problemas: [], problemasImportacao: [] };
if (estoque.length === 0) return VAZIO;
// A fila de IMPRESSAO sozinha ja da trabalho: e nela que as bobinas
// ja produzidas procuram OP.
if (fila.length === 0 && filaLaminacao.length === 0 && filaImpressao.length === 0)
  return VAZIO;

var problemasImportacao = validarEstoqueImportado();
var problemas = [],
  est = [];

// As impressas e laminadas saem da fila normal de validacao: elas nao tem
// composicao nem pigmento, e as regras das lisas as jogariam fora antes de
// chegar ao encaixe.
var impressas = [];

for (var i = 0; i < estoque.length; i++) {
  var e = estoque[i],
    ic = getItemEstoque(e);
  var desc = e["DESCRICAO"] || "",
    larg = extrairLargura(desc),
    esp = extrairEspessura(desc);

  if (eImpressaOuLaminada(e)) {
    var qtdeImp = parseFloat(e["QTDE_ESTOQUE"]) || 0;
    if (ic && qtdeImp > 0) {
      impressas.push({
        item: ic,
        versao: String(e["VERSAO"] || "").trim(),
        descricao: desc,
        largura: larg,
        espessura: esp,
        qtde: qtdeImp,
        uid: getUidEstoque(e),
      });
    }
    continue;
  }

  var comp = normalizarComposicao(e["COMPOSICAO"] || ""),
    pig = normalizarPigmentado(e["PIGMENTADO"] || "");
  var qtde = parseFloat(e["QTDE_ESTOQUE"]) || 0;
  var isMetalItem = /-4$/.test(ic);

  var m = [];
  if (!isMetalItem && !comp) m.push("Composição");
  if (larg === 0) m.push("Largura");
  if (esp === 0) m.push("Espessura");
  if (qtde === 0) m.push("Qtde");

  if (m.length > 0) {
    problemas.push({
      item: ic,
      versao: e["VERSAO"] || "?",
      desc: desc,
      motivo: m.join(", "),
      tipo: "ERRO",
    });
    continue;
  }

  if (!pig && !isMetalItem) {
    var jaReportado = false;
    for (
      var pi = 0;
      pi < ultimosProblemasImportacaoEstoque.length;
      pi++
    ) {
      if (ultimosProblemasImportacaoEstoque[pi].item === ic) {
        jaReportado = true;
        break;
      }
    }
    if (!jaReportado)
      problemas.push({
        item: ic,
        versao: e["VERSAO"] || "?",
        desc: desc,
        motivo: "Pigmentado vazio",
        tipo: "AVISO",
      });
  }
  est.push({
    item: ic,
    versao: e["VERSAO"] || "",
    descricao: desc,
    largura: larg,
    espessura: esp,
    composicao: comp,
    pigmentado: pig,
    qtde: qtde,
    uid: getUidEstoque(e),
    material: normalizarTexto(e["MATERIAL"] || ""),
    isCapa: temCapa(ic),
    isMetal: isMetalItem,
    isFundo: temFundo(desc),
    chaveExata: larg + "|" + esp + "|" + comp + "|" + pig,
    chaveSemLarg: esp + "|" + comp + "|" + pig,
  });
}

var fp = [];

// Descobre todas as OPs interrompidas em qualquer lugar da planilha
var opsInterrompidas = {};
for (var x = 0; x < fila.length; x++) {
  var statusTxt = String(fila[x]["SITUACAO"] || "")
    .trim()
    .toLowerCase();
  var opId = String(
    fila[x]["OP_PRINCIPAL"] || fila[x]["OP"] || "",
  ).trim();
  if (statusTxt.indexOf("interromp") === 0 && opId) {
    opsInterrompidas[opId] = true;
  }
}

// Loop único e correto para montar fp
for (var j = 0; j < fila.length; j++) {
  var f = fila[j],
    if2 = getItemFila(f),
    df = f["DESCRICAO"] || "";
  var lf = extrairLargura(df),
    ef = extrairEspessura(df),
    compsFila = getComposicoesFila(f),
    origsFila = getComposicoesOriginais(f),
    equivsFila = getComposicoesEquivalentes(f),
    pf = normalizarPigmentado(f["PIGMENTADO"] || "");

  var wf = parseFloat(f["PESO"]) || 0,
    ap = String(f["APRESENTACAO"] || "")
      .trim()
      .toLowerCase();

  var si = normalizarTexto(f["SITUACAO"] || "").toLowerCase(),
    pr = normalizarProgramada(f["PROGRAMADA"] || "");

  var fn = parseFloat(f["FILA"]) || 0,
    pe = f["PREV ENTREGA"] || "",
    op = f["OP_PRINCIPAL"] || f["OP"] || "";

  // Coluna A = posição na fila | Coluna C = recurso | Coluna AM = S/N
  var posFilaA = limparPosicaoFila(
    f["FILA"]
  );
  var recursoC = String(f["RECURSO"] || "").trim();
  var flagAM = normalizarSN(f["INDICADOR"]);

  // OPs interrompidas AGORA ENTRAM na lista de candidatas.
  // Quem decide a ordem é calcPrioridade, que coloca a interrompida na
  // frente. Antes elas eram descartadas aqui mesmo.
  var estaInterrompida = !!opsInterrompidas[String(op).trim()];

  // Bloqueia OP de versão LP: nenhuma bobina deve ser encaixada nela
  if (versaoEhLP(limparVersao(f["VERSAO"]))) continue;

  if (compsFila.length === 0 || !pf || lf === 0 || ef === 0 || wf === 0)
    continue;

  var tol;
  if (ap === "saco" || ap === "saco picotado" || ap === "folha") {
    tol = toleranciaSaco >= 0 ? toleranciaSaco : 0;
  } else if (ap === "filme" || ap === "filme picotado") {
    tol = toleranciaFilme >= 0 ? toleranciaFilme : 0;
  } else {
    tol = 0;
  }

  fp.push({
    op: op,
    itemFila: if2,
    descricao: df,
    largura: lf,
    espessura: ef,
    composicoes: compsFila,
    pigmentado: pf,
    peso: wf,
    apresentacao: ap,
    tolerancia: tol,
    largMaxAceita: lf + tol,
    prioridade: calcPrioridade(si, pr, fn),
    difData: diferencaDiasHoje(pe),
    filaNum: fn,
    programada: pr,
    situacao: si,
    isCapa: temCapa(if2),
    opEtapa: String(f["OP_ETAPA"] || "").trim(),
    // Chaves da formula ORIGINAL (coluna X) - as que valem primeiro.
    chavesExatas: origsFila.map(function (c) {
      return lf + "|" + ef + "|" + c + "|" + pf;
    }),
    chavesSemLarg: origsFila.map(function (c) {
      return ef + "|" + c + "|" + pf;
    }),
    // Chaves da formula EQUIVALENTE (coluna O) - segunda tentativa.
    chavesExatasEquiv: equivsFila.map(function (c) {
      return lf + "|" + ef + "|" + c + "|" + pf;
    }),
    chavesSemLargEquiv: equivsFila.map(function (c) {
      return ef + "|" + c + "|" + pf;
    }),
    versao: limparVersao(f["VERSAO"]),
    interrompida: estaInterrompida,
    // Quanto a OP já produziu. A planilha de hoje não traz essa informação
    // (o peso da OP interrompida continua o original mesmo depois de
    // receber bobina). Quando a informática incluir a coluna, o cálculo
    // passa a descontar sozinho — nada mais precisa mudar aqui.
    produzido: getProduzidoFila(f),
    posFila: posFilaA,
    recurso: recursoC,
    flagFila: flagAM,
    // Largura E espessura saem da coluna J, que traz a descrição
    // no formato "(93cm x 78mu) BOBINA EMB IMP ...".
    largJ: String(extrairLarguraColunaJ(f) || ""),
    espFila: String(extrairEspessuraColunaJ(f) || ""),
  });
}

var saldo = {};
for (var s = 0; s < fp.length; s++) {
  if (saldo[fp[s].op] === undefined) {
    // O que ainda cabe na OP = peso planejado menos o que já produziu.
    //
    // Para OP interrompida isto é essencial: sem descontar, a OP pareceria
    // vazia a cada importação e receberia bobina sem parar. Enquanto a
    // planilha não trouxer a coluna de produzido, "produzido" vale 0 e a
    // conta fica igual à de antes.
    var resta = fp[s].peso - (fp[s].produzido || 0);
    saldo[fp[s].op] = resta > 0 ? resta : 0;
  }
}
var fpLam = [];

if (filaLaminacao.length > 0) {
}

for (var jl = 0; jl < filaLaminacao.length; jl++) {
  var fl = filaLaminacao[jl];

  var textoK = fl["PRODUTO"] || "";
  var textoL = fl["VERSÃO"] || fl["VERSAO"] || "";
  var produto = extrairProdutoK(textoK);
  var versaoLam = extrairVersaoL(textoL);
  var largLam = extrairLargura(textoK);
  var espLam = extrairEspessura(textoK);
  var pesoLam = parseFloat(fl["PESO"]) || 0;
  var prevEntrega = fl["PREV. ENTREGA"] || fl["PREV ENTREGA"] || "";
  var opLam = fl["OP"] || "";

  if (!produto || !opLam || pesoLam <= 0) continue;

  // Mesma regra da extrusão: OP de versão LP não recebe bobina
  if (versaoEhLP(versaoLam)) continue;

  var opMae = "";
  var opNum = parseInt(opLam);
  if (!isNaN(opNum)) {
    opMae = String(opNum - 2);
  } else {
    opMae = opLam;
  }

  fpLam.push({
    op: opMae,
    opOriginal: opLam,
    itemFila: produto,
    versao: versaoLam,
    largura: largLam,
    espessura: espLam,
    peso: pesoLam,
    difData: diferencaDiasHoje(prevEntrega),
    data: prevEntrega,
    familia: String(
      fl["FAMILIA"] || fl["FAMÍLIA"] || "",
    ).trim(),
    // Só exibição. A posição na fila e o recurso saem das colunas A e C
    // da planilha de laminação, iguais às da extrusão.
    //
    // Antes usava getColunaFila(fl, 0) e (fl, 2), mas nessa altura o "fl"
    // já não é a linha da planilha — é um objeto com 7 campos. Contar
    // posição nele pegava o número da OP no lugar da fila e a versão no
    // lugar do recurso. Foi o que apareceu na tela como
    // "fila 1095125 · rec 02 - 55.5 X 88".
    posFila: limparPosicaoFila(daLinha(fl.__crua, 0, ["FILA", "POSICAO", "POSIÇÃO", "SEQ"])),
    recurso: daLinha(fl.__crua, 2, ["RECURSO", "REC", "MAQUINA", "MÁQUINA"]),
  });
}

// No app estas duas linhas guardavam os dados para depuração na tela.
// No servidor não existe "window" — e depois do cálculo nada é guardado.
var saldoLam = {};
for (var sl = 0; sl < fpLam.length; sl++) {
  if (!saldoLam[fpLam[sl].op]) saldoLam[fpLam[sl].op] = fpLam[sl].peso;
} // DEBUG FILA LAM
if (fpLam.length > 0) {
}
// DEBUG EST METAL
for (var dbgE = 0; dbgE < est.length; dbgE++) {
  if (est[dbgE].isMetal) {
  }
}

var res = [];
est.sort(function (a, b) {
  return a.qtde - b.qtde;
});
for (var e2 = 0; e2 < est.length; e2++) {
  var bob = est[e2],
    found = false;

  if (bob.isMetal) {
    var candsLam = [];

    // BOBINA METALIZADA (item terminado em -4)
    //
    // Vai para a fila de LAMINAÇÃO, não para a de extrusão.
    //
    // A regra mudou em 10/09/2026 a pedido do usuário: o CÓDIGO DO ITEM
    // deixou de ser comparado. Agora só valem as MEDIDAS e a ESTRUTURA.
    //
    // Motivo prático: dois itens de código diferente podem ter a mesma
    // estrutura e as mesmas medidas — e nesse caso a bobina serve. Exigir
    // o mesmo código deixava sobra parada sem necessidade.
    //
    // O que é comparado:
    //   largura    igual (sem tolerância)
    //   espessura  igual (sem tolerância)
    //   estrutura  coluna MATERIAL do estoque  x  coluna S da laminação
    //              exemplo: "PET + NYLON"  x  "552-PET + NYLON"
    //
    // A versão também deixou de ser olhada.
    for (var f2 = 0; f2 < fpLam.length; f2++) {
      var oL = fpLam[f2];
      if (Number(oL.largura) !== Number(bob.largura)) continue;
      if (Number(oL.espessura) !== Number(bob.espessura)) continue;
      if (!estruturasCompativeis(bob.material, oL.familia)) continue;

      var saL = saldoLam[oL.op] || 0;
      if (bob.qtde > saL) continue;

      candsLam.push(oL);
    }

    if (candsLam.length > 0) {
      candsLam.sort(function (a, b) {
        return a.difData - b.difData;
      });

      var escL = candsLam[0];
      var altsLam = montarAlternativas(candsLam, escL.op, saldoLam, bob.qtde);
      saldoLam[escL.op] -= bob.qtde;

      res.push({
        enc: escL.op,
        alternativas: altsLam,
        opInterrompida: !!escL.interrompida,
        // Metalizado casa por medida exata e estrutura: formula nao entra.
        equivalente: false,
        item: bob.item,
        ver: bob.versao,
        larg: String(bob.largura),
        esp: String(bob.espessura),
        pig: bob.pigmentado,
        qtde: String(bob.qtde),
        uid: bob.uid || "",
        material: bob.material || "",
        largOP: String(escL.largura || bob.largura),
        composicao: bob.composicao || "",
        itemOP: escL.itemFila || "",
        verOP: escL.versao || "",
        posFila: escL.posFila || "",
        recurso: escL.recurso || "",
        flagFila: escL.flagFila || "",
        largOPDestino: escL.largJ || String(escL.largura || ""),
        espOPDestino: escL.espFila || String(escL.espessura || ""),
      });

      found = true;
    }
  } else {
    // A ordem decide a regra: TODA tentativa pela formula ORIGINAL vem
    // antes de qualquer tentativa pela EQUIVALENTE. Assim a equivalente
    // so e usada quando a original nao achou nada.
    var tent = [
      { ex: true, mt: true, eq: false },
      { ex: true, mt: false, eq: false },
      { ex: false, mt: true, eq: false },
      { ex: false, mt: false, eq: false },
      { ex: true, mt: true, eq: true },
      { ex: true, mt: false, eq: true },
      { ex: false, mt: true, eq: true },
      { ex: false, mt: false, eq: true },
    ];

    for (var t = 0; t < tent.length; t++) {
      if (found) break;
      var tn = tent[t],
        cands = [];

      for (var f2n = 0; f2n < fp.length; f2n++) {
        var o = fp[f2n];
        if (tn.mt) {
          if (o.isCapa !== bob.isCapa) continue;
        } else {
          if (o.isCapa === bob.isCapa) continue;
        }

        if (tn.ex) {
          var kEx = tn.eq ? o.chavesExatasEquiv : o.chavesExatas;
          if (kEx.indexOf(bob.chaveExata) === -1) continue;
        } else {
          var kSl = tn.eq ? o.chavesSemLargEquiv : o.chavesSemLarg;
          if (kSl.indexOf(bob.chaveSemLarg) === -1)
            continue;
          if (bob.largura < o.largura) continue;
          if (bob.largura > o.largMaxAceita) continue;
        }

        if (o.prioridade >= 99) continue;
        var sa = saldo[o.op] || 0;
        if (sa <= 0) continue;
        cands.push(o);
      }

      if (cands.length === 0) continue;
      ordenarCandidatas(cands);

      {
        // Bobina normal: encaixa na melhor OP
        // Se não cabe pelo saldo, junta várias OPs
        // Primeiro: tenta achar UMA OP sozinha que comporte a bobina
        var opUnica = null;

        for (var c1 = 0; c1 < cands.length; c1++) {
          var cand1 = cands[c1];
          var saldoCand1 = saldo[cand1.op] || 0;
          if (bob.qtde <= saldoCand1) {
            opUnica = cand1;
            break;
          }
        }

        if (opUnica) {
          // Cabe inteira em uma única OP
          // As alternativas saem ANTES do desconto, senão a OP escolhida
          // apareceria com o saldo já mordido pela própria bobina.
          var altsUnica = montarAlternativas(cands, opUnica.op, saldo, bob.qtde);
          saldo[opUnica.op] -= bob.qtde;

          res.push({
            enc: opUnica.op,
            opEtapa: opUnica.opEtapa || "",
            alternativas: altsUnica,
            opInterrompida: !!opUnica.interrompida,
            // Encaixou pela formula equivalente (coluna O) e nao pela
            // original (coluna X). A tela marca isso ao lado da OP.
            equivalente: !!tn.eq,
            item: bob.item,
            ver: bob.versao,
            larg: String(bob.largura),
            esp: String(bob.espessura),
            pig: bob.pigmentado,
            qtde: String(bob.qtde),
            uid: bob.uid || "",
            material: bob.material || "",
            largOP: String(opUnica.largura || bob.largura),
            apresentacao: opUnica.apresentacao || "",
            composicao: bob.composicao || "",
            itemOP: opUnica.itemFila || "",
            verOP: opUnica.versao || "",
            posFila: opUnica.posFila || "",
            recurso: opUnica.recurso || "",
            flagFila: opUnica.flagFila || "",
            largOPDestino: opUnica.largJ || String(opUnica.largura || ""),
            espOPDestino: opUnica.espFila || String(opUnica.espessura || ""),
          });

          found = true;
        } else {
          // Não cabe em uma só — junta OPs distintas até cobrir o peso
          var opsJuntadas = [];
          var saldoCoberto = 0;
          var opsJaUsadas = {};

          for (var c2 = 0; c2 < cands.length; c2++) {
            var escN = cands[c2];
            var saDispN = saldo[escN.op] || 0;
            if (saDispN <= 0) continue;
            if (opsJaUsadas[escN.op]) continue;
            opsJaUsadas[escN.op] = true;

            opsJuntadas.push(escN);
            saldoCoberto += saDispN;

            if (saldoCoberto >= bob.qtde) break;
          }

          if (saldoCoberto >= bob.qtde && opsJuntadas.length > 1) {
            var opsLabel = opsJuntadas
              .map(function (o) {
                return o.op;
              })
              .join(" + ");

            res.push({
              enc: opsLabel,
              opEtapa: opsJuntadas
                .map(function (o) { return o.opEtapa || "?"; })
                .join(" + "),
              // Bobina repartida entre várias OPs: trocar não se aplica.
              alternativas: [],
              opInterrompida: opsJuntadas.some(function (o) { return o.interrompida; }),
              equivalente: !!tn.eq,
              item: bob.item,
              ver: bob.versao,
              larg: String(bob.largura),
              esp: String(bob.espessura),
              pig: bob.pigmentado,
              qtde: String(bob.qtde),
              uid: bob.uid || "",
              material: bob.material || "",
              largOP: String(opsJuntadas[0].largura || bob.largura),
              apresentacao: opsJuntadas[0].apresentacao || "",
              composicao: bob.composicao || "",
              itemOP: opsJuntadas[0].itemFila || "",
              verOP: opsJuntadas[0].versao || "",
              posFila: opsJuntadas
                .map(function (o) { return o.posFila || "?"; })
                .join(" + "),
              recurso: opsJuntadas[0].recurso || "",
              flagFila: opsJuntadas[0].flagFila || "",
              largOPDestino: opsJuntadas[0].largJ || String(opsJuntadas[0].largura || ""),
              espOPDestino: opsJuntadas[0].espFila || String(opsJuntadas[0].espessura || ""),
            });

            found = true;
          }
        }
      }
    }
  }
}



/* ------------------------------------------------------------------------
   ENCAIXE DAS IMPRESSAS E LAMINADAS

   Regra combinada com o usuario em 13/10/2026:
     - procura na FILA DE EXTRUSAO por item + versao, e so isso
     - largura, espessura, composicao e pigmento NAO entram: a bobina ja
       foi feita para aquele produto, as medidas vieram de la
     - QUALQUER OP serve: posicao na fila e PROGRAMADA nao cortam
   ------------------------------------------------------------------------ */
if (impressas.length && filaImpressao.length) {
  // Indice da FILA DE IMPRESSAO pelo produto.
  //
  // Aqui o produto e o MESMO TEXTO do Estoque de Capas - nao tira o "1"
  // da frente nem o sufixo "-N", diferente do que se fazia quando elas
  // procuravam na fila de extrusao. Confirmado pelo usuario em 16/10/2026.
  var filaPorItemImp = {};
  for (var fi2 = 0; fi2 < filaImpressao.length; fi2++) {
    var ffi = filaImpressao[fi2];
    var kImp = chaveItemImpressao(getItemFila(ffi));
    if (!kImp) continue;
    if (!filaPorItemImp[kImp]) filaPorItemImp[kImp] = [];
    filaPorItemImp[kImp].push(ffi);
  }

  // A fila de impressao nao diz se a OP esta programada. Quem diz e a
  // fila de EXTRUSAO, procurando a mesma OP na coluna E (OP_PRINCIPAL).
  // Nao achou la, o card fica sem o S/N - em branco mesmo.
  var snPorOP = {};
  for (var sx = 0; sx < fila.length; sx++) {
    var fx = fila[sx];
    var opx = String(fx["OP_PRINCIPAL"] || "").trim();
    if (opx && snPorOP[opx] === undefined) {
      snPorOP[opx] = normalizarSN(fx["INDICADOR"]);
    }
  }

  for (var ii = 0; ii < impressas.length; ii++) {
    var bi = impressas[ii];
    var candidatasImp = filaPorItemImp[chaveItemImpressao(bi.item)] || [];
    var servem = [];
    var jaVista = {};

    for (var ci = 0; ci < candidatasImp.length; ci++) {
      var fc = candidatasImp[ci];
      if (!versoesIguaisImpressa(bi.versao, fc["VERSAO"])) continue;
      var opTxt = String(fc["OP"] || "").trim();
      if (!opTxt) continue;
      var marcaLinha = opTxt + "|" + ci;
      if (jaVista[marcaLinha]) continue;
      jaVista[marcaLinha] = true;
      servem.push({
        op: opTxt,
        posFila: limparPosicaoFila(fc["FILA"]),
        recurso: String(fc["RECURSO"] || "").trim(),
        itemFila: getItemFila(fc),
        versao: chaveVersaoImpressa(fc["VERSAO"]),
        apresentacao: fc["APRESENTACAO"] || "",
        // S/N vem da fila de extrusao, nao desta.
        flagFila: snPorOP[opTxt] || "",
      });
    }

    if (!servem.length) continue;

    // A primeira da fila vem como sugestao; as outras viram alternativa.
    servem.sort(function (a, b) {
      return posicaoParaOrdem(a.posFila) - posicaoParaOrdem(b.posFila);
    });

    // A OP escolhida ja conta como vista: se ela se repete na fila, nao
    // pode aparecer tambem como alternativa de si mesma.
    var vistasOp = {};
    vistasOp[servem[0].op] = true;
    var alternativasImp = [];
    for (var si = 1; si < servem.length; si++) {
      if (vistasOp[servem[si].op]) continue;
      vistasOp[servem[si].op] = true;
      alternativasImp.push({
        enc: servem[si].op,
        posFila: servem[si].posFila,
        recurso: servem[si].recurso,
        largOP: "",
        apresentacao: servem[si].apresentacao,
      });
      if (alternativasImp.length >= 8) break;
    }

    res.push({
      enc: servem[0].op,
      alternativas: alternativasImp,
      opInterrompida: false,
      // Impressa casa por produto + versao: formula nao entra.
      equivalente: false,
      fundo: false,
      item: bi.item,
      ver: bi.versao,
      larg: String(bi.largura),
      esp: String(bi.espessura),
      pig: "",
      qtde: String(bi.qtde),
      uid: bi.uid || "",
      material: "",
      largOP: String(bi.largura),
      apresentacao: servem[0].apresentacao,
      composicao: "",
      itemOP: servem[0].itemFila,
      verOP: servem[0].versao,
      posFila: servem[0].posFila,
      recurso: servem[0].recurso,
      flagFila: servem[0].flagFila,
      largOPDestino: String(bi.largura),
      espOPDestino: String(bi.espessura),
      // Marca que o app usa para pintar e contar em separado.
      impressa: true,
    });
  }
}

  return { res: res, problemas: problemas, problemasImportacao: problemasImportacao };
}



/* ==========================================================================
   Porta de entrada: recebe as planilhas, devolve os encaixes.
   Função pura — não guarda nada entre um pedido e outro.
   ========================================================================== */
// Conta quantas linhas da fila tiveram cada campo essencial preenchido.
//
// Serve para responder à pergunta "por que não encaixou nada?". Se a fila
// tem 300 linhas mas o campo PIGMENTADO veio vazio em todas, o problema é
// a leitura da planilha — não a falta de bobina compatível.
function diagnosticarLeitura() {
  var total = fila.length;
  if (!total) return { filaLinhas: 0 };

  var campos = ["OP", "PRODUTO", "DESCRICAO", "COMPOSICAO", "PIGMENTADO",
                "PESO", "APRESENTACAO", "SITUACAO", "PROGRAMADA", "FILA"];
  var contagem = {};
  var faltando = [];

  for (var c = 0; c < campos.length; c++) {
    var nome = campos[c];
    var achou = 0;
    for (var i = 0; i < total; i++) {
      var v = fila[i][nome];
      if (v !== undefined && v !== null && String(v).trim() !== "") achou++;
    }
    contagem[nome] = achou;
    if (achou === 0) faltando.push(nome);
  }

  var r = { filaLinhas: total, preenchidos: contagem };
  if (faltando.length) {
    r.camposVazios = faltando;
    r.aviso = "Estes campos vieram vazios em todas as linhas da fila: " +
              faltando.join(", ") +
              ". Confira se o cabeçalho da planilha mudou de nome.";
  }
  return r;
}


function calcular(entrada) {
  var dados = entrada || {};

  // O app manda a planilha crua. É aqui que ela vira dado com significado.
  estoque = prepararPlanilha(dados.estoque, lerLinhaEstoque);
  fila = prepararPlanilha(dados.fila, lerLinhaFila);
  filaLaminacao = prepararPlanilha(dados.filaLaminacao, lerLinhaLaminacao);
  filaImpressao = prepararPlanilha(dados.filaImpressao, lerLinhaImpressao);

  var tol = dados.tolerancia || {};
  toleranciaFilme = (tol.filme === undefined || tol.filme === null) ? 10 : Number(tol.filme);
  toleranciaSaco  = (tol.saco  === undefined || tol.saco  === null) ? 0  : Number(tol.saco);
  if (isNaN(toleranciaFilme)) toleranciaFilme = 10;
  if (isNaN(toleranciaSaco)) toleranciaSaco = 0;

  ultimosProblemasImportacaoEstoque = [];

  if (!estoque.length) return { erro: "Estoque vazio" };
  if (!fila.length && !filaLaminacao.length && !filaImpressao.length)
    return { erro: "Nenhuma fila enviada" };

  // Se a fila veio mas nenhuma linha serviu, guarda o motivo. Sem isto o
  // app mostrava "nenhum encaixe" sem dizer que o problema era a leitura
  // da planilha, e não a falta de bobina compatível.
  var diagnostico = diagnosticarLeitura();

  var saida = executarCalculo();

  // Mesmo formato que o app já sabe desenhar
  var encaixes = [], kg = 0;
  for (var i = 0; i < saida.res.length; i++) {
    var rs = saida.res[i];
    kg += parseFloat(rs.qtde) || 0;
    encaixes.push({
      id: i,
      enc: rs.enc, item: rs.item, ver: rs.ver,
      larg: rs.larg, esp: rs.esp, pig: rs.pig, qtde: rs.qtde,
      uid: rs.uid || "", material: rs.material || "",
      largOP: rs.largOP || rs.larg,
      apresentacao: rs.apresentacao || "",
      formula: rs.composicao || "",
      fundo: !!rs.fundo,
      itemOP: rs.itemOP || "", verOP: rs.verOP || "",
      posFila: rs.posFila || "", recurso: rs.recurso || "",
      flagFila: rs.flagFila || "",
      largOPDestino: rs.largOPDestino || "",
      espOPDestino: rs.espOPDestino || "",
      foto: null, fotoNm: "", ok: false, manual: false,
      // Outras OPs que também serviriam, na ordem de preferência do motor.
      // O app usa isso no botão de trocar a sugestão.
      alternativas: Array.isArray(rs.alternativas) ? rs.alternativas : [],
      // Avisa o app que esta OP está interrompida, para marcar na tela.
      opInterrompida: !!rs.opInterrompida,
      // Bobina que já saiu da extrusão: impressa ou laminada.
      impressa: !!rs.impressa,
      // Casou com a formula EQUIVALENTE da OP (coluna COMPOSICAO) e nao
      // com a ORIGINAL (coluna FORMULA_PADRAO). A tela marca ao lado da OP.
      equivalente: !!rs.equivalente,
      // A OP da etapa (coluna B). So as lisas trazem: a impressa e a
      // metalizada ficam como estavam, a pedido do usuario.
      opEtapa: rs.opEtapa || "",
    });
  }

  return {
    // Contagem do que o motor conseguiu entender da planilha. O app mostra
    // isto quando o cálculo volta vazio, para você saber se o problema é
    // leitura de coluna ou falta de bobina compatível.
    leitura: diagnostico,
    encaixes: encaixes,
    problemas: saida.problemas || [],
    problemasImportacao: saida.problemasImportacao || [],
    resumo: {
      bobinas: estoque.length,
      encaixadas: encaixes.length,
      kg: Math.round(kg),
      opsExtrusao: fila.length,
      opsLaminacao: filaLaminacao.length,
    },
  };
}

// Só o cálculo sai daqui.
//
// As funções que explicavam POR QUE uma bobina não encaixou foram removidas
// de propósito em 08/09/2026. Elas devolviam o raciocínio interno do motor
// — diferença de largura, saldo restante de cada OP, o nome de cada regra —
// e isso permitia reconstruir o algoritmo de fora, sem precisar do código.
//
// O motor agora responde o QUE encaixou, nunca o PORQUÊ.
module.exports = { calcular };
