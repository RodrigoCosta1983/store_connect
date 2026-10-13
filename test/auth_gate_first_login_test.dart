// Test doubles implement Firebase interfaces; no platform or remote calls.
// ignore_for_file: subtype_of_sealed_class, must_be_immutable

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';

class _User extends Fake implements User {
  @override
  String get uid => 'test-user';
}

class _Auth extends Fake implements FirebaseAuth {
  final Stream<User?> stream = Stream.value(_User());
  @override
  Stream<User?> authStateChanges() => stream;
}

class _Snapshot extends Fake
    implements DocumentSnapshot<Map<String, dynamic>> {
  _Snapshot(this.exists);
  @override
  final bool exists;
  @override
  Map<String, dynamic>? data() => exists ? {'storeId': ''} : null;
}

class _Document extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  _Document(this.exists);
  final bool exists;
  final events = StreamController<DocumentSnapshot<Map<String, dynamic>>>();
  final updates = <Map<Object, Object?>>[];
  int reads = 0;
  int sets = 0;

  @override
  Future<void> set(Map<String, dynamic> data, [SetOptions? options]) async {
    sets++;
  }

  @override
  Future<DocumentSnapshot<Map<String, dynamic>>> get([GetOptions? options]) async {
    reads++;
    return _Snapshot(exists);
  }

  @override
  Future<void> update(Map<Object, Object?> data) async => updates.add(data);

  // Fake.set throws if production code attempts an implicit creation.
  @override
  Stream<DocumentSnapshot<Map<String, dynamic>>> snapshots({
    bool includeMetadataChanges = false,
    ListenSource source = ListenSource.defaultSource,
  }) => events.stream;
}

class _Collection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  _Collection(this.document);
  final _Document document;
  @override
  DocumentReference<Map<String, dynamic>> doc([String? path]) {
    expect(path, 'test-user');
    return document;
  }
}

class _Firestore extends Fake implements FirebaseFirestore {
  _Firestore(this.document);
  final _Document document;
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) {
    expect(path, 'users');
    return _Collection(document);
  }
}

void main() {
  setUp(() {
    PackageInfo.setMockInitialValues(
      appName: 'Test', packageName: 'test', version: '1.2.3',
      buildNumber: '4', buildSignature: '',
    );
  });

  Future<void> open(WidgetTester tester, _Document document) async {
    await tester.pumpWidget(MaterialApp(
      home: AuthGate(auth: _Auth(), firestore: _Firestore(document)),
    ));
    await tester.pump();
    await tester.pump();
  }

  testWidgets('existing profile receives only version and login update', (tester) async {
    final document = _Document(true);
    await open(tester, document);
    expect(document.reads, 1);
    expect(document.sets, 0);
    expect(document.updates, hasLength(1));
    expect(document.updates.single.keys, unorderedEquals(['versao_app', 'ultimo_login']));
    expect(document.updates.single['versao_app'], '1.2.3+4');
    expect(document.updates.single['ultimo_login'], isA<FieldValue>());
    await tester.pumpWidget(const SizedBox());
    unawaited(document.events.close());
  });

  testWidgets('missing profile skips writes and enters onboarding', (tester) async {
    final document = _Document(false);
    await open(tester, document);
    document.events.add(_Snapshot(false));
    await tester.pump();
    expect(document.reads, 1);
    expect(document.sets, 0);
    expect(document.updates, isEmpty);
    expect(find.byType(CreateStoreScreen), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    unawaited(document.events.close());
  });

  testWidgets('permission denial replaces onboarding with sanitized error', (tester) async {
    final document = _Document(false);
    await open(tester, document);
    document.events.add(_Snapshot(false));
    await tester.pump();
    expect(find.byType(CreateStoreScreen), findsOneWidget);
    final messages = <String>[];
    final previous = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) messages.add(message);
    };
    try {
      document.events.addError(FirebaseException(
        plugin: 'cloud_firestore', code: 'permission-denied',
        message: 'sensitive-test-user-details',
      ));
      await tester.pump();
      expect(find.byType(CreateStoreScreen), findsNothing);
      expect(find.textContaining('Não foi possível carregar seu perfil.'), findsOneWidget);
      expect(messages.join(), contains('permission-denied'));
      expect(messages.join(), isNot(contains('sensitive-test-user-details')));
    } finally {
      debugPrint = previous;
      await tester.pumpWidget(const SizedBox());
      unawaited(document.events.close());
    }
  });
}
