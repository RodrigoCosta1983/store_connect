import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class UserRoleProvider extends ChangeNotifier {
  User? _currentUser;
  String _userRole = 'vendedor'; // Padrão seguro
  String _storeId = '';
  bool _isLoading = true;

  User? get currentUser => _currentUser;
  String get userRole => _userRole;
  String get storeId => _storeId;
  bool get isLoading => _isLoading;

  bool get isAdmin => _userRole == 'admin';
  bool get isGerente => _userRole == 'gerente';
  bool get canAccessSettings => _userRole == 'admin' || _userRole == 'gerente';

  UserRoleProvider() {
    _init();
  }

  Future<void> _init() async {
    FirebaseAuth.instance.authStateChanges().listen((user) async {
      _isLoading = true;
      notifyListeners();

      _currentUser = user;

      if (user != null) {
        await _fetchUserData(user.uid);
      } else {
        _userRole = 'vendedor';
        _storeId = '';
      }

      _isLoading = false;
      notifyListeners();
    });
  }

  Future<void> _fetchUserData(String uid) async {
    try {
      // 🚀 ADICIONADO `Source.server` PARA IGNORAR O CACHE LOCAL
      final doc = await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .get(const GetOptions(source: Source.server));

      if (doc.exists) {
        final data = doc.data() as Map<String, dynamic>;
        _userRole = data['role'] ?? 'admin';
        _storeId = data['storeId'] ?? '';
      }
    } catch (e) {
      debugPrint('Erro ao buscar dados do usuário: $e');
    }
  }
}