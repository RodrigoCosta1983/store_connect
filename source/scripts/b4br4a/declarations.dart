// Supplement to the preserved R3 parser: declarations are not invocations.
// ignore_for_file: depend_on_referenced_packages
import 'dart:convert';
import 'dart:io';
import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';

class Declarations extends RecursiveAstVisitor<void> {
  final List<Map<String, Object?>> members = [];
  @override
  void visitMethodDeclaration(MethodDeclaration node) {
    members.add({'operation': node.isSetter ? 'declared-setter' : node.name.lexeme,
      'offset': node.offset, 'syntax': 'MethodDeclaration',
      'evidenceKind': 'declared capability only; not an invocation'});
    super.visitMethodDeclaration(node);
  }
  @override
  void visitFunctionDeclaration(FunctionDeclaration node) {
    members.add({'operation': node.isSetter ? 'declared-setter' : node.name.lexeme,
      'offset': node.offset, 'syntax': 'FunctionDeclaration',
      'evidenceKind': 'declared capability only; not an invocation'});
    super.visitFunctionDeclaration(node);
  }
}

Future<void> main() async {
  final files = jsonDecode(await stdin.transform(utf8.decoder).join()) as List;
  final output = <Map<String, Object?>>[];
  for (final file in files.cast<String>()) {
    try {
      final parsed = parseString(content: File(file).readAsStringSync(),
          path: file, throwIfDiagnostics: false);
      final visitor = Declarations();
      parsed.unit.accept(visitor);
      output.add({'file': file, 'members': visitor.members.map((member) {
        final loc = parsed.lineInfo.getLocation(member['offset'] as int);
        return {...member, 'line': loc.lineNumber, 'column': loc.columnNumber};
      }).toList()});
    } catch (_) {
      output.add({'file': file, 'error': 'Declaration analysis unavailable'});
    }
  }
  stdout.write(jsonEncode(output));
}
