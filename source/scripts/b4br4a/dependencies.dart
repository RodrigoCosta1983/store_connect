// Inventory of installed dependency metadata only, not source admission.
// ignore_for_file: depend_on_referenced_packages
import 'dart:convert';
import 'dart:io';
import 'package:yaml/yaml.dart';

void main() {
  final configUri = File('.dart_tool/package_config.json').absolute.uri;
  final config = jsonDecode(File.fromUri(configUri).readAsStringSync()) as Map;
  final roots = ['firebase_core', 'firebase_auth', 'cloud_firestore', 'cloud_functions'];
  final queue = [...roots];
  final packages = <Map<String, Object?>>[];
  final edges = <Map<String, String>>[];
  final seen = <String>{};
  while (queue.isNotEmpty) {
    final name = queue.removeAt(0);
    if (!seen.add(name)) continue;
    final descriptors = (config['packages'] as List)
        .where((p) => p['name'] == name).toList();
    if (descriptors.length != 1) {
      packages.add({'name': name, 'status': 'INDETERMINADO', 'reason': 'Unresolved package'});
      continue;
    }
    final uri = configUri.resolve('${descriptors.single['rootUri']}/');
    try {
      final spec = loadYaml(File.fromUri(uri.resolve('pubspec.yaml')).readAsStringSync()) as YamlMap;
      final deps = spec['dependencies'] as YamlMap?;
      final plugin = (spec['flutter'] as YamlMap?)?['plugin'];
      packages.add({'name': name, 'version': spec['version']?.toString(),
        'rootUri': uri.toString(), 'status': 'INDETERMINADO/NOT_ADMITTED',
        'review': 'Metadata only; source/platform/plugin/JS closure needs independent review',
        'declaresPlugin': plugin != null});
      for (final dependency in deps?.keys ?? <String>[]) {
        edges.add({'from': name, 'to': dependency.toString()});
        queue.add(dependency.toString());
      }
    } catch (_) {
      packages.add({'name': name, 'rootUri': uri.toString(),
        'status': 'INDETERMINADO', 'reason': 'Metadata unreadable'});
    }
  }
  final result = {'scope': 'Future R4-B dependencies; NOT part of inert R4-A module',
    'roots': roots, 'packages': packages, 'edges': edges,
    'status': 'INDETERMINADO/BLOCKED', 'admitted': <String>[]};
  Directory('build/b4br4a').createSync(recursive: true);
  File('build/b4br4a/resolved-dependencies.json')
      .writeAsStringSync('${const JsonEncoder.withIndent('  ').convert(result)}\n');
  stdout.writeln('Future dependency metadata: ${packages.length} packages, ${edges.length} edges; none admitted.');
}
