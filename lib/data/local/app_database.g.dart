// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $PendingSalesTable extends PendingSales
    with TableInfo<$PendingSalesTable, PendingSale> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingSalesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _localIdMeta = const VerificationMeta(
    'localId',
  );
  @override
  late final GeneratedColumn<String> localId = GeneratedColumn<String>(
    'local_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _storeIdMeta = const VerificationMeta(
    'storeId',
  );
  @override
  late final GeneratedColumn<String> storeId = GeneratedColumn<String>(
    'store_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _totalAmountMeta = const VerificationMeta(
    'totalAmount',
  );
  @override
  late final GeneratedColumn<double> totalAmount = GeneratedColumn<double>(
    'total_amount',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _productsJsonMeta = const VerificationMeta(
    'productsJson',
  );
  @override
  late final GeneratedColumn<String> productsJson = GeneratedColumn<String>(
    'products_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _paymentMethodMeta = const VerificationMeta(
    'paymentMethod',
  );
  @override
  late final GeneratedColumn<String> paymentMethod = GeneratedColumn<String>(
    'payment_method',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _notesMeta = const VerificationMeta('notes');
  @override
  late final GeneratedColumn<String> notes = GeneratedColumn<String>(
    'notes',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _customerIdMeta = const VerificationMeta(
    'customerId',
  );
  @override
  late final GeneratedColumn<String> customerId = GeneratedColumn<String>(
    'customer_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _customerNameMeta = const VerificationMeta(
    'customerName',
  );
  @override
  late final GeneratedColumn<String> customerName = GeneratedColumn<String>(
    'customer_name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _syncedAtMeta = const VerificationMeta(
    'syncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> syncedAt = GeneratedColumn<DateTime>(
    'synced_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(OfflineSaleStatus.pending),
  );
  static const VerificationMeta _syncAttemptsMeta = const VerificationMeta(
    'syncAttempts',
  );
  @override
  late final GeneratedColumn<int> syncAttempts = GeneratedColumn<int>(
    'sync_attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastSyncErrorMeta = const VerificationMeta(
    'lastSyncError',
  );
  @override
  late final GeneratedColumn<String> lastSyncError = GeneratedColumn<String>(
    'last_sync_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _serverSaleIdMeta = const VerificationMeta(
    'serverSaleId',
  );
  @override
  late final GeneratedColumn<String> serverSaleId = GeneratedColumn<String>(
    'server_sale_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    localId,
    storeId,
    totalAmount,
    productsJson,
    paymentMethod,
    notes,
    customerId,
    customerName,
    createdAt,
    syncedAt,
    status,
    syncAttempts,
    lastSyncError,
    serverSaleId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_sales';
  @override
  VerificationContext validateIntegrity(
    Insertable<PendingSale> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('local_id')) {
      context.handle(
        _localIdMeta,
        localId.isAcceptableOrUnknown(data['local_id']!, _localIdMeta),
      );
    } else if (isInserting) {
      context.missing(_localIdMeta);
    }
    if (data.containsKey('store_id')) {
      context.handle(
        _storeIdMeta,
        storeId.isAcceptableOrUnknown(data['store_id']!, _storeIdMeta),
      );
    } else if (isInserting) {
      context.missing(_storeIdMeta);
    }
    if (data.containsKey('total_amount')) {
      context.handle(
        _totalAmountMeta,
        totalAmount.isAcceptableOrUnknown(
          data['total_amount']!,
          _totalAmountMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_totalAmountMeta);
    }
    if (data.containsKey('products_json')) {
      context.handle(
        _productsJsonMeta,
        productsJson.isAcceptableOrUnknown(
          data['products_json']!,
          _productsJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_productsJsonMeta);
    }
    if (data.containsKey('payment_method')) {
      context.handle(
        _paymentMethodMeta,
        paymentMethod.isAcceptableOrUnknown(
          data['payment_method']!,
          _paymentMethodMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_paymentMethodMeta);
    }
    if (data.containsKey('notes')) {
      context.handle(
        _notesMeta,
        notes.isAcceptableOrUnknown(data['notes']!, _notesMeta),
      );
    }
    if (data.containsKey('customer_id')) {
      context.handle(
        _customerIdMeta,
        customerId.isAcceptableOrUnknown(data['customer_id']!, _customerIdMeta),
      );
    }
    if (data.containsKey('customer_name')) {
      context.handle(
        _customerNameMeta,
        customerName.isAcceptableOrUnknown(
          data['customer_name']!,
          _customerNameMeta,
        ),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('synced_at')) {
      context.handle(
        _syncedAtMeta,
        syncedAt.isAcceptableOrUnknown(data['synced_at']!, _syncedAtMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    if (data.containsKey('sync_attempts')) {
      context.handle(
        _syncAttemptsMeta,
        syncAttempts.isAcceptableOrUnknown(
          data['sync_attempts']!,
          _syncAttemptsMeta,
        ),
      );
    }
    if (data.containsKey('last_sync_error')) {
      context.handle(
        _lastSyncErrorMeta,
        lastSyncError.isAcceptableOrUnknown(
          data['last_sync_error']!,
          _lastSyncErrorMeta,
        ),
      );
    }
    if (data.containsKey('server_sale_id')) {
      context.handle(
        _serverSaleIdMeta,
        serverSaleId.isAcceptableOrUnknown(
          data['server_sale_id']!,
          _serverSaleIdMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {localId};
  @override
  PendingSale map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingSale(
      localId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}local_id'],
      )!,
      storeId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}store_id'],
      )!,
      totalAmount: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}total_amount'],
      )!,
      productsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}products_json'],
      )!,
      paymentMethod: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payment_method'],
      )!,
      notes: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}notes'],
      ),
      customerId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}customer_id'],
      ),
      customerName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}customer_name'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      syncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}synced_at'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      syncAttempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}sync_attempts'],
      )!,
      lastSyncError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_sync_error'],
      ),
      serverSaleId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}server_sale_id'],
      ),
    );
  }

  @override
  $PendingSalesTable createAlias(String alias) {
    return $PendingSalesTable(attachedDatabase, alias);
  }
}

