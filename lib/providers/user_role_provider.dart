// ============================================================================
// ARQUIVO: user_role_provider.dart
// ============================================================================
//
// OBJETIVO:
//
// Centralizar o estado de autenticação, o papel operacional do usuário e a loja
// vinculada, servindo como fonte de autorização VISUAL para a interface Flutter.
//
// PAPÉIS CANÔNICOS DO STORE&CONNECT:
//
// - admin
// - gerente
// - operador
//
// O papel "operador" representa o usuário operacional da loja e substitui os
// papéis antigos:
//
// - caixa
// - vendedor
//
// COMPATIBILIDADE COM DADOS ANTIGOS:
//
// Enquanto ainda existirem documentos antigos no Firestore:
//
//   role: "caixa"
//   role: "vendedor"
//
// ambos serão interpretados em memória como:
//
//   role: "operador"
//
// Isso permite migrar a base gradualmente sem bloquear usuários antigos.
//
// REGRA DE SEGURANÇA:
//
// O fallback deve ser sempre o papel menos privilegiado.
//
// Portanto, qualquer documento:
// - sem role;
// - com role vazio;
// - com role desconhecido;
//
// será tratado como "operador".
//
// DONO DA LOJA:
//
// O proprietário NÃO depende do fallback.
//
// O CreateStoreScreen deve gravar explicitamente:
//
//   role: "admin"
//   storeId: "{storeId}"
//
// para o usuário que cria a loja.
//
// As lojas antigas já devem ter seus proprietários regularizados para "admin".
//
// ESCUTA EM TEMPO REAL:
//
// Este Provider acompanha continuamente:
//
//   users/{uid}
//
// Portanto, alterações de role/storeId são refletidas automaticamente na
// interface, sem exigir logout/login.
//
// OPERAÇÕES CRÍTICAS:
//
// canPerformCriticalActions:
//
//   admin    -> true
//   gerente  -> false
//   operador -> false
//
// O Provider NÃO é a barreira de segurança definitiva.
//
// Ele controla apenas UX/autorização visual.
//
// Operações críticas precisam ser novamente protegidas:
// - no backend / Cloud Functions;
// - nas Firestore Rules;
// - por autorização administrativa quando aplicável.
//
// CUIDADO DE ESTADO:
//
// Quando o usuário autenticado muda:
//
// 1. cancela o listener do usuário anterior;
// 2. reseta imediatamente role/storeId;
// 3. assume o papel menos privilegiado;
// 4. começa a observar users/{novoUid};
//
// Isso impede privilégios residuais entre sessões.
//
// ============================================================================

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class UserRoleProvider extends ChangeNotifier {
  User? _currentUser;

  String _userRole = 'operador';
  String _storeId = '';

  bool _isLoading = true;

  StreamSubscription<User?>? _authSubscription;

  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
  _userDocumentSubscription;

  // ==========================================================================
  // GETTERS
  // ==========================================================================

  User? get currentUser => _currentUser;

  String get userRole => _userRole;

  String get storeId => _storeId;

  bool get isLoading => _isLoading;

  bool get isAdmin => _userRole == 'admin';

  bool get isGerente => _userRole == 'gerente';

  bool get isOperador => _userRole == 'operador';

  bool get canAccessSettings => _userRole == 'admin' || _userRole == 'gerente';

  bool get canPerformCriticalActions => isAdmin;

  // ==========================================================================
  // CONSTRUTOR
  // ==========================================================================

  UserRoleProvider() {
    _init();
  }

  // ==========================================================================
  // NORMALIZAÇÃO DE PAPÉIS
  // ==========================================================================
  //
  // Mantém compatibilidade com a estrutura antiga:
  //
  // caixa    -> operador
  // vendedor -> operador
  //
  // Qualquer valor desconhecido também cai em operador.
  // ==========================================================================

  String _normalizeRole(dynamic value) {
    final rawRole = value?.toString().trim().toLowerCase();

    switch (rawRole) {
      case 'admin':
        return 'admin';

      case 'gerente':
        return 'gerente';

      case 'operador':
      case 'caixa':
      case 'vendedor':
        return 'operador';

      default:
        return 'operador';
    }
  }

  // ==========================================================================
  // INICIALIZAÇÃO
  // ==========================================================================

  void _init() {
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen(
      (user) async {
        // --------------------------------------------------------------------
        // Cancela qualquer listener pertencente ao usuário anterior.
        // --------------------------------------------------------------------

        await _userDocumentSubscription?.cancel();
        _userDocumentSubscription = null;

        _currentUser = user;

        // --------------------------------------------------------------------
        // Estado seguro enquanto carregamos o novo perfil.
        // --------------------------------------------------------------------

        _userRole = 'operador';
        _storeId = '';
        _isLoading = user != null;

        notifyListeners();

        // --------------------------------------------------------------------
        // Logout.
        // --------------------------------------------------------------------

        if (user == null) {
          _isLoading = false;

          notifyListeners();

          return;
        }

        // --------------------------------------------------------------------
        // Usuário autenticado.
        // --------------------------------------------------------------------

        _listenToUserDocument(user.uid);
      },
      onError: (Object error) {
        debugPrint('Erro ao observar autenticação do usuário: $error');

        _currentUser = null;
        _userRole = 'operador';
        _storeId = '';
        _isLoading = false;

        notifyListeners();
      },
    );
  }

  // ==========================================================================
  // ESCUTA DO DOCUMENTO DO USUÁRIO
  // ==========================================================================
  //
  // Caminho:
  //
  // users/{uid}
  //
  // Mantém role e storeId sincronizados em tempo real.
  // ==========================================================================

  void _listenToUserDocument(String uid) {
    _userDocumentSubscription = FirebaseFirestore.instance
        .collection('users')
        .doc(uid)
        .snapshots()
        .listen(
          (doc) {
            // --------------------------------------------------------------------
            // Proteção contra evento atrasado de uma sessão anterior.
            // --------------------------------------------------------------------

            if (_currentUser?.uid != uid) {
              return;
            }

            // --------------------------------------------------------------------
            // Documento inexistente.
            // --------------------------------------------------------------------

            if (!doc.exists) {
              _userRole = 'operador';
              _storeId = '';
              _isLoading = false;

              notifyListeners();

              return;
            }

            final data = doc.data() ?? <String, dynamic>{};

            final accessStatus =
            data['accessStatus']
                ?.toString()
                .trim()
                .toLowerCase();

            if (accessStatus == 'revoked') {
              _userRole = 'operador';
              _storeId = '';
              _isLoading = false;

              debugPrint(
                '🔒 Usuário com acesso revogado: $uid',
              );

              notifyListeners();

              return;
            }

            final rawStoreId = data['storeId']?.toString().trim();

            // --------------------------------------------------------------------
            // Normaliza role atual + legado.
            // --------------------------------------------------------------------

            _userRole = _normalizeRole(data['role']);

            _storeId = rawStoreId ?? '';

            _isLoading = false;

            debugPrint(
              '👤 UserRoleProvider atualizado: '
              'uid=$uid | role=$_userRole | storeId=$_storeId',
            );

            notifyListeners();
          },
          onError: (Object error) {
            if (_currentUser?.uid != uid) {
              return;
            }

            // --------------------------------------------------------------------
            // Em caso de erro, remove qualquer privilégio elevado da interface.
            // --------------------------------------------------------------------

            _userRole = 'operador';
            _storeId = '';
            _isLoading = false;

            debugPrint('Erro ao acompanhar dados do usuário $uid: $error');

            notifyListeners();
          },
        );
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _authSubscription?.cancel();
    _userDocumentSubscription?.cancel();

    super.dispose();
  }
}
