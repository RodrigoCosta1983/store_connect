const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

/**
 * --- CONVIDAR FUNCIONÁRIO ---
 * O Admin da loja convida um colaborador por e-mail.
 */
exports.convidarFuncionario = onCall(async (request) => {
  // 1. Validação de autenticação
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "O usuário precisa estar logado.");
  }

  const adminUid = request.auth.uid;
  const { storeId, email, nome, role } = request.data;

  if (!storeId || !email || !role) {
    throw new HttpsError("invalid-argument", "Preencha todos os campos obrigatórios (storeId, email, role).");
  }

  const db = admin.firestore();

  try {
    // 2. Valida se quem está chamando é realmente o Admin daquela loja
    const adminUserDoc = await db.collection("users").doc(adminUid).get();
    if (!adminUserDoc.exists || adminUserDoc.data().storeId !== storeId) {
      throw new HttpsError("permission-denied", "Você não tem permissão para gerenciar esta loja.");
    }

    // Opcional: Garanta que a role enviada é válida
    const rolesPermitidas = ["caixa", "vendedor", "gerente"];
    if (!rolesPermitidas.includes(role)) {
      throw new HttpsError("invalid-argument", "Cargo inválido.");
    }

    // 3. Cria a conta do funcionário no Firebase Authentication (sem senha inicial)
    const userRecord = await admin.auth().createUser({
      email: email,
      displayName: nome || "Colaborador",
      emailVerified: false,
    });

    const newEmployeeUid = userRecord.uid;

    // 4. Cria o documento na coleção global "users" vinculando ao storeId e à role
    await db.collection("users").doc(newEmployeeUid).set({
      name: nome || "Colaborador",
      email: email,
      storeId: storeId,
      role: role, // Ex: "caixa", "vendedor"
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 5. Gera o link oficial do Firebase para o funcionário definir a senha
    const linkRedefinicao = await admin.auth().generatePasswordResetLink(email);

    // *Nota de Arquitetura:* Aqui você pode disparar o envio desse link por e-mail
    // usando uma API (como Resend, SendGrid) ou retornar o link para o app exibir
    // (caso prefira que o dono mande pelo WhatsApp do funcionário, por exemplo).

    console.log(`✅ Funcionário ${email} convidado com sucesso para a loja ${storeId} como ${role}.`);

    return {
      success: true,
      message: "Convite gerado com sucesso!",
      tempResetLink: linkRedefinicao // Útil para testes ou envio via WhatsApp se necessário
    };

  } catch (error) {
    console.error("Erro ao convidar funcionário:", error);
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Este e-mail já está cadastrado no sistema.");
    }
    throw new HttpsError("internal", error.message || "Erro ao processar o convite.");
  }
});