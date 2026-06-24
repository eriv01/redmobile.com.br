// ====================================================================
// /api/criar-pix.js  -  cria pagamento PIX no Mercado Pago
//
// SEGURANCA: o preco e SEMPRE recalculado aqui no servidor.
// O cliente so manda QUAIS itens; o valor cobrado vem desta tabela.
// Os precos abaixo precisam ser IGUAIS aos do CFG no index.html.
//
// Variavel de ambiente necessaria (painel da Vercel):
//   MP_ACCESS_TOKEN  -> Access Token do Mercado Pago (Producao)
// ====================================================================

// ---- EDITAR: mesma tabela de precos do index.html ----
const PRODUTO = { nome: "PRODUTO AQUI", preco: 10.00 };
const DESCONTO_PCT = 20; // aplicado ao preco do produto

// Bumps partem de 7,90; o UNITARIO cai conforme a QTD selecionada.
// idx 0 = 1 bump, idx 1 = 2 bumps... piso 4,90 nos ultimos.
// Precisa bater com CFG.BUMP_TIERS do index.html.
const BUMP_NOMES = {
  bump1: "Bump 01", bump2: "Bump 02", bump3: "Bump 03",
  bump4: "Bump 04", bump5: "Bump 05"
};
const BUMP_TIERS = [7.90, 6.90, 5.90, 4.90, 4.90];
// ------------------------------------------------------

function round2(v){ return Math.round(v * 100) / 100; }

function unitBump(qtd){
  if (qtd <= 0) return 0;
  const idx = Math.min(qtd, BUMP_TIERS.length) - 1;
  return BUMP_TIERS[idx];
}

function calcularTotal(comDesconto, bumpsIds){
  let total = PRODUTO.preco;
  if (comDesconto) total = total * (1 - DESCONTO_PCT / 100);

  // mantem so ids validos (evita burla)
  const validos = (bumpsIds || []).filter(function(id){ return BUMP_NOMES[id]; });
  const qtd = validos.length;
  const unit = unitBump(qtd);
  total += unit * qtd;

  const itens = [PRODUTO.nome].concat(validos.map(function(id){ return BUMP_NOMES[id]; }));
  return { total: round2(total), descricao: itens.join(" + ") };
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ error: "missing_mp_token" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const nome    = String(body.nome || "Cliente").trim();
    const email   = String(body.email || "").trim();
    const desconto = body.desconto === true;
    const bumps   = Array.isArray(body.bumps) ? body.bumps : [];

    const partes = nome.split(" ");
    const first = partes[0] || "Cliente";
    const last  = partes.length > 1 ? partes.slice(1).join(" ") : "Comprador";

    const calc = calcularTotal(desconto, bumps);

    const payload = {
      transaction_amount: calc.total,
      description: calc.descricao,
      payment_method_id: "pix",
      payer: {
        email: email || "comprador@exemplo.com",
        first_name: first,
        last_name: last
      }
    };

    const idem = "pix_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);

    const mpResp = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idem
      },
      body: JSON.stringify(payload)
    });

    const data = await mpResp.json();

    if (!mpResp.ok) {
      console.log("MP error status", mpResp.status, JSON.stringify(data));
      res.status(502).json({ error: "mp_error", detail: data && data.message ? data.message : "erro" });
      return;
    }

    const tx = data &&
      data.point_of_interaction &&
      data.point_of_interaction.transaction_data
        ? data.point_of_interaction.transaction_data : {};

    res.status(200).json({
      payment_id: data.id,
      status: data.status,
      valor: calc.total,
      qr_code: tx.qr_code || "",
      qr_code_base64: tx.qr_code_base64 || "",
      ticket_url: tx.ticket_url || ""
    });

  } catch (err) {
    console.log("criar-pix exception", err && err.message ? err.message : err);
    res.status(500).json({ error: "internal_error" });
  }
};
