// Syntax inventory only. No Firebase initialization, execution or options output.
// Uses the analyzer already resolved by this checkout; do not run pub get.
// ignore_for_file: depend_on_referenced_packages
import 'dart:convert';
import 'dart:io';
import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

const sensitive = {
  'Firebase', 'FirebaseApp', 'FirebaseAuth', 'FirebaseFirestore',
  'FirebaseFunctions', 'initializeApp', 'getApp', 'getApps', 'getAuth',
  'getFirestore', 'getFunctions', 'connectAuthEmulator',
  'connectFirestoreEmulator', 'connectFunctionsEmulator',
  'useAuthEmulator', 'useFirestoreEmulator', 'useFunctionsEmulator',
  'httpsCallable', 'httpsCallableFromUrl', 'httpsCallableFromUri',
  'tenantId', 'databaseId', 'region', 'settings', 'host', 'endpoint',
  'authEndpoint', 'firestoreEndpoint', 'functionsEndpoint',
};

class Inventory extends RecursiveAstVisitor<void> {
  final List<Map<String, Object?>> occurrences = [];
  final dynamic lines;
  Inventory(this.lines);
  void flag(AstNode node, String operation) {
    final loc = lines.getLocation(node.offset);
    occurrences.add({
      'line': loc.lineNumber, 'column': loc.columnNumber,
      'operation': operation, 'syntax': node.runtimeType.toString(),
      'evidenceKind': 'conservative SDK syntax; alias binding still reviewed',
    });
  }
  bool sdk(String text) => RegExp(
    r'(^|\.)(Firebase|FirebaseAuth|FirebaseFirestore|FirebaseFunctions)$',
  ).hasMatch(text);
  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (node.methodName.name == 'app' &&
        sdk(node.target?.toSource() ?? '') &&
        node.argumentList.arguments.isEmpty) {
      flag(node, 'prohibited-default');
    }
    if (node.methodName.name == 'instanceFor' &&
        sdk(node.target?.toSource() ?? '')) {
      final apps = node.argumentList.arguments.whereType<NamedExpression>()
          .where((a) => a.name.label.name == 'app').toList();
      if (apps.length != 1 || apps.single.expression.toSource() != 'app') {
        flag(node, 'unproven-app-argument');
      }
    }
    super.visitMethodInvocation(node);
  }
  @override
  void visitPrefixedIdentifier(PrefixedIdentifier node) {
    if (node.identifier.name == 'instance' && sdk(node.prefix.name)) {
      flag(node, 'prohibited-default');
    }
    super.visitPrefixedIdentifier(node);
  }
  @override
  void visitPropertyAccess(PropertyAccess node) {
    if (node.propertyName.name == 'instance' &&
        sdk(node.target?.toSource() ?? '')) {
      flag(node, 'prohibited-default');
    }
    super.visitPropertyAccess(node);
  }
  @override
  void visitNamedType(NamedType node) {
    if (sensitive.contains(node.name.lexeme)) {
      final loc = lines.getLocation(node.offset);
      occurrences.add({
        'line': loc.lineNumber, 'column': loc.columnNumber,
        'operation': node.name.lexeme, 'syntax': 'NamedType',
        'evidenceKind': 'type reference only; binding unresolved',
      });
    }
    super.visitNamedType(node);
  }
  @override
  void visitSimpleIdentifier(SimpleIdentifier node) {
    if (sensitive.contains(node.name)) {
      final loc = lines.getLocation(node.offset);
      occurrences.add({
        'line': loc.lineNumber, 'column': loc.columnNumber,
        'operation': node.name, 'syntax': node.parent.runtimeType.toString(),
        // This is a syntax occurrence, NOT a proven executable invocation.
        'evidenceKind': 'AST identifier; binding/flow unresolved',
      });
    }
    super.visitSimpleIdentifier(node);
  }
  @override
  void visitSimpleStringLiteral(SimpleStringLiteral node) {
    if (RegExp(r'firebase|httpsCallable|Emulator|initializeApp',
        caseSensitive: false).hasMatch(node.value)) {
      final loc = lines.getLocation(node.offset);
      occurrences.add({
        'line': loc.lineNumber, 'column': loc.columnNumber,
        'operation': 'text-or-interop', 'syntax': 'StringLiteral',
        'evidenceKind': 'text only; possible import/JS; never proof of call',
      });
    }
    super.visitSimpleStringLiteral(node);
  }
}

Future<void> main() async {
  final input = jsonDecode(await stdin.transform(utf8.decoder).join()) as List;
  final results = <Map<String, Object?>>[];
  for (final value in input) {
    final file = value as String;
    try {
      final content = File(file).readAsStringSync();
      final parsed = parseString(content: content, path: file,
          throwIfDiagnostics: false);
      final visitor = Inventory(parsed.lineInfo);
      parsed.unit.accept(visitor);
      final directives = <Map<String, Object?>>[];
      for (final directive in parsed.unit.directives) {
        if (directive is UriBasedDirective) {
          final uris = <String?>[directive.uri.stringValue];
          if (directive is ImportDirective) {
            uris.addAll(directive.configurations.map((c) => c.uri.stringValue));
          } else if (directive is ExportDirective) {
            uris.addAll(directive.configurations.map((c) => c.uri.stringValue));
          }
          directives.add({
            'kind': directive.runtimeType.toString(), 'uris': uris,
            'line': parsed.lineInfo.getLocation(directive.offset).lineNumber,
            'alias': directive is ImportDirective ? directive.prefix?.name : null,
          });
        } else if (directive is PartOfDirective) {
          directives.add({'kind': 'partOf', 'uris': <String>[],
            'line': parsed.lineInfo.getLocation(directive.offset).lineNumber});
        }
      }
      results.add({
        'file': file, 'directives': directives,
        'occurrences': visitor.occurrences,
        'diagnostics': parsed.errors.map((e) => {
          'offset': e.offset, 'code': e.diagnosticCode.name,
        }).toList(),
      });
    } catch (_) {
      results.add({'file': file, 'error': 'unreadable-or-unparseable'});
    }
  }
  stdout.write(jsonEncode(results));
}
