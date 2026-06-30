// lib/screens/sales/new_sale_screen.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

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

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
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
              decoration: const BoxDecoration(color: Colors.blue),
              child: StreamBuilder<DocumentSnapshot>(
                stream: FirebaseFirestore.instance
                    .collection('stores')
                    .doc(widget.storeId)
                    .snapshots(),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: Text(
                        'Carregando...',
                        style: TextStyle(color: Colors.white, fontSize: 20),
                      ),
                    );
                  }

                  if (snapshot.hasError ||
                      !snapshot.hasData ||
                      !snapshot.data!.exists) {
                    return const Center(
                      child: Text(
                        'Store Connect',
                        style: TextStyle(color: Colors.white, fontSize: 24),
                      ),
                    );
                  }

                  final storeData =
                  snapshot.data!.data() as Map<String, dynamic>;
                  final storeName = storeData['name'] ?? 'Minha Loja';
                  // Puxa a URL da logo do banco de dados (ajuste o nome do campo se necessário)
                  final logoUrl = storeData['logoUrl'] as String?;

                  return Center(
                    // Centraliza o bloco inteiro no DrawerHeader
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center, // Centraliza verticalmente
                      crossAxisAlignment: CrossAxisAlignment.center, // Centraliza horizontalmente
                      children: [
                        // --- LÓGICA DA LOGO VS ÍCONE ---
                        if (logoUrl != null && logoUrl.isNotEmpty)
                          CircleAvatar(
                            radius: 35, // Tamanho do círculo da logo
                            backgroundImage: NetworkImage(logoUrl),
                            backgroundColor: Colors.white, // Fundo branco caso a logo seja transparente
                          )
                        else
                          const Icon(Icons.storefront,
                              color: Colors.white, size: 45),

                        const SizedBox(height: 12), // Espaço entre a logo e o nome

                        Text(
                          storeName,
                          textAlign: TextAlign.center, // Centraliza o texto caso tenha duas linhas
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
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
                                                ? Image.network(
                                              product.imageUrl!,
                                              fit: BoxFit.cover,
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
                  avatar: const Icon(Icons.grid_view, size: 18, color: Colors.black87),
                  label: const Text(
                    'Categorias',
                    style: TextStyle(fontWeight: FontWeight.bold, color: Colors.black87),
                  ),
                  backgroundColor: Colors.grey.shade200,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(color: Colors.grey.shade300),
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
    showModalBottomSheet(
      context: context,
      isScrollControlled: true, // Permite que a gaveta ocupe mais espaço na tela
      backgroundColor: Colors.transparent,
      builder: (BuildContext ctx) {
        return Container(
          height: MediaQuery.of(context).size.height * 0.75, // Ocupa 75% da tela
          decoration: const BoxDecoration(
            color: Colors.white,
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
                        child: const Icon(Icons.close, size: 20, color: Colors.black54),
                      ),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
              ),

              // Título
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Categorias',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.black87),
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
                          color: Colors.grey.shade100, // Fundo levemente cinza
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.grey.shade200), // Borda sutil
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
                                  ? Image.network(imageUrl, fit: BoxFit.cover)
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