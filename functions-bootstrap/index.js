"use strict";

const admin = require("firebase-admin");
if (admin.apps.length === 0) {
  admin.initializeApp();
}

exports.bootstrapStore = require("./auth/bootstrapStore").bootstrapStore;
