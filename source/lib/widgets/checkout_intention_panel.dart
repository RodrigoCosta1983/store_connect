import 'package:flutter/material.dart';
import '../services/checkout_coordinator_ports.dart';
import '../services/checkout_intention_reader.dart';
import '../services/checkout_presentation_controller.dart';

String checkoutPhaseMessage(
  CheckoutCoordinatorState state,
) => switch (state.phase) {
  CheckoutCoordinatorPhase.contextUnavailable =>
    'Contexto carregando ou indisponível.',
  CheckoutCoordinatorPhase.ready =>
    'Pronto para preparação local. Esta prévia oferece leitura e retomada.',
  CheckoutCoordinatorPhase.preparing =>
    'Preparando ou recuperando intenção local…',
  CheckoutCoordinatorPhase.prepared => 'Intenção preparada, ainda não enviada.',
  CheckoutCoordinatorPhase.recoverable =>
    'Intenção recuperável. Sem confirmação comercial.',
  CheckoutCoordinatorPhase.unknown =>
    'Resultado ainda não confirmado. Não crie outra venda para resolver esta intenção.',
  CheckoutCoordinatorPhase.conflict =>
    state.candidatePersisted
        ? 'Conflito: intenção original preservada. Candidato diagnóstico salvo.'
        : 'Conflito: intenção original preservada. Candidato apenas em memória, sem prova de gravação.',
  CheckoutCoordinatorPhase.integrityBlocked =>
    'Registro incompleto ou corrompido. Retomada bloqueada.',
  CheckoutCoordinatorPhase.storageUnavailable =>
    'Armazenamento indisponível. Nenhuma operação comercial autorizada.',
  CheckoutCoordinatorPhase.contextReplaced =>
    'Contexto substituído. Retorne à conta e loja de origem para consultar suas intenções.',
};

String checkoutCategoryMessage(
  CheckoutIntentionCategory category,
) => switch (category) {
  CheckoutIntentionCategory.v2Recoverable =>
    'V2 — referência íntegra recuperável',
  CheckoutIntentionCategory.v2Unknown => 'V2 — resultado ainda não confirmado',
  CheckoutIntentionCategory.v1Historical => 'V1 — histórico, sem retomada V2',
  CheckoutIntentionCategory.v1HistoricalGap =>
    'V1 — lacuna histórica bloqueada',
  CheckoutIntentionCategory.orphanCandidate =>
    'Candidato órfão — não representa venda confirmada',
  CheckoutIntentionCategory.bindingWithoutLedger =>
    'Associação sem registro canônico',
  CheckoutIntentionCategory.canonicalWithoutAssociation =>
    'Registro canônico sem associação',
  CheckoutIntentionCategory.corruptedMetadata => 'Metadados corrompidos',
  CheckoutIntentionCategory.unknownVersion => 'Versão desconhecida',
  CheckoutIntentionCategory.referenceChanged =>
    'Referência alterada durante a leitura',
  CheckoutIntentionCategory.storageUnavailable => 'Armazenamento indisponível',
  CheckoutIntentionCategory.enumerationPartial => 'Enumeração parcial',
  CheckoutIntentionCategory.contextMismatch =>
    'Origem incompatível — retorne à conta e loja originais',
  CheckoutIntentionCategory.missingCandidate => 'Candidato original ausente',
  CheckoutIntentionCategory.diagnosticCandidate =>
    'Candidato diagnóstico preservado',
};

/// No route registration or automatic loading. Caller owns the controller;
/// closing/reopening a preview must dispose it and construct a fresh instance.
class CheckoutIntentionPanel extends StatelessWidget {
  final CheckoutPresentationController controller;
  const CheckoutIntentionPanel({super.key, required this.controller});
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final entries = controller.entries;
      final groups = <String, List<CheckoutIntentionEntry>>{
        'Intenções V2': [],
        'Histórico V1': [],
        'Registros bloqueados e diagnósticos': [],
      };
      for (final entry in entries) {
        final group = entry.metadataVersion == 1
            ? 'Histórico V1'
            : entry.canSelectV2
            ? 'Intenções V2'
            : 'Registros bloqueados e diagnósticos';
        groups[group]!.add(entry);
      }
      final listingMessage = switch (controller.listing) {
        CheckoutListingPhase.idle =>
          'Consulte as intenções locais quando desejar.',
        CheckoutListingPhase.loading => 'Lendo intenções locais…',
        CheckoutListingPhase.complete =>
          entries.isEmpty
              ? 'Nenhuma intenção encontrada nesta leitura. Isso não prova ausência de operação remota.'
              : 'Listagem completa nesta leitura; sem snapshot global.',
        CheckoutListingPhase.partial =>
          'Listagem parcial. Ausências não são conclusivas.',
        CheckoutListingPhase.unavailable =>
          'Falha na enumeração. Armazenamento indisponível.',
        CheckoutListingPhase.contextInvalid =>
          'Listagem invalidada pela mudança de contexto.',
      };
      return FocusTraversalGroup(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Intenções locais do checkout',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const Text('Prévia isolada • sem envio comercial'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Semantics(
                  liveRegion: true,
                  child: Text(checkoutPhaseMessage(controller.state)),
                ),
              ),
            ),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  onPressed: controller.busy ? null : controller.refreshContext,
                  child: const Text('Verificar contexto local'),
                ),
                FilledButton(
                  onPressed: controller.canRefresh
                      ? () => controller.refresh()
                      : null,
                  child: const Text('Atualizar intenções'),
                ),
              ],
            ),
            if (controller.busy)
              Semantics(
                label: 'Leitura local em andamento',
                child: const LinearProgressIndicator(),
              ),
            Semantics(liveRegion: true, child: Text(listingMessage)),
            if (controller.notice != null)
              Semantics(liveRegion: true, child: Text(controller.notice!)),
            for (final group in groups.entries)
              if (group.value.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 20, bottom: 8),
                  child: Text(
                    group.key,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                for (var index = 0; index < group.value.length; index++)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Registro local ${index + 1}'),
                          for (final category in group.value[index].categories)
                            Text(checkoutCategoryMessage(category)),
                          if (group.value[index].canSelectV2)
                            OutlinedButton(
                              onPressed:
                                  controller.canSelect(group.value[index])
                                  ? () => controller.select(group.value[index])
                                  : null,
                              child: const Text(
                                'Selecionar e retomar leitura local',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
          ],
        ),
      );
    },
  );
}