class PendingSale extends DataClass implements Insertable<PendingSale> {
  final String localId;
  final String storeId;
  final double totalAmount;
  final String productsJson;
  final String paymentMethod;
  final String? notes;
  final String? customerId;
  final String? customerName;
  final DateTime createdAt;
  final DateTime? syncedAt;
  final String status;
  final int syncAttempts;
  final String? lastSyncError;
  final String? serverSaleId;
  const PendingSale({
    required this.localId,
    required this.storeId,
    required this.totalAmount,
    required this.productsJson,
    required this.paymentMethod,
    this.notes,
    this.customerId,
    this.customerName,
    required this.createdAt,
    this.syncedAt,
    required this.status,
    required this.syncAttempts,
    this.lastSyncError,
    this.serverSaleId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['local_id'] = Variable<String>(localId);
    map['store_id'] = Variable<String>(storeId);
    map['total_amount'] = Variable<double>(totalAmount);
    map['products_json'] = Variable<String>(productsJson);
    map['payment_method'] = Variable<String>(paymentMethod);
    if (!nullToAbsent || notes != null) {
      map['notes'] = Variable<String>(notes);
    }
    if (!nullToAbsent || customerId != null) {
      map['customer_id'] = Variable<String>(customerId);
    }
    if (!nullToAbsent || customerName != null) {
      map['customer_name'] = Variable<String>(customerName);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    if (!nullToAbsent || syncedAt != null) {
      map['synced_at'] = Variable<DateTime>(syncedAt);
    }
    map['status'] = Variable<String>(status);
    map['sync_attempts'] = Variable<int>(syncAttempts);
    if (!nullToAbsent || lastSyncError != null) {
      map['last_sync_error'] = Variable<String>(lastSyncError);
    }
    if (!nullToAbsent || serverSaleId != null) {
      map['server_sale_id'] = Variable<String>(serverSaleId);
    }
    return map;
  }

  PendingSalesCompanion toCompanion(bool nullToAbsent) {
    return PendingSalesCompanion(
      localId: Value(localId),
      storeId: Value(storeId),
      totalAmount: Value(totalAmount),
      productsJson: Value(productsJson),
      paymentMethod: Value(paymentMethod),
      notes: notes == null && nullToAbsent
          ? const Value.absent()
          : Value(notes),
      customerId: customerId == null && nullToAbsent
          ? const Value.absent()
          : Value(customerId),
      customerName: customerName == null && nullToAbsent
          ? const Value.absent()
          : Value(customerName),
      createdAt: Value(createdAt),
      syncedAt: syncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(syncedAt),
      status: Value(status),
      syncAttempts: Value(syncAttempts),
      lastSyncError: lastSyncError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastSyncError),
      serverSaleId: serverSaleId == null && nullToAbsent
          ? const Value.absent()
          : Value(serverSaleId),
    );
  }

  factory PendingSale.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingSale(
      localId: serializer.fromJson<String>(json['localId']),
      storeId: serializer.fromJson<String>(json['storeId']),
      totalAmount: serializer.fromJson<double>(json['totalAmount']),
      productsJson: serializer.fromJson<String>(json['productsJson']),
      paymentMethod: serializer.fromJson<String>(json['paymentMethod']),
      notes: serializer.fromJson<String?>(json['notes']),
      customerId: serializer.fromJson<String?>(json['customerId']),
      customerName: serializer.fromJson<String?>(json['customerName']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      syncedAt: serializer.fromJson<DateTime?>(json['syncedAt']),
      status: serializer.fromJson<String>(json['status']),
      syncAttempts: serializer.fromJson<int>(json['syncAttempts']),
      lastSyncError: serializer.fromJson<String?>(json['lastSyncError']),
      serverSaleId: serializer.fromJson<String?>(json['serverSaleId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'localId': serializer.toJson<String>(localId),
      'storeId': serializer.toJson<String>(storeId),
      'totalAmount': serializer.toJson<double>(totalAmount),
      'productsJson': serializer.toJson<String>(productsJson),
      'paymentMethod': serializer.toJson<String>(paymentMethod),
      'notes': serializer.toJson<String?>(notes),
      'customerId': serializer.toJson<String?>(customerId),
      'customerName': serializer.toJson<String?>(customerName),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'syncedAt': serializer.toJson<DateTime?>(syncedAt),
      'status': serializer.toJson<String>(status),
      'syncAttempts': serializer.toJson<int>(syncAttempts),
      'lastSyncError': serializer.toJson<String?>(lastSyncError),
      'serverSaleId': serializer.toJson<String?>(serverSaleId),
    };
  }

  PendingSale copyWith({
    String? localId,
    String? storeId,
    double? totalAmount,
    String? productsJson,
    String? paymentMethod,
    Value<String?> notes = const Value.absent(),
    Value<String?> customerId = const Value.absent(),
    Value<String?> customerName = const Value.absent(),
    DateTime? createdAt,
    Value<DateTime?> syncedAt = const Value.absent(),
    String? status,
    int? syncAttempts,
    Value<String?> lastSyncError = const Value.absent(),
    Value<String?> serverSaleId = const Value.absent(),
  }) => PendingSale(
    localId: localId ?? this.localId,
    storeId: storeId ?? this.storeId,
    totalAmount: totalAmount ?? this.totalAmount,
    productsJson: productsJson ?? this.productsJson,
    paymentMethod: paymentMethod ?? this.paymentMethod,
    notes: notes.present ? notes.value : this.notes,
    customerId: customerId.present ? customerId.value : this.customerId,
    customerName: customerName.present ? customerName.value : this.customerName,
    createdAt: createdAt ?? this.createdAt,
    syncedAt: syncedAt.present ? syncedAt.value : this.syncedAt,
    status: status ?? this.status,
    syncAttempts: syncAttempts ?? this.syncAttempts,
    lastSyncError: lastSyncError.present
        ? lastSyncError.value
        : this.lastSyncError,
    serverSaleId: serverSaleId.present ? serverSaleId.value : this.serverSaleId,
  );
  PendingSale copyWithCompanion(PendingSalesCompanion data) {
    return PendingSale(
      localId: data.localId.present ? data.localId.value : this.localId,
      storeId: data.storeId.present ? data.storeId.value : this.storeId,
      totalAmount: data.totalAmount.present
          ? data.totalAmount.value
          : this.totalAmount,
      productsJson: data.productsJson.present
          ? data.productsJson.value
          : this.productsJson,
      paymentMethod: data.paymentMethod.present
          ? data.paymentMethod.value
          : this.paymentMethod,
      notes: data.notes.present ? data.notes.value : this.notes,
      customerId: data.customerId.present
          ? data.customerId.value
          : this.customerId,
      customerName: data.customerName.present
          ? data.customerName.value
          : this.customerName,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      syncedAt: data.syncedAt.present ? data.syncedAt.value : this.syncedAt,
      status: data.status.present ? data.status.value : this.status,
      syncAttempts: data.syncAttempts.present
          ? data.syncAttempts.value
          : this.syncAttempts,
      lastSyncError: data.lastSyncError.present
          ? data.lastSyncError.value
          : this.lastSyncError,
      serverSaleId: data.serverSaleId.present
          ? data.serverSaleId.value
          : this.serverSaleId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingSale(')
          ..write('localId: $localId, ')
          ..write('storeId: $storeId, ')
          ..write('totalAmount: $totalAmount, ')
          ..write('productsJson: $productsJson, ')
          ..write('paymentMethod: $paymentMethod, ')
          ..write('notes: $notes, ')
          ..write('customerId: $customerId, ')
          ..write('customerName: $customerName, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('status: $status, ')
          ..write('syncAttempts: $syncAttempts, ')
          ..write('lastSyncError: $lastSyncError, ')
          ..write('serverSaleId: $serverSaleId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    localId,
    storeId,
    totalAmount,
    productsJson,
    paymentMethod,
    notes,
    customerId,
    customerName,
    createdAt,
    syncedAt,
    status,
    syncAttempts,
    lastSyncError,
    serverSaleId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingSale &&
          other.localId == this.localId &&
          other.storeId == this.storeId &&
          other.totalAmount == this.totalAmount &&
          other.productsJson == this.productsJson &&
          other.paymentMethod == this.paymentMethod &&
          other.notes == this.notes &&
          other.customerId == this.customerId &&
          other.customerName == this.customerName &&
          other.createdAt == this.createdAt &&
          other.syncedAt == this.syncedAt &&
          other.status == this.status &&
          other.syncAttempts == this.syncAttempts &&
          other.lastSyncError == this.lastSyncError &&
          other.serverSaleId == this.serverSaleId);
}

class PendingSalesCompanion extends UpdateCompanion<PendingSale> {
  final Value<String> localId;
  final Value<String> storeId;
  final Value<double> totalAmount;
  final Value<String> productsJson;
  final Value<String> paymentMethod;
  final Value<String?> notes;
  final Value<String?> customerId;
  final Value<String?> customerName;
  final Value<DateTime> createdAt;
  final Value<DateTime?> syncedAt;
  final Value<String> status;
  final Value<int> syncAttempts;
  final Value<String?> lastSyncError;
  final Value<String?> serverSaleId;
  final Value<int> rowid;
  const PendingSalesCompanion({
    this.localId = const Value.absent(),
    this.storeId = const Value.absent(),
    this.totalAmount = const Value.absent(),
    this.productsJson = const Value.absent(),
    this.paymentMethod = const Value.absent(),
    this.notes = const Value.absent(),
    this.customerId = const Value.absent(),
    this.customerName = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.syncedAt = const Value.absent(),
    this.status = const Value.absent(),
    this.syncAttempts = const Value.absent(),
    this.lastSyncError = const Value.absent(),
    this.serverSaleId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  PendingSalesCompanion.insert({
    required String localId,
    required String storeId,
    required double totalAmount,
    required String productsJson,
    required String paymentMethod,
    this.notes = const Value.absent(),
    this.customerId = const Value.absent(),
    this.customerName = const Value.absent(),
    required DateTime createdAt,
    this.syncedAt = const Value.absent(),
    this.status = const Value.absent(),
    this.syncAttempts = const Value.absent(),
    this.lastSyncError = const Value.absent(),
    this.serverSaleId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : localId = Value(localId),
       storeId = Value(storeId),
       totalAmount = Value(totalAmount),
       productsJson = Value(productsJson),
       paymentMethod = Value(paymentMethod),
       createdAt = Value(createdAt);
  static Insertable<PendingSale> custom({
    Expression<String>? localId,
    Expression<String>? storeId,
    Expression<double>? totalAmount,
    Expression<String>? productsJson,
    Expression<String>? paymentMethod,
    Expression<String>? notes,
    Expression<String>? customerId,
    Expression<String>? customerName,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? syncedAt,
    Expression<String>? status,
    Expression<int>? syncAttempts,
    Expression<String>? lastSyncError,
    Expression<String>? serverSaleId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (localId != null) 'local_id': localId,
      if (storeId != null) 'store_id': storeId,
      if (totalAmount != null) 'total_amount': totalAmount,
      if (productsJson != null) 'products_json': productsJson,
      if (paymentMethod != null) 'payment_method': paymentMethod,
      if (notes != null) 'notes': notes,
      if (customerId != null) 'customer_id': customerId,
      if (customerName != null) 'customer_name': customerName,
      if (createdAt != null) 'created_at': createdAt,
      if (syncedAt != null) 'synced_at': syncedAt,
      if (status != null) 'status': status,
      if (syncAttempts != null) 'sync_attempts': syncAttempts,
      if (lastSyncError != null) 'last_sync_error': lastSyncError,
      if (serverSaleId != null) 'server_sale_id': serverSaleId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  PendingSalesCompanion copyWith({
    Value<String>? localId,
    Value<String>? storeId,
    Value<double>? totalAmount,
    Value<String>? productsJson,
    Value<String>? paymentMethod,
    Value<String?>? notes,
    Value<String?>? customerId,
    Value<String?>? customerName,
    Value<DateTime>? createdAt,
    Value<DateTime?>? syncedAt,
    Value<String>? status,
    Value<int>? syncAttempts,
    Value<String?>? lastSyncError,
    Value<String?>? serverSaleId,
    Value<int>? rowid,
  }) {
    return PendingSalesCompanion(
      localId: localId ?? this.localId,
      storeId: storeId ?? this.storeId,
      totalAmount: totalAmount ?? this.totalAmount,
      productsJson: productsJson ?? this.productsJson,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      notes: notes ?? this.notes,
      customerId: customerId ?? this.customerId,
      customerName: customerName ?? this.customerName,
      createdAt: createdAt ?? this.createdAt,
      syncedAt: syncedAt ?? this.syncedAt,
      status: status ?? this.status,
      syncAttempts: syncAttempts ?? this.syncAttempts,
      lastSyncError: lastSyncError ?? this.lastSyncError,
      serverSaleId: serverSaleId ?? this.serverSaleId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (localId.present) {
      map['local_id'] = Variable<String>(localId.value);
    }
    if (storeId.present) {
      map['store_id'] = Variable<String>(storeId.value);
    }
    if (totalAmount.present) {
      map['total_amount'] = Variable<double>(totalAmount.value);
    }
    if (productsJson.present) {
      map['products_json'] = Variable<String>(productsJson.value);
    }
    if (paymentMethod.present) {
      map['payment_method'] = Variable<String>(paymentMethod.value);
    }
    if (notes.present) {
      map['notes'] = Variable<String>(notes.value);
    }
    if (customerId.present) {
      map['customer_id'] = Variable<String>(customerId.value);
    }
    if (customerName.present) {
      map['customer_name'] = Variable<String>(customerName.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (syncedAt.present) {
      map['synced_at'] = Variable<DateTime>(syncedAt.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (syncAttempts.present) {
      map['sync_attempts'] = Variable<int>(syncAttempts.value);
    }
    if (lastSyncError.present) {
      map['last_sync_error'] = Variable<String>(lastSyncError.value);
    }
    if (serverSaleId.present) {
      map['server_sale_id'] = Variable<String>(serverSaleId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingSalesCompanion(')
          ..write('localId: $localId, ')
          ..write('storeId: $storeId, ')
          ..write('totalAmount: $totalAmount, ')
          ..write('productsJson: $productsJson, ')
          ..write('paymentMethod: $paymentMethod, ')
          ..write('notes: $notes, ')
          ..write('customerId: $customerId, ')
          ..write('customerName: $customerName, ')
          ..write('createdAt: $createdAt, ')
          ..write('syncedAt: $syncedAt, ')
          ..write('status: $status, ')
          ..write('syncAttempts: $syncAttempts, ')
          ..write('lastSyncError: $lastSyncError, ')
          ..write('serverSaleId: $serverSaleId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $PendingSalesTable pendingSales = $PendingSalesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [pendingSales];
}

typedef $$PendingSalesTableCreateCompanionBuilder =
    PendingSalesCompanion Function({
      required String localId,
      required String storeId,
      required double totalAmount,
      required String productsJson,
      required String paymentMethod,
      Value<String?> notes,
      Value<String?> customerId,
      Value<String?> customerName,
      required DateTime createdAt,
      Value<DateTime?> syncedAt,
      Value<String> status,
      Value<int> syncAttempts,
      Value<String?> lastSyncError,
      Value<String?> serverSaleId,
      Value<int> rowid,
    });
typedef $$PendingSalesTableUpdateCompanionBuilder =
    PendingSalesCompanion Function({
      Value<String> localId,
      Value<String> storeId,
      Value<double> totalAmount,
      Value<String> productsJson,
      Value<String> paymentMethod,
      Value<String?> notes,
      Value<String?> customerId,
      Value<String?> customerName,
      Value<DateTime> createdAt,
      Value<DateTime?> syncedAt,
      Value<String> status,
      Value<int> syncAttempts,
      Value<String?> lastSyncError,
      Value<String?> serverSaleId,
      Value<int> rowid,
    });

class $$PendingSalesTableFilterComposer
    extends Composer<_$AppDatabase, $PendingSalesTable> {
  $$PendingSalesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get localId => $composableBuilder(
    column: $table.localId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get storeId => $composableBuilder(
    column: $table.storeId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get totalAmount => $composableBuilder(
    column: $table.totalAmount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get productsJson => $composableBuilder(
    column: $table.productsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get paymentMethod => $composableBuilder(
    column: $table.paymentMethod,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get customerId => $composableBuilder(
    column: $table.customerId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get customerName => $composableBuilder(
    column: $table.customerName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get syncAttempts => $composableBuilder(
    column: $table.syncAttempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastSyncError => $composableBuilder(
    column: $table.lastSyncError,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get serverSaleId => $composableBuilder(
    column: $table.serverSaleId,
    builder: (column) => ColumnFilters(column),
  );
}

class $$PendingSalesTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingSalesTable> {
  $$PendingSalesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get localId => $composableBuilder(
    column: $table.localId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get storeId => $composableBuilder(
    column: $table.storeId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get totalAmount => $composableBuilder(
    column: $table.totalAmount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get productsJson => $composableBuilder(
    column: $table.productsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get paymentMethod => $composableBuilder(
    column: $table.paymentMethod,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get notes => $composableBuilder(
    column: $table.notes,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get customerId => $composableBuilder(
    column: $table.customerId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get customerName => $composableBuilder(
    column: $table.customerName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get syncedAt => $composableBuilder(
    column: $table.syncedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get syncAttempts => $composableBuilder(
    column: $table.syncAttempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastSyncError => $composableBuilder(
    column: $table.lastSyncError,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get serverSaleId => $composableBuilder(
    column: $table.serverSaleId,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$PendingSalesTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingSalesTable> {
  $$PendingSalesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get localId =>
      $composableBuilder(column: $table.localId, builder: (column) => column);

  GeneratedColumn<String> get storeId =>
      $composableBuilder(column: $table.storeId, builder: (column) => column);

  GeneratedColumn<double> get totalAmount => $composableBuilder(
    column: $table.totalAmount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get productsJson => $composableBuilder(
    column: $table.productsJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get paymentMethod => $composableBuilder(
    column: $table.paymentMethod,
    builder: (column) => column,
  );

  GeneratedColumn<String> get notes =>
      $composableBuilder(column: $table.notes, builder: (column) => column);

  GeneratedColumn<String> get customerId => $composableBuilder(
    column: $table.customerId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get customerName => $composableBuilder(
    column: $table.customerName,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get syncedAt =>
      $composableBuilder(column: $table.syncedAt, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<int> get syncAttempts => $composableBuilder(
    column: $table.syncAttempts,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastSyncError => $composableBuilder(
    column: $table.lastSyncError,
    builder: (column) => column,
  );

  GeneratedColumn<String> get serverSaleId => $composableBuilder(
    column: $table.serverSaleId,
    builder: (column) => column,
  );
}

class $$PendingSalesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $PendingSalesTable,
          PendingSale,
          $$PendingSalesTableFilterComposer,
          $$PendingSalesTableOrderingComposer,
          $$PendingSalesTableAnnotationComposer,
          $$PendingSalesTableCreateCompanionBuilder,
          $$PendingSalesTableUpdateCompanionBuilder,
          (
            PendingSale,
            BaseReferences<_$AppDatabase, $PendingSalesTable, PendingSale>,
          ),
          PendingSale,
          PrefetchHooks Function()
        > {
  $$PendingSalesTableTableManager(_$AppDatabase db, $PendingSalesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingSalesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingSalesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingSalesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> localId = const Value.absent(),
                Value<String> storeId = const Value.absent(),
                Value<double> totalAmount = const Value.absent(),
                Value<String> productsJson = const Value.absent(),
                Value<String> paymentMethod = const Value.absent(),
                Value<String?> notes = const Value.absent(),
                Value<String?> customerId = const Value.absent(),
                Value<String?> customerName = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime?> syncedAt = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> syncAttempts = const Value.absent(),
                Value<String?> lastSyncError = const Value.absent(),
                Value<String?> serverSaleId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PendingSalesCompanion(
                localId: localId,
                storeId: storeId,
                totalAmount: totalAmount,
                productsJson: productsJson,
                paymentMethod: paymentMethod,
                notes: notes,
                customerId: customerId,
                customerName: customerName,
                createdAt: createdAt,
                syncedAt: syncedAt,
                status: status,
                syncAttempts: syncAttempts,
                lastSyncError: lastSyncError,
                serverSaleId: serverSaleId,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String localId,
                required String storeId,
                required double totalAmount,
                required String productsJson,
                required String paymentMethod,
                Value<String?> notes = const Value.absent(),
                Value<String?> customerId = const Value.absent(),
                Value<String?> customerName = const Value.absent(),
                required DateTime createdAt,
                Value<DateTime?> syncedAt = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<int> syncAttempts = const Value.absent(),
                Value<String?> lastSyncError = const Value.absent(),
                Value<String?> serverSaleId = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => PendingSalesCompanion.insert(
                localId: localId,
                storeId: storeId,
                totalAmount: totalAmount,
                productsJson: productsJson,
                paymentMethod: paymentMethod,
                notes: notes,
                customerId: customerId,
                customerName: customerName,
                createdAt: createdAt,
                syncedAt: syncedAt,
                status: status,
                syncAttempts: syncAttempts,
                lastSyncError: lastSyncError,
                serverSaleId: serverSaleId,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$PendingSalesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $PendingSalesTable,
      PendingSale,
      $$PendingSalesTableFilterComposer,
      $$PendingSalesTableOrderingComposer,
      $$PendingSalesTableAnnotationComposer,
      $$PendingSalesTableCreateCompanionBuilder,
      $$PendingSalesTableUpdateCompanionBuilder,
      (
        PendingSale,
        BaseReferences<_$AppDatabase, $PendingSalesTable, PendingSale>,
      ),
      PendingSale,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$PendingSalesTableTableManager get pendingSales =>
      $$PendingSalesTableTableManager(_db, _db.pendingSales);
}
