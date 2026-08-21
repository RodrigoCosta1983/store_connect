// ============================================================================
// ARQUIVO: registerFocusCompany.js
// ============================================================================
//
// OBJETIVO:
// Validar e cadastrar empresas emitentes na Focus NFe.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Verificar autenticação do usuário.
// - Garantir que somente o proprietário da loja execute a operação.
// - Garantir que a loja possua plano Business ativo.
// - Validar os dados fiscais armazenados no Firestore.
// - Consultar se a empresa já existe na Focus NFe.
// - Executar validação via dry_run.
// - Realizar posteriormente o cadastro efetivo da empresa.
// - Salvar no Firestore somente o estado da integração com a Focus.
//
// SEGURANÇA:
// - Requer Firebase Authentication.
// - Somente o ownerId da loja pode executar esta função.
// - O FOCUS_NFE_MASTER_TOKEN fica exclusivamente no Firebase Secret Manager.
// - O token nunca deve ser enviado ao Flutter.
// - O token nunca deve ser salvo no Firestore.
//
// INTEGRAÇÕES:
// - Firebase Firestore
// - Firebase Secret Manager
// - Focus NFe API
//
// FLUXO:
// Flutter
//    ↓
// Cloud Function
//    ↓
// Secret Manager
//    ↓
// Focus NFe
//    ↓
// Firestore
//
// MODO DE TESTE:
// - dryRun = true:
//   apenas valida o cadastro na Focus.
// - dryRun = false:
//   realiza o cadastro efetivo.
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
// - Não remover a proteção de ownerId.
// - Não mover o token para .env, Flutter ou Firestore.
// - Não sobrescrever o objeto perfilFiscal inteiro ao atualizar dados da Focus.
// - Usar dot notation para atualizar somente perfilFiscal.focus.
// - Esta função ainda NÃO envia certificado digital.
// ============================================================================

// functions/fiscal/registerFocusCompany.js

const { onCall, HttpsError } =
  require("firebase-functions/v2/https");

const admin = require("firebase-admin");
const axios = require("axios");

// ============================================================================
// FOCUS NFE - CADASTRAR / VALIDAR EMPRESA EMITENTE
// ============================================================================

