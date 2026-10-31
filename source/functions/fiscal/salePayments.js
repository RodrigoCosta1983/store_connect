"use strict";
const {normalizeSalePayments} = require("../sales/splitPaymentBreakdown");
function buildSalePayments(sale, totalAmount, buildSingle) {
  const parts = normalizeSalePayments(sale.paymentMethod, sale.payments, Math.round(totalAmount * 100));
  return parts ? parts.map(part => buildSingle(part.method, part.amountCents / 100)) :
    [buildSingle(sale.paymentMethod, totalAmount)];
}
module.exports = {buildSalePayments};
