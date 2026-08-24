// ============================================================================
// STORE CONNECT - NOVA VENDA / PDV / EXPERIÊNCIA OFFLINE
// ============================================================================
//
// Arquivo:
//   lib/screens/sales/new_sale_screen.dart
//
// Objetivo:
//   Tela principal de frente de caixa (PDV) do Store Connect. Exibe produtos,
//   pesquisa, categorias, carrinho e atalhos de navegação utilizados durante
//   uma venda.
//
// Responsabilidades principais:
//   - exibir produtos recebidos do Firestore e permitir inclusão no carrinho;
//   - pesquisar e filtrar produtos por categoria;
//   - respeitar estoque disponível e sinalizar estoque baixo/esgotado;
//   - abrir o carrinho e as áreas administrativas permitidas pelo aplicativo;
//   - manter imagens de produtos/categorias em cache persistente para que o PDV
//     continue visualmente utilizável durante quedas de conexão;
//   - exibir um indicador discreto de conectividade na AppBar.
//
// Fluxo offline desta etapa:
//
//   ONLINE
//     -> imagens remotas são carregadas
//     -> cached_network_image mantém cópia local
//     -> indicador mostra "Online"
//
//   OFFLINE
//     -> imagens previamente carregadas continuam disponíveis pelo cache
//     -> imagens nunca carregadas usam placeholder local
//     -> indicador mostra "Offline"
//
// IMPORTANTE SOBRE O INDICADOR:
//   O indicador usa internet_connection_checker_plus para testar acesso real
//   à Internet, em vez de apenas verificar se existe Wi-Fi/dados habilitados.
//   A fila SQLite continua sendo a fonte de verdade para vendas pendentes.
//
// Sincronização offline:
//   - OfflineSalesRepository observa vendas pending/failed;
//   - OfflineSalesSyncService envia a fila para a callable syncOfflineSale;
//   - ao iniciar online, a tela tenta sincronizar pendências existentes;
//   - na transição OFFLINE -> ONLINE, uma nova sincronização é disparada;
//   - durante o envio o indicador mostra "Sincronizando • N";
//   - o contador reage ao SQLite e cai conforme as vendas viram synced;
//   - idempotência e baixa definitiva de estoque são garantidas no backend
//     pelo mesmo localSaleId.
//
// Integração fiscal:
//   - a venda comercial é sincronizada primeiro;
//   - NFC-e é solicitada depois, separadamente;
//   - falha fiscal não devolve a venda ao estado pending.
//
// Cuidados de manutenção:
//   - não remover o cache das imagens sem revisar a experiência offline;
//   - não usar o indicador de conectividade como autorização para gravar venda;
//   - não alterar a lógica de estoque sem revisar o fluxo transacional;
//   - quantidades permanecem inteiras;
//   - venda fiscal/NFC-e offline será tratada separadamente em contingência.
//
// ============================================================================

// lib/screens/sales/new_sale_screen.dart

import 'dart:async';
import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:internet_connection_checker_plus/internet_connection_checker_plus.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sales_sync_service.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/screens/cart/cart_screen.dart';
import 'package:store_connect/screens/management/manage_customers_screen.dart';
import 'package:store_connect/screens/management/manage_products_screen.dart';
import 'package:store_connect/screens/reports/reports_hub_screen.dart';
import 'package:store_connect/screens/sales/sales_history_screen.dart';
import 'package:store_connect/screens/settings_screen.dart';
import 'package:store_connect/screens/dashboard_screen.dart';

import '../management/category_management_screen.dart';

class NewSaleScreen extends StatefulWidget {
  final String storeId;

  const NewSaleScreen({super.key, required this.storeId});

  @override
  State<NewSaleScreen> createState() => _NewSaleScreenState();
}

class _NewSaleScreenState extends State<NewSaleScreen> {
  String _appVersion = 'Carregando...';
  String _buildNumber = '';

  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  // --- NOVA VARIÁVEL PARA CONTROLAR O ESTADO DA LUPA ---
  bool _isSearching = false;

  String _selectedCategoryId = '';

  // --------------------------------------------------------------------------
  // INTERNET REAL
  // --------------------------------------------------------------------------
  //
  // Diferente de um verificador de interface de rede, este monitor testa se o
  // aparelho consegue realmente alcançar a Internet. Isso evita o falso
  // "Online" quando Wi-Fi/dados estão ativos, mas sem acesso externo.
  // --------------------------------------------------------------------------