const registerFocusCompany = onCall(
  {
    secrets: ["FOCUS_NFE_MASTER_TOKEN"],
  },
  async (request) => {
    // ==========================================================================
    // 1. AUTENTICAÇÃO
    // ==========================================================================

    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "O usuário precisa estar autenticado."
      );
    }

    const uid = request.auth.uid;

    // ==========================================================================
    // 2. DADOS RECEBIDOS DO FLUTTER
    //
    // dryRun vem true por padrão.
    //
    // Portanto, enquanto não enviarmos explicitamente false,
    // a empresa NÃO será cadastrada de verdade.
    // ==========================================================================

    const {
      storeId,
      dryRun = true,
    } = request.data || {};

    if (!storeId) {
      throw new HttpsError(
        "invalid-argument",
        "storeId é obrigatório."
      );
    }

    // ==========================================================================
    // 3. FIRESTORE
    // ==========================================================================

    const db = admin.firestore();

    const storeRef = db
      .collection("stores")
      .doc(storeId);

    const storeDoc =
      await storeRef.get();

    if (!storeDoc.exists) {
      throw new HttpsError(
        "not-found",
        "Loja não encontrada."
      );
    }

    const store = storeDoc.data();

    // ==========================================================================
    // 4. SEGURANÇA - PROPRIETÁRIO DA LOJA
    //
    // Configuração fiscal é uma operação sensível.
    //
    // Nesta versão:
    // SOMENTE o ownerId da loja pode executar.
    // ==========================================================================

    if (store.ownerId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Somente o administrador proprietário da loja pode alterar a configuração fiscal."
      );
    }

    // ==========================================================================
    // 5. PLANO BUSINESS
    //
    // Não confiamos apenas no Flutter.
    // A proteção também existe no backend.
    // ==========================================================================

    if (
      store.subscriptionType !== "business" ||
      store.subscriptionStatus !== "active"
    ) {
      throw new HttpsError(
        "permission-denied",
        "O módulo fiscal está disponível somente para o Plano Business ativo."
      );
    }

    // ==========================================================================
    // 6. PERFIL FISCAL
    // ==========================================================================

    const fiscal = store.perfilFiscal;

    if (!fiscal) {
      throw new HttpsError(
        "failed-precondition",
        "A configuração fiscal ainda não foi preenchida."
      );
    }

    // ==========================================================================
    // FUNÇÃO AUXILIAR
    //
    // Mantém somente números.
    // ==========================================================================

    const cleanDigits = (value) =>
      String(value || "")
        .replace(/\D/g, "");

    // ==========================================================================
    // 7. CNPJ
    // ==========================================================================

    const cnpj =
      cleanDigits(fiscal.cnpj);

    if (cnpj.length !== 14) {
      throw new HttpsError(
        "failed-precondition",
        "CNPJ inválido."
      );
    }

    // ==========================================================================
    // 8. RAZÃO SOCIAL
    // ==========================================================================

    const razaoSocial =
      String(
        fiscal.razaoSocial || ""
      ).trim();

    if (!razaoSocial) {
      throw new HttpsError(
        "failed-precondition",
        "Razão social é obrigatória."
      );
    }

    // ==========================================================================
    // 9. REGIME TRIBUTÁRIO
    //
    // Focus:
    //
    // 1 = Simples Nacional
    // 2 = Simples Nacional - excesso sublimite
    // 3 = Regime Normal
    // 4 = Simples Nacional - MEI
    // ==========================================================================

    const regimeMap = {
      simples_nacional: 1,
      simples_excesso: 2,
      regime_normal: 3,
      mei: 4,
    };

    const regimeTributario =
      regimeMap[
        fiscal.regimeTributario
      ];

    if (!regimeTributario) {
      throw new HttpsError(
        "failed-precondition",
        "Regime tributário inválido."
      );
    }

    // ==========================================================================
    // 10. ENDEREÇO
    // ==========================================================================

    const logradouro =
      String(
        fiscal.logradouro || ""
      ).trim();

    const bairro =
      String(
        fiscal.bairro || ""
      ).trim();

    const municipio =
      String(
        fiscal.municipio || ""
      ).trim();

    const uf =
      String(
        fiscal.uf || ""
      )
        .trim()
        .toUpperCase();

    const cep =
      cleanDigits(
        fiscal.cep
      );

    const numeroEndereco =
      cleanDigits(
        fiscal.numero
      );

    // --------------------------------------------------------------------------
    // Logradouro
    // --------------------------------------------------------------------------

    if (!logradouro) {
      throw new HttpsError(
        "failed-precondition",
        "Logradouro do endereço fiscal é obrigatório."
      );
    }

    // --------------------------------------------------------------------------
    // Número
    // --------------------------------------------------------------------------

    if (!numeroEndereco) {
      throw new HttpsError(
        "failed-precondition",
        "Número do endereço fiscal inválido."
      );
    }

    // --------------------------------------------------------------------------
    // Bairro
    // --------------------------------------------------------------------------

    if (!bairro) {
      throw new HttpsError(
        "failed-precondition",
        "Bairro do endereço fiscal é obrigatório."
      );
    }

    // --------------------------------------------------------------------------
    // Município
    // --------------------------------------------------------------------------

    if (!municipio) {
      throw new HttpsError(
        "failed-precondition",
        "Município do endereço fiscal é obrigatório."
      );
    }

    // --------------------------------------------------------------------------
    // UF
    // --------------------------------------------------------------------------

    if (uf.length !== 2) {
      throw new HttpsError(
        "failed-precondition",
        "UF inválida."
      );
    }

    // --------------------------------------------------------------------------
    // CEP
    // --------------------------------------------------------------------------

    if (cep.length !== 8) {
      throw new HttpsError(
        "failed-precondition",
        "CEP fiscal inválido."
      );
    }

    // ==========================================================================
    // 11. INSCRIÇÃO ESTADUAL
    //
    // Se não houver números preenchidos, não adicionamos ao payload.
    // ==========================================================================

    const inscricaoEstadual =
      cleanDigits(
        fiscal.inscricaoEstadual
      );

    // ==========================================================================
    // 12. TELEFONE
    // ==========================================================================

    const telefone =
      cleanDigits(
        store.phone
      );

    // ==========================================================================
    // 13. TOKEN PRINCIPAL DA FOCUS
    //
    // Armazenado no Firebase Secret Manager:
    //
    // FOCUS_NFE_MASTER_TOKEN
    //
    // O acesso foi declarado no onCall:
    //
    // secrets: ["FOCUS_NFE_MASTER_TOKEN"]
    //
    // Nunca enviar para Flutter ou Firestore.
    // ==========================================================================

    const focusToken =
      process.env
        .FOCUS_NFE_MASTER_TOKEN;

    if (!focusToken) {
      console.error(
        "FOCUS_NFE_MASTER_TOKEN não configurado."
      );

      throw new HttpsError(
        "failed-precondition",
        "Token principal da Focus NFe não configurado no servidor."
      );
    }

    // ==========================================================================
    // 14. AUTENTICAÇÃO BASIC
    //
    // username = token
    // password = vazio
    // ==========================================================================

    const auth = {
      username: focusToken,
      password: "",
    };

    // ==========================================================================
    // 15. URL DA API DE EMPRESAS
    //
    // A API de Empresas utiliza o servidor principal.
    //
    // O teste de cadastro utiliza:
    //
    // dry_run=1
    // ==========================================================================

    const EMPRESAS_URL =
      "https://api.focusnfe.com.br/v2/empresas";

    // ==========================================================================
    // 16. VERIFICA SE A EMPRESA JÁ EXISTE NA FOCUS
    //
    // GET:
    //
    // /v2/empresas?cnpj=XXXXXXXXXXXXXX
    // ==========================================================================

    try {
      const existingResponse =
        await axios.get(
          EMPRESAS_URL,
          {
            params: {
              cnpj,
            },

            auth,

            headers: {
              Accept:
                "application/json",
            },

            timeout: 20000,
          }
        );

      const existingCompanies =
        Array.isArray(
          existingResponse.data
        )
          ? existingResponse.data
          : [];

      // ========================================================================
      // EMPRESA JÁ EXISTE
      // ========================================================================

      if (
        existingCompanies.length > 0
      ) {
        const company =
          existingCompanies[0];

        const companyId =
          company.id ??
          company.id_empresa ??
          null;

        // ----------------------------------------------------------------------
        // IMPORTANTE:
        //
        // Usamos dot notation.
        //
        // Assim NÃO sobrescrevemos:
        //
        // perfilFiscal.cnpj
        // perfilFiscal.razaoSocial
        // perfilFiscal.certificado
        // etc.
        // ----------------------------------------------------------------------

        await storeRef.update({
          "perfilFiscal.focus.empresaCadastrada":
            true,

          "perfilFiscal.focus.empresaId":
            companyId,

          "perfilFiscal.focus.dryRunValidado":
            true,

          "perfilFiscal.focus.status":
            "empresa_existente",

          "perfilFiscal.focus.sincronizadoEm":
            admin.firestore.FieldValue
              .serverTimestamp(),

          "perfilFiscal.focus.ultimoErro":
            admin.firestore.FieldValue
              .delete(),
        });

        console.log(
          `Focus NFe: empresa ${cnpj} já cadastrada. ID: ${companyId}`
        );

        return {
          success: true,

          alreadyExists: true,

          dryRun: false,

          companyId,

          message:
            "Empresa já cadastrada na Focus NFe.",
        };
      }
    } catch (error) {
      // ========================================================================
      // ERRO AO CONSULTAR EMPRESAS
      // ========================================================================

      const status =
        error.response?.status;

      const focusError =
        error.response?.data ||
        error.message;

      console.error(
        "Erro ao consultar empresa na Focus:",
        {
          status,
          error: focusError,
        }
      );

      throw new HttpsError(
        "internal",
        "Não foi possível consultar a empresa na Focus NFe.",
        {
          focusStatus:
            status ?? null,

          focusError,
        }
      );
    }

    // ==========================================================================
    // 17. MONTA PAYLOAD DA EMPRESA
    //
    // Começamos somente com os dados necessários para integração NFC-e.
    // ==========================================================================

    const companyPayload = {
      // ------------------------------------------------------------------------
      // Identificação
      // ------------------------------------------------------------------------

      nome:
        razaoSocial,

      nome_fantasia:
        String(
          fiscal.nomeFantasia ||
          razaoSocial
        ).trim(),

      cnpj,

      // ------------------------------------------------------------------------
      // Tributação
      // ------------------------------------------------------------------------

      regime_tributario:
        regimeTributario,

      // ------------------------------------------------------------------------
      // Endereço
      // ------------------------------------------------------------------------

      logradouro,

      numero:
        Number(
          numeroEndereco
        ),

      complemento:
        String(
          fiscal.complemento || ""
        ).trim(),

      municipio,

      bairro,

      cep:
        Number(cep),

      uf,

      // ------------------------------------------------------------------------
      // Contato
      // ------------------------------------------------------------------------

      telefone,

      // ------------------------------------------------------------------------
      // Documentos fiscais habilitados
      // ------------------------------------------------------------------------

      habilita_nfce: true,

      habilita_nfe: false,

      habilita_nfse: false,
    };

    // ==========================================================================
    // 18. INSCRIÇÃO ESTADUAL
    // ==========================================================================

    if (
      inscricaoEstadual.length > 0
    ) {
      companyPayload
        .inscricao_estadual =
        Number(
          inscricaoEstadual
        );
    }

    // ==========================================================================
    // 19. EMAIL
    // ==========================================================================

    if (
      store.email &&
      String(store.email).trim()
    ) {
      companyPayload.email =
        String(
          store.email
        ).trim();
    }

    // ==========================================================================
    // DEBUG SEGURO
    //
    // Pode aparecer nos logs do Firebase.
    //
    // NÃO incluímos o token.
    // ==========================================================================

    console.log(
      "Focus NFe - preparando empresa:",
      {
        storeId,
        cnpj,
        dryRun,
        razaoSocial,
        uf,
        regimeTributario,
      }
    );

    // ==========================================================================
    // 20. ENVIO PARA FOCUS
    // ==========================================================================

    try {
      const response =
        await axios.post(
          EMPRESAS_URL,
          companyPayload,
          {
            params:
              dryRun === true
                ? {
                    dry_run: 1,
                  }
                : undefined,

            auth,

            headers: {
              Accept:
                "application/json",

              "Content-Type":
                "application/json",
            },

            timeout: 30000,
          }
        );

      // ========================================================================
      // 21. DRY RUN
      //
      // A Focus validou os dados,
      // mas a empresa NÃO foi persistida.
      // ========================================================================

      if (dryRun === true) {
        await storeRef.update({
          "perfilFiscal.focus.empresaCadastrada":
            false,

          "perfilFiscal.focus.dryRunValidado":
            true,

          "perfilFiscal.focus.status":
            "validacao_ok",

          "perfilFiscal.focus.validadoEm":
            admin.firestore.FieldValue
              .serverTimestamp(),

          "perfilFiscal.focus.ultimoErro":
            admin.firestore.FieldValue
              .delete(),
        });

        console.log(
          `Focus NFe dry-run OK para CNPJ ${cnpj}.`
        );

        return {
          success: true,

          dryRun: true,

          alreadyExists: false,

          message:
            "Dados fiscais validados com sucesso na Focus NFe.",

          focusStatus:
            response.status,
        };
      }

      // ========================================================================
      // 22. CADASTRO REAL
      // ========================================================================

      const company =
        response.data || {};

      const companyId =
        company.id ??
        company.id_empresa ??
        null;

      await storeRef.update({
        "perfilFiscal.focus.empresaCadastrada":
          true,

        "perfilFiscal.focus.empresaId":
          companyId,

        "perfilFiscal.focus.dryRunValidado":
          true,

        "perfilFiscal.focus.status":
          "empresa_cadastrada",

        "perfilFiscal.focus.sincronizadoEm":
          admin.firestore.FieldValue
            .serverTimestamp(),

        "perfilFiscal.focus.ultimoErro":
          admin.firestore.FieldValue
            .delete(),
      });

      console.log(
        `Focus NFe: empresa ${cnpj} cadastrada. ID: ${companyId}`
      );

      return {
        success: true,

        dryRun: false,

        alreadyExists: false,

        companyId,

        message:
          "Empresa cadastrada com sucesso na Focus NFe.",
      };
    } catch (error) {
      // ========================================================================
      // 23. ERRO DEVOLVIDO PELA FOCUS
      //
      // O token NÃO é registrado.
      // ========================================================================

      const status =
        error.response?.status;

      const focusError =
        error.response?.data ||
        error.message;

      console.error(
        "Erro Focus NFe ao cadastrar/validar empresa:",
        {
          status,
          error: focusError,
        }
      );

      // ------------------------------------------------------------------------
      // Guarda apenas o estado do erro.
      // ------------------------------------------------------------------------

      try {
        await storeRef.update({
          "perfilFiscal.focus.status":
            "erro_validacao",

          "perfilFiscal.focus.ultimoErroEm":
            admin.firestore.FieldValue
              .serverTimestamp(),

          "perfilFiscal.focus.ultimoErro":
            typeof focusError === "string"
              ? focusError
              : JSON.stringify(
                  focusError
                ),
        });
      } catch (
        firestoreError
      ) {
        console.error(
          "Erro ao registrar falha da Focus no Firestore:",
          firestoreError
        );
      }

      // ------------------------------------------------------------------------
      // Retorna detalhes ao Flutter.
      // ------------------------------------------------------------------------

      throw new HttpsError(
        "failed-precondition",
        "A Focus NFe recusou os dados da empresa.",
        {
          focusStatus:
            status ?? null,

          focusError,
        }
      );
    }
  }
);

// ============================================================================
// EXPORTAÇÃO
// ============================================================================

module.exports = {
  registerFocusCompany,
};