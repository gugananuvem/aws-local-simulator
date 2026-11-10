/**
 * Reserved capacity do DynamoDB - somente simulador.
 *
 * Não há compra real: o usuário registra compras de capacidade de leitura (RCU) ou escrita (WCU)
 * por prazo de 1 ou 3 anos. As compras ficam em <dataDir>/dynamodb/_reserved-capacity/purchases.json
 * e sobrevivem a reinicializações. Não há preços: o simulador não cobra nada.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CAPACITY_TYPES = ["READ", "WRITE"];

const OFFERINGS = [
  { OfferingId: "READ-1Y", CapacityType: "READ", Term: "1Y", TermMonths: 12 },
  { OfferingId: "READ-3Y", CapacityType: "READ", Term: "3Y", TermMonths: 36 },
  { OfferingId: "WRITE-1Y", CapacityType: "WRITE", Term: "1Y", TermMonths: 12 },
  { OfferingId: "WRITE-3Y", CapacityType: "WRITE", Term: "3Y", TermMonths: 36 },
];

function purchasesFile(dataDir) {
  return path.join(dataDir, "_reserved-capacity", "purchases.json");
}

function readPurchases(dataDir) {
  const file = purchasesFile(dataDir);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writePurchases(dataDir, purchases) {
  fs.mkdirSync(path.dirname(purchasesFile(dataDir)), { recursive: true });
  fs.writeFileSync(purchasesFile(dataDir), JSON.stringify(purchases, null, 2));
}

function withStatus(purchase, now = Date.now()) {
  return { ...purchase, Status: Date.parse(purchase.EndDate) > now ? "ACTIVE" : "EXPIRED" };
}

function listOfferings() {
  return { Offerings: OFFERINGS };
}

function listPurchases(dataDir) {
  const purchases = readPurchases(dataDir).map((p) => withStatus(p));
  return { Purchases: purchases.sort((a, b) => b.StartDate.localeCompare(a.StartDate)) };
}

function createPurchase(dataDir, body = {}) {
  const { CapacityType, Term, Units } = body;

  if (!CAPACITY_TYPES.includes(CapacityType)) {
    throw new Error(`CapacityType must be one of: ${CAPACITY_TYPES.join(", ")}`);
  }
  const offering = OFFERINGS.find((o) => o.CapacityType === CapacityType && o.Term === Term);
  if (!offering) {
    throw new Error(`Term must be 1Y or 3Y for ${CapacityType} capacity`);
  }
  const units = Number(Units);
  if (!Number.isInteger(units) || units < 1) {
    throw new Error("Units must be a positive integer");
  }

  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + offering.TermMonths);

  const purchase = {
    PurchaseId: `rc-${crypto.randomBytes(6).toString("hex")}`,
    OfferingId: offering.OfferingId,
    CapacityType,
    Term,
    Units: units,
    StartDate: start.toISOString(),
    EndDate: end.toISOString(),
  };

  writePurchases(dataDir, [...readPurchases(dataDir), purchase]);
  return withStatus(purchase, start.getTime());
}

module.exports = { listOfferings, listPurchases, createPurchase };
