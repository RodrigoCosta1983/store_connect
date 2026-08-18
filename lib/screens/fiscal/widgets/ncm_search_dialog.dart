// ============================================================================
// ARQUIVO: ncm_search_dialog.dart
// ============================================================================
//
// OBJETIVO:
// Exibir uma janela de pesquisa e seleção de códigos NCM para produtos.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Receber um termo digitado pelo usuário.
// - Pesquisar códigos NCM por código ou descrição.
// - Exibir os resultados de forma amigável.
// - Permitir selecionar um NCM.
// - Retornar o NCM selecionado para o cadastro do produto.
// - Adaptar o tamanho do diálogo para celulares, tablets e desktop.
//
// REGRA DE PLANO:
// - Este componente faz parte do módulo fiscal.
// - Atualmente é utilizado somente por lojas com Plano Business ativo.
//
// ARQUITETURA:
// - Este arquivo cuida SOMENTE da interface da pesquisa.
// - A fonte dos dados NCM é recebida através da função "onSearch".
// - O widget não acessa diretamente Firestore, API ou Cloud Functions.
//
// INTEGRAÇÃO FUTURA:
// - A pesquisa será conectada à nossa base NCM.
// - A base poderá ser sincronizada com a tabela oficial vigente.
// - O backend ficará responsável pela consulta e atualização da base.
//
// FLUXO:
//
// Cadastro Produto Business
//        ↓
// Botão pesquisar NCM
//        ↓
// NcmSearchDialog
//        ↓
// onSearch(query)
//        ↓
// Backend / Base NCM
//        ↓
// Lista de resultados
//        ↓
// Usuário seleciona
//        ↓
// NCM retorna para o cadastro
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
// - Não colocar uma tabela NCM fixa dentro deste arquivo.
// - Não colocar credenciais ou tokens neste widget.
// - Não realizar comunicação direta com APIs fiscais aqui.
// - Manter a fonte de dados separada da interface.
// - Manter o layout responsivo para evitar RenderFlex overflow.
//
// OBSERVAÇÃO FISCAL:
// - A busca auxilia o usuário na localização da NCM.
// - A classificação deve ser conferida pelo responsável fiscal/contador.
//
// ============================================================================

import 'package:flutter/material.dart';

// ============================================================================
// MODELO DE RESULTADO NCM
// ============================================================================
//
// Representa apenas os dados necessários para mostrar uma opção encontrada
// durante a pesquisa.
//
// ============================================================================

class NcmSearchResult {
  final String codigo;
  final String descricao;

  const NcmSearchResult({
    required this.codigo,
    required this.descricao,
  });

  // ==========================================================================
  // CÓDIGO FORMATADO
  // ==========================================================================
  //
  // Exemplo:
  //
  // 61091000
  //
  // será exibido como:
  //
  // 6109.10.00
  //
  // O valor original continua sem pontos.
  //
  // ==========================================================================

  String get codigoFormatado {
    final clean =
    codigo.replaceAll(RegExp(r'\D'), '');

    if (clean.length != 8) {
      return codigo;
    }

    return '${clean.substring(0, 4)}.'
        '${clean.substring(4, 6)}.'
        '${clean.substring(6, 8)}';
  }
}

// ============================================================================
// DIÁLOGO DE PESQUISA NCM
// ============================================================================

class NcmSearchDialog extends StatefulWidget {
  // ==========================================================================
  // FUNÇÃO DE PESQUISA
  // ==========================================================================
  //
  // Este widget não sabe de onde os dados vêm.
  //
  // Quem abrir o diálogo fornece a função "onSearch".
  //
  // Futuramente essa função poderá consultar:
  //
  // - Cloud Function
  // - Firestore
  // - Base NCM própria
  // - Outro serviço interno
  //
  // ==========================================================================

  final Future<List<NcmSearchResult>> Function(
      String query,
      ) onSearch;

  // Termo inicial opcional.
  //
  // Podemos, por exemplo, abrir a busca já preenchida
  // com o nome do produto.

  final String? initialQuery;

  const NcmSearchDialog({
    super.key,
    required this.onSearch,
    this.initialQuery,
  });