  final InternetConnection _internetConnection = InternetConnection();
  StreamSubscription<InternetStatus>? _internetSubscription;

  bool _isOnline = true;

  // --------------------------------------------------------------------------
  // FILA LOCAL + SINCRONIZAÇÃO
  // --------------------------------------------------------------------------
  //
  // O repositório observa o SQLite compartilhado.
  // O serviço envia pending/failed para a callable syncOfflineSale.
  //
  // A sincronização é disparada:
  //   1. quando a tela inicia e já existe Internet;
  //   2. quando a conexão muda de OFFLINE para ONLINE.
  //
  // O próprio OfflineSalesSyncService impede duas varreduras simultâneas.
  // --------------------------------------------------------------------------

  final OfflineSalesRepository _offlineSalesRepository =
  OfflineSalesRepository();

  late final OfflineSalesSyncService _offlineSalesSyncService =
  OfflineSalesSyncService(
    repository: _offlineSalesRepository,
  );

  late final Stream<int> _waitingSalesCountStream =
  _offlineSalesRepository.watchWaitingSalesCount();

  bool _isSyncingOfflineSales = false;

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
    _startConnectivityMonitoring();
  }

  @override
  void dispose() {
    _internetSubscription?.cancel();

    // O repositório usa o banco compartilhado do aplicativo.
    // Portanto, a tela não deve encerrar o SQLite ao ser destruída.
    _searchController.dispose();

    super.dispose();
  }

  Future<void> _startConnectivityMonitoring() async {
    try {
      final hasInternet =
      await _internetConnection.hasInternetAccess;

      if (!mounted) {
        return;
      }

      if (hasInternet != _isOnline) {
        setState(() {
          _isOnline = hasInternet;
        });
      }

      // A tela pode nascer já ONLINE com vendas persistidas de uma execução
      // anterior. Nesse caso não esperamos uma mudança de conectividade.
      if (hasInternet) {
        unawaited(
          _syncPendingOfflineSales(),
        );
      }

      await _internetSubscription?.cancel();

      _internetSubscription =
          _internetConnection.onStatusChange.listen(
                (InternetStatus status) {
              final online =
                  status == InternetStatus.connected;

              debugPrint(
                '🌐 INTERNET: ${online ? "ONLINE" : "OFFLINE"}',
              );

              if (!mounted) {
                return;
              }

              final wasOnline = _isOnline;

              if (online != _isOnline) {
                setState(() {
                  _isOnline = online;
                });
              }

              // Sincroniza somente na transição real OFFLINE -> ONLINE.
              if (!wasOnline && online) {
                unawaited(
                  _syncPendingOfflineSales(),
                );
              }
            },
            onError: (Object error) {
              debugPrint(
                '⚠️ Erro ao monitorar Internet: $error',
              );

              if (mounted && _isOnline) {
                setState(() {
                  _isOnline = false;
                });
              }
            },
          );
    } catch (error) {
      debugPrint(
        '⚠️ Erro ao verificar Internet: $error',
      );

      if (mounted && _isOnline) {
        setState(() {
          _isOnline = false;
        });
      }
    }
  }

  Future<void> _syncPendingOfflineSales() async {
    if (_isSyncingOfflineSales ||
        _offlineSalesSyncService.isSyncing) {
      return;
    }

    if (!_isOnline) {
      return;
    }

    if (mounted) {
      setState(() {
        _isSyncingOfflineSales = true;
      });
    }

    try {
      final result =
      await _offlineSalesSyncService.syncPendingSales();

      if (!mounted) {
        return;
      }

      if (result.skippedBecauseAlreadyRunning) {
        return;
      }

      if (result.hasSyncedSales) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              result.syncedCount == 1
                  ? '1 venda offline sincronizada com sucesso.'
                  : '${result.syncedCount} vendas offline sincronizadas com sucesso.',
            ),
            backgroundColor: Colors.green,
          ),
        );
      }

      if (result.hasFailures &&
          !result.stoppedBecauseNetworkUnavailable) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              result.failedCount == 1
                  ? '1 venda continua pendente de sincronização.'
                  : '${result.failedCount} vendas continuam pendentes de sincronização.',
            ),
            backgroundColor: Colors.orange,
          ),
        );
      }

      if (result.stoppedBecauseNetworkUnavailable) {
        debugPrint(
          '📴 SYNC OFFLINE: conexão indisponível durante o envio. '
              'A fila será retomada quando a Internet voltar.',
        );
      }
    } catch (error) {
      debugPrint(
        '❌ SYNC OFFLINE: erro ao executar fila: $error',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSyncingOfflineSales = false;
        });
      }
    }
  }

  Widget _buildConnectivityIndicator(
      bool isDarkMode,
      int pendingCount,
      ) {
    final online = _isOnline;
    final hasPendingSales = pendingCount > 0;

    final statusText =
    _isSyncingOfflineSales ? 'Sincronizando' : (online ? 'Online' : 'Offline');

    final indicatorText = hasPendingSales
        ? '$statusText • $pendingCount ${pendingCount == 1 ? 'pendente' : 'pendentes'}'
        : statusText;

    final foregroundColor = online
        ? (isDarkMode ? Colors.greenAccent.shade100 : Colors.green.shade800)
        : (isDarkMode ? Colors.orangeAccent.shade100 : Colors.orange.shade900);

    final backgroundColor = foregroundColor.withValues(alpha: 0.12);

    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: Tooltip(
        message: hasPendingSales
            ? '$pendingCount ${pendingCount == 1 ? 'venda aguardando' : 'vendas aguardando'} sincronização'
            : (online ? 'Internet disponível' : 'Sem acesso à Internet'),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: backgroundColor,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: foregroundColor.withValues(alpha: 0.35),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_isSyncingOfflineSales)
                SizedBox(
                  width: 13,
                  height: 13,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: foregroundColor,
                  ),
                )
              else
                Icon(
                  online ? Icons.circle : Icons.cloud_off_outlined,
                  size: online ? 9 : 15,
                  color: foregroundColor,
                ),
              const SizedBox(width: 5),
              Text(
                indicatorText,
                style: TextStyle(
                  color: foregroundColor,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _loadAppVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) {
      setState(() {
        _appVersion = info.version;
        _buildNumber = info.buildNumber;
      });
    }
  }

  Future<void> _launchURL(String url) async {
    final uri = Uri.parse(url);
    if (!await launchUrl(uri)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não foi possível abrir o link: $url')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cartProvider = Provider.of<CartProvider>(context, listen: false);
    final theme = Theme.of(context);
    final isDarkMode = theme.brightness == Brightness.dark;


    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        // --- LÓGICA DO TÍTULO VS BARRA DE PESQUISA ---
        title: _isSearching
            ? TextField(
          controller: _searchController,
          autofocus: true, // Abre o teclado automaticamente
          style: TextStyle(
              color: isDarkMode ? Colors.white : Colors.black87,
              fontSize: 18),
          decoration: InputDecoration(
            hintText: 'Pesquisar produtos...',
            hintStyle: TextStyle(
                color: isDarkMode ? Colors.white54 : Colors.black54),
            border: InputBorder.none, // Remove a linha de baixo do campo
          ),
          onChanged: (value) {
            setState(() {
              _searchQuery = value;
            });
          },
        )
            : const Text('Nova Venda'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (!_isSearching)
            StreamBuilder<int>(
              stream: _waitingSalesCountStream,
              initialData: 0,
              builder: (context, snapshot) {
                final pendingCount = snapshot.data ?? 0;

                return _buildConnectivityIndicator(
                  isDarkMode,
                  pendingCount,
                );
              },
            ),

          // --- ÍCONE DA LUPA OU DO X ---
          if (_isSearching)
            IconButton(
              icon: const Icon(Icons.close),
              onPressed: () {
                setState(() {
                  _isSearching = false;
                  _searchQuery = '';
                  _searchController.clear();
                });
              },
            )
          else
            IconButton(
              icon: const Icon(Icons.search),
              onPressed: () {
                setState(() {
                  _isSearching = true;
                });
              },
            ),

          // Ícone do Carrinho
          Consumer<CartProvider>(
            builder: (context, cart, _) => Badge(
              alignment: Alignment.topRight,
              offset: const Offset(-6, -4),
              label: Text(cart.itemCount.toString()),
              isLabelVisible: cart.itemCount > 0,
              child: IconButton(
                icon: const Icon(Icons.shopping_cart),
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => CartScreen(storeId: widget.storeId),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            DrawerHeader(
              decoration: const BoxDecoration(color: Colors.lightBlueAccent),
              child: StreamBuilder<DocumentSnapshot>(
                stream: FirebaseFirestore.instance
                    .collection('stores')
                    .doc(widget.storeId)
                    .snapshots(),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator(color: Colors.white));
                  }

                  if (!snapshot.hasData || !snapshot.data!.exists) {
                    return const Center(child: Text('Store Connect', style: TextStyle(color: Colors.white, fontSize: 24)));
                  }

                  final storeData = snapshot.data!.data() as Map<String, dynamic>;
                  final storeName = storeData['name'] ?? 'Minha Loja';
                  final logoUrl = storeData['logoUrl'] as String?;

                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Stack(
                          alignment: Alignment.center,
                          children: [
                            (logoUrl != null && logoUrl.isNotEmpty)
                                ? CircleAvatar(radius: 35, backgroundImage: NetworkImage(logoUrl), backgroundColor: Colors.white)
                                : const Icon(Icons.storefront, color: Colors.white, size: 45),
                            Positioned.fill(
                              child: Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(35),
                                  onTap: () async {
                                    final pickedImage = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 50);
                                    if (pickedImage == null) return;

                                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Atualizando logo...")));

                                    try {
                                      final ref = FirebaseStorage.instance.ref('store_logos/${widget.storeId}/logo.jpg');
                                      await ref.putFile(File(pickedImage.path));
                                      final newUrl = await ref.getDownloadURL();
                                      await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).update({'logoUrl': newUrl});
                                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Logo atualizada!")));
                                    } catch (e) {
                                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Erro: $e")));
                                    }
                                  },
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(storeName, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  );
                },
              ),
            ),
            //if (roleProvider.canAccessSettings) //Para esconder a opção de configurações
            ListTile(
              leading: const Icon(Icons.dashboard),
              title: const Text('Dashboard'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (ctx) => DashboardScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Histórico de Vendas'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (ctx) =>
                        SalesHistoryScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.analytics_outlined),
              title: const Text('Análises e Relatórios'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (ctx) => ReportsHubScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.inventory_2),
              title: const Text('Gerenciar Produtos'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (ctx) =>
                        ManageProductsScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.category_outlined), // Ícone que lembra organização/departamentos
              title: const Text('Gerenciar Categorias'),
              onTap: () {
                // 1. Fecha o menu lateral suavemente
                Navigator.pop(context);

                // 2. Navega para a nova tela limpa que vamos criar
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => CategoryManagementScreen(
                      storeId: widget.storeId,
                    ),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.people),
              title: const Text('Gerenciar Clientes'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) =>
                        ManageCustomersScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.settings_outlined),
              title: const Text('Configurações'),
              onTap: () {
                Navigator.of(context).pop();
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) =>
                        SettingsScreen(storeId: widget.storeId),
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.info_outline),
              title: const Text("Sobre"),
              onTap: () {
                showDialog(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text("Sobre"),
                    content: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          "O Store Connect é o motor do seu negócio. Um PDV inteligente e sistema de gestão completo, criado para simplificar suas vendas, controlar seu estoque e impulsionar o seu crescimento em um só lugar.",
                        ),
                        const SizedBox(height: 20),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.link),
                          title: const Text("Store&Connect"),
                          onTap: () =>
                              _launchURL('https://www.storeconnect.com.br'),
                        ),
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.only(top: 12.0),
                            child: Text(
                              'Versão do App: $_appVersion+$_buildNumber',
                              style: TextStyle(
                                fontSize: 14,
                                color: isDarkMode
                                    ? Colors.white70
                                    : Colors.black54,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    actions: [
                      TextButton(
                        child: const Text("Fechar"),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Sair'),
              onTap: () {
                FirebaseAuth.instance.signOut();
              },
            ),
          ],
        ),
      ),

      body: Stack(
        children: [
          Positioned.fill(
            child: Opacity(
              opacity: isDarkMode ? 0.4 : 0.15,
              child: Image.asset(
                isDarkMode
                    ? 'assets/images/background_dark_mode.png'
                    : 'assets/images/background_claro_test.png',
                fit: BoxFit.cover,
              ),
            ),
          ),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final screenWidth = constraints.maxWidth;
                int crossAxisCount = 2;
                double childAspectRatio;

                if (screenWidth > 1500) {
                  crossAxisCount = 6;
                  childAspectRatio = 1.1;
                } else if (screenWidth > 1200) {
                  crossAxisCount = 5;
                  childAspectRatio = 1.05;
                } else if (screenWidth > 900) {
                  crossAxisCount = 4;
                  childAspectRatio = 1.0;
                } else if (screenWidth > 600) {
                  crossAxisCount = 3;
                  childAspectRatio = 0.9;
                } else {
                  crossAxisCount = 2;
                  childAspectRatio = 0.9;
                }

                // --- ADICIONAMOS UMA COLUMN PARA EMPILHAR A BARRA E OS PRODUTOS ---
                return Column(
                  children: [
                    _buildCategoryFilter(), // A barra entra aqui no topo!

                    Expanded(
                      child: StreamBuilder<QuerySnapshot>(
                        stream: FirebaseFirestore.instance
                            .collection('stores')
                            .doc(widget.storeId)
                            .collection('products')
                            .orderBy('name_lowercase')
                            .snapshots(),
                        builder: (ctx, productSnapshot) {
                          if (productSnapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Center(
                                child: CircularProgressIndicator());
                          }
                          if (productSnapshot.hasError) {
                            return const Center(
                                child: Text(
                                    'Ocorreu um erro ao carregar produtos.'));
                          }

                          final allProductDocs =
                              productSnapshot.data?.docs ?? [];

                          if (allProductDocs.isEmpty) {
                            return const Center(
                              child: Padding(
                                padding: EdgeInsets.all(16.0),
                                child: Text(
                                  'Nenhum produto cadastrado. Adicione produtos em "Gerenciar Produtos".',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(fontSize: 16),
                                ),
                              ),
                            );
                          }

                          // --- LÓGICA DE FILTRO ATUALIZADA (PESQUISA + CATEGORIA) ---
                          final productDocs = allProductDocs.where((doc) {
                            final productData =
                            doc.data() as Map<String, dynamic>;
                            final product =
                            Product.fromMap(doc.id, productData);

                            // 1. Filtra pelo que foi digitado na Lupa
                            final productName = product.name.toLowerCase();
                            final searchLower = _searchQuery.toLowerCase();
                            final matchesSearch =
                            productName.contains(searchLower);

                            // 2. Filtra pelo Botão da Categoria
                            bool matchesCategory = true;
                            if (_selectedCategoryId.isNotEmpty) {
                              final prodCatId =
                                  productData['categoryId'] as String? ?? '';
                              matchesCategory =
                                  prodCatId == _selectedCategoryId;
                            }

                            // Só exibe se bater com os dois filtros
                            return matchesSearch && matchesCategory;
                          }).toList();

                          if (productDocs.isEmpty) {
                            return Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.search_off,
                                      size: 60,
                                      color: Colors.grey.withOpacity(0.5)),
                                  const SizedBox(height: 16),
                                  const Text(
                                      'Nenhum produto encontrado nesta categoria.'),
                                ],
                              ),
                            );
                          }

                          return GridView.builder(
                            padding: const EdgeInsets.all(10.0),
                            itemCount: productDocs.length,
                            gridDelegate:
                            SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: crossAxisCount,
                              childAspectRatio: childAspectRatio,
                              crossAxisSpacing: 10,
                              mainAxisSpacing: 10,
                            ),
                            itemBuilder: (ctx, i) {
                              final productData = productDocs[i].data()
                              as Map<String, dynamic>;
                              final product = Product.fromMap(
                                productDocs[i].id,
                                productData,
                              );

                              final bool isOutOfStock = product.quantidade <= 0;
                              final bool isLowStock = product.quantidade > 0 &&
                                  product.quantidade <= 5;

                              final cardColor = isOutOfStock
                                  ? theme.cardColor.withOpacity(0.5)
                                  : theme.cardColor.withOpacity(0.9);
                              final textColor = isOutOfStock
                                  ? theme.textTheme.bodyMedium?.color
                                  ?.withOpacity(0.5)
                                  : theme.textTheme.bodyMedium?.color;

                              return Card(
                                elevation: 4,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(15),
                                ),
                                clipBehavior: Clip.antiAlias,
                                color: cardColor,
                                child: Stack(
                                  children: [
                                    Column(
                                      crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                      children: <Widget>[
                                        Expanded(
                                          child: Opacity(
                                            opacity: isOutOfStock ? 0.4 : 1.0,
                                            child: (product.imageUrl != null &&
                                                product.imageUrl!.isNotEmpty)
                                                ? CachedNetworkImage(
                                              imageUrl: product.imageUrl!,
                                              fit: BoxFit.cover,
                                              placeholder: (context, url) =>
                                                  Container(
                                                    alignment: Alignment.center,
                                                    color: Theme.of(context)
                                                        .colorScheme
                                                        .surfaceContainerHighest,
                                                    child: const SizedBox(
                                                      width: 24,
                                                      height: 24,
                                                      child:
                                                      CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                      ),
                                                    ),
                                                  ),
                                              errorWidget:
                                                  (context, url, error) =>
                                                  Container(
                                                    alignment: Alignment.center,
                                                    color: Theme.of(context)
                                                        .colorScheme
                                                        .surfaceContainerHighest,
                                                    child: Icon(
                                                      Icons.inventory_2_outlined,
                                                      size: 48,
                                                      color: Theme.of(context)
                                                          .colorScheme
                                                          .onSurfaceVariant,
                                                    ),
                                                  ),
                                            )
                                                : Center(
                                              child: Icon(
                                                Icons.inventory_2,
                                                size: 50,
                                                color: textColor,
                                              ),
                                            ),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8.0,
                                            vertical: 4.0,
                                          ),
                                          child: Text(
                                            product.name,
                                            style: TextStyle(
                                              fontWeight: FontWeight.bold,
                                              color: textColor,
                                            ),
                                            textAlign: TextAlign.center,
                                            maxLines: 2,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.fromLTRB(
                                              8, 0, 8, 8),
                                          child: Text(
                                            'R\$ ${product.price.toStringAsFixed(2)}',
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              color: isDarkMode
                                                  ? Colors.white70
                                                  : theme.primaryColor,
                                              fontSize: 16,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ),
                                        Padding(
                                          padding: const EdgeInsets.fromLTRB(
                                              8, 0, 8, 8),
                                          child: ElevatedButton.icon(
                                            icon: const Icon(
                                              Icons.add_shopping_cart,
                                              size: 18,
                                            ),
                                            label: Text(
                                              isOutOfStock
                                                  ? 'Sem Estoque'
                                                  : 'Adicionar',
                                            ),
                                            style: ElevatedButton.styleFrom(
                                              padding: const EdgeInsets.symmetric(
                                                vertical: 8,
                                              ),
                                              tapTargetSize: MaterialTapTargetSize
                                                  .shrinkWrap,
                                              backgroundColor: isOutOfStock
                                                  ? Colors.grey.withOpacity(0.3)
                                                  : Colors.deepPurple,
                                              foregroundColor: Colors.white,
                                            ),
                                            onPressed: isOutOfStock
                                                ? null
                                                : () => cartProvider
                                                .addItem(product),
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (isOutOfStock || isLowStock)
                                      Positioned(
                                        top: 5,
                                        right: 5,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 8,
                                            vertical: 4,
                                          ),
                                          decoration: BoxDecoration(
                                            color: isOutOfStock
                                                ? Colors.red.shade700
                                                : Colors.orange.shade700,
                                            borderRadius:
                                            BorderRadius.circular(12),
                                          ),
                                          child: Text(
                                            isOutOfStock
                                                ? 'Esgotado'
                                                : 'Estoque: ${product.quantidade}',
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontWeight: FontWeight.bold,
                                              fontSize: 12,
                                            ),
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // --- NOVO WIDGET: BARRA DE CATEGORIAS ---
  // --- WIDGET ATUALIZADO: BARRA DE CATEGORIAS COM BOTÃO MENU ---
  Widget _buildCategoryFilter() {
    final theme = Theme.of(context);
    final isDarkMode = theme.brightness == Brightness.dark;

    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .collection('categories')
          .orderBy('name')
          .snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
          return const SizedBox.shrink();
        }

        final categories = snapshot.data!.docs;

        return Container(
          height: 65,
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            children: [
              // 1. NOVO BOTÃO: Abre o Menu de Categorias (BottomSheet)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ActionChip(
                  avatar: Icon(Icons.grid_view, size: 18, color: isDarkMode ? Colors.white : Colors.black87),
                  label: Text(
                    'Categorias',
                    style: TextStyle(fontWeight: FontWeight.bold, color: isDarkMode ? Colors.white : Colors.black87),
                  ),
                  backgroundColor: isDarkMode ? Colors.grey.shade800 : Colors.grey.shade200,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: isDarkMode ? Colors.grey.shade700 : Colors.grey.shade300),
                  ),
                  onPressed: () => _showCategoriesModal(context, categories),
                ),
              ),

              // 2. Botão fixo "Todos" (Para limpar os filtros rapidamente)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: const Text('Todos', style: TextStyle(fontWeight: FontWeight.bold)),
                  selected: _selectedCategoryId.isEmpty,
                  onSelected: (selected) {
                    if (selected) setState(() => _selectedCategoryId = '');
                  },
                  selectedColor: Colors.deepPurple.shade100,
                  labelStyle: TextStyle(
                    color: _selectedCategoryId.isEmpty ? Colors.deepPurple.shade900 : null,
                  ),
                ),
              ),

              // 3. Botões dinâmicos do Firebase
              ...categories.map((doc) {
                final isSelected = _selectedCategoryId == doc.id;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(doc['name']),
                    selected: isSelected,
                    onSelected: (selected) {
                      setState(() {
                        _selectedCategoryId = selected ? doc.id : '';
                      });
                    },
                    selectedColor: Colors.deepPurple.shade100,
                    labelStyle: TextStyle(
                      color: isSelected ? Colors.deepPurple.shade900 : null,
                    ),
                  ),
                );
              }).toList(),
            ],
          ),
        );
      },
    );
  }

  // --- NOVO MÉTODO: GAVETA (BOTTOM SHEET) DE CATEGORIAS ---
  void _showCategoriesModal(BuildContext context, List<QueryDocumentSnapshot> categories) {
    final theme = Theme.of(context);
    final isDarkMode = theme.brightness == Brightness.dark;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true, // Permite que a gaveta ocupe mais espaço na tela
      backgroundColor: Colors.transparent,
      builder: (BuildContext ctx) {
        return Container(
          height: MediaQuery.of(context).size.height * 0.75, // Ocupa 75% da tela
          decoration: BoxDecoration(
            color: theme.scaffoldBackgroundColor,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(24),
              topRight: Radius.circular(24),
            ),
          ),
          child: Column(
            children: [
              // Barra indicadora de "Puxar" e Botão de Fechar
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const SizedBox(width: 40), // Espaçador para centralizar
                    Container(
                      width: 40,
                      height: 5,
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    IconButton(
                      icon: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade200,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(Icons.close, size: 20, color: isDarkMode ? Colors.white70 : Colors.black54),
                      ),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
              ),

              // Título
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Categorias',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: isDarkMode ? Colors.white : Colors.black87),
                  ),
                ),
              ),

              // Grade de Categorias
              Expanded(
                child: GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    // Aumentar este valor deixa o card com a altura menor ("mais achatado")
                    childAspectRatio: 2.5,
                  ),
                  itemCount: categories.length,
                  itemBuilder: (context, index) {
                    final doc = categories[index];
                    final catData = doc.data() as Map<String, dynamic>;
                    final String? imageUrl = catData['imageUrl'];

                    return InkWell(
                      onTap: () {
                        setState(() {
                          _selectedCategoryId = doc.id;
                        });
                        Navigator.of(ctx).pop(); // Fecha a gaveta ao selecionar
                      },
                      borderRadius: BorderRadius.circular(12),
                      child: Container(
                        decoration: BoxDecoration(
                          color: isDarkMode ? Colors.white10 : Colors.grey.shade100,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isDarkMode ? Colors.white24 : Colors.grey.shade200),
                        ),
                        child: Row(
                          children: [
                            // Título da Categoria
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.only(left: 12, right: 4),
                                child: Text(
                                  doc['name'],
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: Colors.black87,
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),

                            // Imagem da Categoria centralizada à direita
                            Container(
                              width: 60, // Largura da imagem
                              height: double.infinity, // Ocupa a altura total do card
                              decoration: const BoxDecoration(
                                borderRadius: BorderRadius.only(
                                  topRight: Radius.circular(12),
                                  bottomRight: Radius.circular(12),
                                ),
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: imageUrl != null && imageUrl.isNotEmpty
                                  ? CachedNetworkImage(
                                imageUrl: imageUrl,
                                fit: BoxFit.cover,
                                placeholder: (context, url) => const Center(
                                  child: SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  ),
                                ),
                                errorWidget: (context, url, error) =>
                                const Center(
                                  child: Icon(
                                    Icons.category_outlined,
                                    size: 28,
                                    color: Colors.grey,
                                  ),
                                ),
                              )
                                  : const Icon(Icons.category, size: 28, color: Colors.grey),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
