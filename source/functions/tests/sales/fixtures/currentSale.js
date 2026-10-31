"use strict";

// Synthetic historical prices and device time, deliberately unlike current product.
module.exports = {
  product: {name: "Nome atual", price: 999, costPrice: 7, quantidade: 5, lotes: [], legacy: {keep: true}},
  command: {totalAmount: 10, paymentMethod: "Dinheiro", notes: "Nota histórica",
    customerId: "synthetic-customer", customerName: "Nome histórico",
    createdAt: "2026-10-01T03:00:00.123Z",
    products: [{productId: "p", name: "Nome no aparelho", quantity: 1, price: 10}]},
};