  @override
  State<NcmSearchDialog> createState() =>
      _NcmSearchDialogState();
}

// ============================================================================
// ESTADO DO DIÁLOGO
// ============================================================================

class _NcmSearchDialogState extends State<NcmSearchDialog> {
  // ==========================================================================
  // CONTROLLER
  // ==========================================================================

  final TextEditingController _searchController =
  TextEditingController();

  // ==========================================================================
  // ESTADOS DA INTERFACE
  // ==========================================================================

  bool _isLoading = false;

  bool _hasSearched = false;

  String? _errorMessage;

  List<NcmSearchResult> _results = [];

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    // Caso o cadastro envie o nome do produto,
    // abrimos a pesquisa já preenchida.

    if (widget.initialQuery != null &&
        widget.initialQuery!.trim().isNotEmpty) {
      _searchController.text =
          widget.initialQuery!.trim();
    }
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _searchController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // EXECUTA A PESQUISA
  // ==========================================================================

  Future<void> _search() async {
    final query =
    _searchController.text.trim();

    // Evita pesquisas muito genéricas.

    if (query.length < 2) {
      setState(() {
        _errorMessage =
        'Digite pelo menos 2 caracteres para pesquisar.';
      });

      return;
    }

    // Fecha o teclado para liberar mais espaço na tela.

    FocusScope.of(context).unfocus();

    setState(() {
      _isLoading = true;

      _hasSearched = true;

      _errorMessage = null;

      _results = [];
    });

    try {
      // A fonte real da pesquisa vem de fora do widget.

      final results =
      await widget.onSearch(query);

      if (!mounted) return;

      setState(() {
        _results = results;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _errorMessage =
        'Não foi possível pesquisar a NCM.';
      });

      debugPrint(
        '❌ Erro ao pesquisar NCM: $e',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ==========================================================================
  // SELECIONA UMA NCM
  // ==========================================================================

  void _selectNcm(
      NcmSearchResult result,
      ) {
    // Fecha o diálogo retornando o resultado selecionado.

    Navigator.of(context).pop(result);
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    // =========================================================================
    // TAMANHO RESPONSIVO DO DIÁLOGO
    // =========================================================================
    //
    // Aqui corrigimos o problema:
    //
    // RenderFlex overflowed by XX pixels on the bottom.
    //
    // Antes o diálogo tinha:
    //
    // height: 500
    //
    // Agora calculamos a altura de acordo com o espaço disponível.
    //
    // Também levamos em consideração a altura ocupada pelo teclado.
    //
    // =========================================================================

    final mediaQuery =
    MediaQuery.of(context);

    final screenWidth =
        mediaQuery.size.width;

    final screenHeight =
        mediaQuery.size.height;

    final keyboardHeight =
        mediaQuery.viewInsets.bottom;

    // Espaço realmente disponível considerando o teclado.

    final availableHeight =
        screenHeight - keyboardHeight;

    // =========================================================================
    // LARGURA
    // =========================================================================

    final dialogWidth =
    screenWidth > 650
        ? 600.0
        : screenWidth * 0.92;

    // =========================================================================
    // ALTURA
    // =========================================================================
    //
    // Em telas grandes:
    // até 560px.
    //
    // Em telas menores:
    // utiliza uma porcentagem do espaço disponível.
    //
    // =========================================================================

    final dialogHeight =
    availableHeight > 700
        ? 560.0
        : availableHeight * 0.68;

    // =========================================================================
    // ALERT DIALOG
    // =========================================================================

    return AlertDialog(
      // =======================================================================
      // PADDING DO TÍTULO
      // =======================================================================

      titlePadding:
      const EdgeInsets.fromLTRB(
        20,
        20,
        12,
        8,
      ),

      // =======================================================================
      // PADDING DO CONTEÚDO
      // =======================================================================

      contentPadding:
      const EdgeInsets.fromLTRB(
        20,
        8,
        20,
        16,
      ),

      // =======================================================================
      // TÍTULO
      // =======================================================================

      title: Row(
        children: [
          const Icon(
            Icons.search,
            color: Colors.deepPurple,
          ),

          const SizedBox(
            width: 10,
          ),

          const Expanded(
            child: Text(
              'Pesquisar NCM',
              style: TextStyle(
                fontWeight:
                FontWeight.bold,
              ),
            ),
          ),

          IconButton(
            tooltip: 'Fechar',

            onPressed: () {
              Navigator.of(context).pop();
            },

            icon: const Icon(
              Icons.close,
            ),
          ),
        ],
      ),

      // =======================================================================
      // CONTEÚDO PRINCIPAL
      // =======================================================================

      content: SizedBox(
        width: dialogWidth,

        // IMPORTANTE:
        // Agora usamos a altura calculada dinamicamente.

        height: dialogHeight,

        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.stretch,

          children: [
            // ================================================================
            // TEXTO DE ORIENTAÇÃO
            // ================================================================

            Text(
              'Pesquise pelo nome do produto, material '
                  'ou diretamente pelo código NCM.',
              style: TextStyle(
                color:
                Colors.grey.shade600,
                fontSize: 13,
              ),
            ),

            const SizedBox(
              height: 10,
            ),

            // ================================================================
            // CAMPO DE PESQUISA
            // ================================================================

            TextField(
              controller:
              _searchController,

              textInputAction:
              TextInputAction.search,

              autofocus: true,

              // Pressionar "Pesquisar" no teclado
              // executa a busca.

              onSubmitted: (_) =>
                  _search(),

              decoration:
              InputDecoration(
                hintText:
                'Ex.: camiseta algodão ou 61091000',

                prefixIcon:
                const Icon(
                  Icons.search,
                ),

                // ============================================================
                // BOTÃO LIMPAR
                // ============================================================

                suffixIcon:
                _searchController
                    .text
                    .isNotEmpty
                    ? IconButton(
                  tooltip:
                  'Limpar',

                  onPressed: () {
                    _searchController
                        .clear();

                    setState(() {
                      _results = [];

                      _hasSearched =
                      false;

                      _errorMessage =
                      null;
                    });
                  },

                  icon:
                  const Icon(
                    Icons.clear,
                  ),
                )
                    : null,

                border:
                OutlineInputBorder(
                  borderRadius:
                  BorderRadius.circular(
                    12,
                  ),
                ),
              ),

              // Atualiza somente para controlar
              // a exibição do botão de limpar.

              onChanged: (_) {
                setState(() {});
              },
            ),

            const SizedBox(
              height: 10,
            ),

            // ================================================================
            // BOTÃO PESQUISAR
            // ================================================================

            ElevatedButton.icon(
              onPressed:
              _isLoading
                  ? null
                  : _search,

              icon: const Icon(
                Icons.manage_search,
              ),

              label: const Text(
                'Pesquisar',
              ),

              style:
              ElevatedButton.styleFrom(
                padding:
                const EdgeInsets.symmetric(
                  vertical: 12,
                ),
              ),
            ),

            const SizedBox(
              height: 10,
            ),

            // ================================================================
            // AVISO FISCAL
            // ================================================================

            Container(
              padding:
              const EdgeInsets.all(
                10,
              ),

              decoration:
              BoxDecoration(
                color: Colors.amber
                    .withOpacity(
                  0.08,
                ),

                borderRadius:
                BorderRadius.circular(
                  10,
                ),

                border: Border.all(
                  color: Colors.amber
                      .withOpacity(
                    0.30,
                  ),
                ),
              ),

              child: const Row(
                crossAxisAlignment:
                CrossAxisAlignment.start,

                children: [
                  Icon(
                    Icons.info_outline,
                    size: 18,
                    color: Colors.amber,
                  ),

                  SizedBox(
                    width: 8,
                  ),

                  Expanded(
                    child: Text(
                      'A busca auxilia na localização da NCM. '
                          'Confirme a classificação fiscal com o '
                          'responsável fiscal ou contador da empresa.',
                      style: TextStyle(
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(
              height: 8,
            ),

            // ================================================================
            // ÁREA DOS RESULTADOS
            // ================================================================
            //
            // Esta área ocupa automaticamente todo o espaço restante.
            //
            // Não usamos SingleChildScrollView no Column inteiro porque
            // a lista de resultados já possui sua própria rolagem.
            //
            // ================================================================

            Expanded(
              child: _buildResults(),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // CONSTRÓI A ÁREA DE RESULTADOS
  // ==========================================================================

  Widget _buildResults() {
    // =========================================================================
    // CARREGANDO
    // =========================================================================

    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize:
          MainAxisSize.min,

          children: [
            CircularProgressIndicator(),

            SizedBox(
              height: 12,
            ),

            Text(
              'Consultando NCM...',
            ),
          ],
        ),
      );
    }

    // =========================================================================
    // ERRO
    // =========================================================================

    if (_errorMessage != null) {
      return Center(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize:
            MainAxisSize.min,

            children: [
              const Icon(
                Icons.error_outline,
                size: 42,
                color: Colors.red,
              ),

              const SizedBox(
                height: 8,
              ),

              Text(
                _errorMessage!,
                textAlign:
                TextAlign.center,
              ),

              const SizedBox(
                height: 8,
              ),

              TextButton.icon(
                onPressed:
                _search,

                icon:
                const Icon(
                  Icons.refresh,
                ),

                label:
                const Text(
                  'Tentar novamente',
                ),
              ),
            ],
          ),
        ),
      );
    }

    // =========================================================================
    // AINDA NÃO PESQUISOU
    // =========================================================================

    if (!_hasSearched) {
      return Center(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize:
            MainAxisSize.min,

            children: [
              Icon(
                Icons
                    .inventory_2_outlined,

                size: 48,

                color: Colors
                    .grey
                    .shade400,
              ),

              const SizedBox(
                height: 10,
              ),

              Text(
                'Digite uma descrição para localizar a classificação.',
                textAlign:
                TextAlign.center,
                style: TextStyle(
                  color: Colors
                      .grey
                      .shade600,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // =========================================================================
    // NENHUM RESULTADO
    // =========================================================================

    if (_results.isEmpty) {
      return Center(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize:
            MainAxisSize.min,

            children: [
              Icon(
                Icons.search_off,

                size: 46,

                color: Colors
                    .grey
                    .shade400,
              ),

              const SizedBox(
                height: 8,
              ),

              const Text(
                'Nenhum NCM encontrado.',
              ),

              const SizedBox(
                height: 4,
              ),

              Text(
                'Tente pesquisar com menos palavras '
                    'ou utilizar somente o material principal.',
                textAlign:
                TextAlign.center,
                style: TextStyle(
                  color: Colors
                      .grey
                      .shade600,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // =========================================================================
    // LISTA DE RESULTADOS
    // =========================================================================

    return ListView.separated(
      itemCount:
      _results.length,

      separatorBuilder:
          (_, __) =>
      const Divider(
        height: 1,
      ),

      itemBuilder:
          (context, index) {
        final result =
        _results[index];

        return ListTile(
          contentPadding:
          const EdgeInsets.symmetric(
            horizontal: 4,
            vertical: 4,
          ),

          // ===================================================================
          // ÍCONE
          // ===================================================================

          leading:
          CircleAvatar(
            backgroundColor:
            Colors.deepPurple
                .withOpacity(
              0.10,
            ),

            child:
            const Icon(
              Icons.tag,
              color:
              Colors.deepPurple,
            ),
          ),

          // ===================================================================
          // CÓDIGO
          // ===================================================================

          title:
          Text(
            result.codigoFormatado,

            style:
            const TextStyle(
              fontWeight:
              FontWeight.bold,
            ),
          ),

          // ===================================================================
          // DESCRIÇÃO
          // ===================================================================

          subtitle:
          Padding(
            padding:
            const EdgeInsets.only(
              top: 4,
            ),

            child: Text(
              result.descricao,
            ),
          ),

          // ===================================================================
          // INDICADOR DE SELEÇÃO
          // ===================================================================

          trailing:
          const Icon(
            Icons.chevron_right,
          ),

          // ===================================================================
          // SELECIONA
          // ===================================================================

          onTap: () {
            _selectNcm(
              result,
            );
          },
        );
      },
    );
  }
}