// Test-only Firebase platform fake. Executes real writers; no Rules, network,
// automatic transaction retry or Firebase SDK offline queue is simulated.
// ignore_for_file: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';

dynamic cloneSalesValue(dynamic value) {
  if (value is Map) {
    return <String, dynamic>{
      for (final e in value.entries) e.key as String: cloneSalesValue(e.value),
    };
  }
  if (value is List) return value.map(cloneSalesValue).toList();
  return value;
}

class _Increment {
  final num amount;
  _Increment(this.amount);
}

class SalesFieldValues extends FieldValueFactoryPlatform {
  @override
  dynamic increment(num value) => _Increment(value);
}

class SalesCharacterizationFirestore extends FirebaseFirestorePlatform {
  SalesCharacterizationFirestore()
    : super(appInstance: Firebase.app(), databaseChoice: '(default)');
  final docs = <String, Map<String, dynamic>>{};
  final reads = <String>[];
  final commits = <List<String>>[];
  int ids = 0;
  bool failAfterCommit = false;
  bool failCash = false;
  bool failAfterBatchCommit = false;
  List<Map<String, dynamic>> rows(String collection) => docs.entries
      .where(
        (e) =>
            e.key.startsWith('$collection/') &&
            e.key.split('/').length == collection.split('/').length + 1,
      )
      .map((e) => Map<String, dynamic>.from(cloneSalesValue(e.value) as Map))
      .toList();
  DocumentSnapshotPlatform snapshot(String path) => DocumentSnapshotPlatform(
    this,
    path,
    cloneSalesValue(docs[path]),
    InternalSnapshotMetadata(hasPendingWrites: false, isFromCache: false),
  );
  @override
  FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) => this;
  @override
  CollectionReferencePlatform collection(String path) =>
      _Collection(this, path);
  @override
  WriteBatchPlatform batch() => _Batch(this);
  @override
  DocumentReferencePlatform doc(String path) => _Document(this, path);
  @override
  Future<T?> runTransaction<T>(
    TransactionHandler<T> handler, {
    Duration timeout = const Duration(seconds: 30),
    int maxAttempts = 5,
  }) async {
    final transaction = _Transaction(this);
    final result = await handler(transaction);
    _apply(transaction.writes);
    if (failAfterCommit) {
      failAfterCommit = false;
      throw FirebaseException(
        plugin: 'cloud_firestore',
        code: 'aborted',
        message: 'Simulated lost response',
      );
    }
    return result;
  }

  void _apply(List<_Write> writes) {
    final next = {
      for (final e in docs.entries)
        e.key: Map<String, dynamic>.from(cloneSalesValue(e.value) as Map),
    };
    for (final write in writes) {
      if (failCash && write.path.contains('/cash_flow/')) {
        throw StateError('Simulated cash write failure');
      }
      if (write.update && !next.containsKey(write.path)) {
        throw StateError('Missing document ${write.path}');
      }
      final data = write.update ? next[write.path]! : <String, dynamic>{};
      for (final e in write.data.entries) {
        final raw = e.value;
        final value = raw is FieldValuePlatform
            ? FieldValuePlatform.getDelegate(raw)
            : raw;
        data[e.key] = value is _Increment
            ? (data[e.key] as num? ?? 0) + value.amount
            : cloneSalesValue(value);
      }
      next[write.path] = data;
    }
    docs
      ..clear()
      ..addAll(next);
    commits.add(writes.map((w) => w.path).toList());
  }
}

class _Write {
  final String path;
  final Map<String, dynamic> data;
  final bool update;
  _Write(this.path, this.data, this.update);
}

Map<String, dynamic> _fields(Map<FieldPath, dynamic> data) => {
  for (final e in data.entries) e.key.components.join('.'): e.value,
};

class _Transaction extends TransactionPlatform {
  final SalesCharacterizationFirestore fake;
  final writes = <_Write>[];
  _Transaction(this.fake);
  @override
  Future<DocumentSnapshotPlatform> get(String path) async {
    fake.reads.add(path);
    return fake.snapshot(path);
  }

  @override
  TransactionPlatform set(
    String path,
    Map<String, dynamic> data, [
    SetOptions? options,
  ]) {
    writes.add(_Write(path, data, false));
    return this;
  }

  @override
  TransactionPlatform update(String path, Map<FieldPath, dynamic> data) {
    writes.add(_Write(path, _fields(data), true));
    return this;
  }
}

class _Batch extends WriteBatchPlatform {
  final SalesCharacterizationFirestore fake;
  final writes = <_Write>[];
  _Batch(this.fake);
  @override
  void set(String path, Map<String, dynamic> data, [SetOptions? options]) =>
      writes.add(_Write(path, data, false));
  @override
  void update(String path, Map<FieldPath, dynamic> data) =>
      writes.add(_Write(path, _fields(data), true));
  @override
  Future<void> commit() async {
    fake._apply(writes);
    if (fake.failAfterBatchCommit) {
      fake.failAfterBatchCommit = false;
      throw StateError('Simulated lost batch response');
    }
  }
}

class _Document extends DocumentReferencePlatform {
  final SalesCharacterizationFirestore fake;
  _Document(this.fake, String path) : super(fake, path);
  @override
  Stream<DocumentSnapshotPlatform> snapshots({bool includeMetadataChanges=false,required ListenSource listenSource}) => Stream.fromFuture(get());
  @override
  Future<DocumentSnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async {
    fake.reads.add(path);
    return fake.snapshot(path);
  }

  @override
  Future<void> update(Map<FieldPath, dynamic> data) async =>
      fake._apply([_Write(path, _fields(data), true)]);
  @override
  Future<void> set(Map<String, dynamic> data, [SetOptions? options]) async =>
      fake._apply([_Write(path, data, false)]);
}

class _Collection extends CollectionReferencePlatform {
  final SalesCharacterizationFirestore fake;
  final Iterable<List<dynamic>> filters;
  _Collection(this.fake, String path, [this.filters = const []])
    : super(fake, path);
  @override
  Map<String, dynamic> get parameters => {
    'where': filters.toList(),
    'orderBy': <List<dynamic>>[],
  };
  @override
  DocumentReferencePlatform doc([String? id]) =>
      _Document(fake, '$path/${id ?? 'test-id-${fake.ids++}'}');
  @override
  QueryPlatform where(Iterable<List<dynamic>> conditions) =>
      _Collection(fake, path, conditions);
  @override
  QueryPlatform orderBy(Iterable<List<dynamic>> orders) => this;
  @override
  QueryPlatform limit(int value) => this;
  @override
  Future<QuerySnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async {
    final entries = fake.docs.entries
        .where(
          (e) =>
              e.key.startsWith('$path/') &&
              e.key.split('/').length == path.split('/').length + 1,
        )
        .where(
          (e) => filters.every(
            (f) =>
                e.value[f[0] is FieldPath
                    ? (f[0] as FieldPath).components.join('.')
                    : f[0]] ==
                f[2],
          ),
        );
    return QuerySnapshotPlatform(
      entries.map((e) => fake.snapshot(e.key)).toList(),
      [],
      SnapshotMetadataPlatform(false, false),
    );
  }

  @override
  Stream<QuerySnapshotPlatform> snapshots({
    bool includeMetadataChanges = false,
    required ListenSource listenSource,
  }) => Stream.fromFuture(get());
}
