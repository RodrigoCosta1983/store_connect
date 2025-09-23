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

class NewSaleScreen extends StatefulWidget {
  final String storeId;

  const NewSaleScreen({super.key, required this.storeId});

  @override
  State<NewSaleScreen> createState() => _NewSaleScreenState();
}

class _NewSaleScreenState extends State<NewSaleScreen> {
  String _appVersion = 'Carregando...';

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
  }

  Future<void> _loadAppVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) {
      setState(() {
        _appVersion = info.version;
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
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        title: const Text('Nova Venda'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          Consumer<CartProvider>(
            builder: (context, cart, _) => Badge(
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
            const DrawerHeader(
              decoration: BoxDecoration(color: Colors.blue),
              child: Text(
                'StoreConnect',
                style: TextStyle(color: Colors.white, fontSize: 24),
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
                    // Esta chamada agora é válida porque a SettingsScreen foi corrigida
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
                    title: const Text("Sobre o StoreConnect"),
                    content: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          "Plataforma de gestão para distribuidoras, desenvolvido por RodrigoCosta-DEV.",
                        ),
                        const SizedBox(height: 20),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.link),
                          title: const Text("rodrigocosta-dev.com"),
                          onTap: () =>
                              _launchURL('https://rodrigocosta-dev.com'),
                        ),
                        Center(
                          child: Padding(
                            padding: const EdgeInsets.only(top: 12.0),
                            child: Text(
                              'Versão do App: $_appVersion',
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
          // Stack para a imagem de fundo
          Positioned.fill(
            child: Opacity(
              opacity: isDarkMode ? 0.4 : 0.15,
              child: Image.asset(
                isDarkMode
                    ? 'assets/images/background_light.png'
                    : 'assets/images/background_dark.jpg',
                fit: BoxFit.cover,
              ),
            ),
          ),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                // --- Lógica para grade responsiva ---
                final screenWidth = constraints.maxWidth;
                int crossAxisCount = 2;
                double childAspectRatio = 1 / 1.15;

                if (screenWidth > 1200) {
                  crossAxisCount = 5;
                  childAspectRatio = 1 / 1.2;
                } else if (screenWidth > 800) {
                  crossAxisCount = 4;
                  childAspectRatio = 1 / 1.1;
                } else if (screenWidth > 600) {
                  crossAxisCount = 3;
                }
                // --- Fim da lógica responsiva ---

                // StreamBuilder para buscar dados em tempo real
                return StreamBuilder<QuerySnapshot>(
                  stream: FirebaseFirestore.instance
                      .collection('stores')
                      .doc(widget.storeId)
                      .collection('products')
                      .orderBy('name_lowercase')
                      .snapshots(),
                  builder: (ctx, productSnapshot) {
                    // Tratamento de estados de carregamento e erro
                    if (productSnapshot.connectionState ==
                        ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (productSnapshot.hasError) {
                      return const Center(
                        child: Text('Ocorreu um erro ao carregar produtos.'),
                      );
                    }
                    final productDocs = productSnapshot.data?.docs ?? [];
                    if (productDocs.isEmpty) {
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

                    // GridView para exibir os produtos
                    return GridView.builder(
                      padding: const EdgeInsets.all(10.0),
                      itemCount: productDocs.length,
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: crossAxisCount,
                        childAspectRatio: childAspectRatio,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),

                      itemBuilder: (ctx, i) {
                        final productData =
                            productDocs[i].data() as Map<String, dynamic>;
                        final product = Product.fromMap(
                          productDocs[i].id,
                          productData,
                        );

                        final bool isOutOfStock = product.quantidade <= 0;
                        final bool isLowStock =
                            product.quantidade > 0 && product.quantidade <= 5;

                        // Pega o tema atual para saber se é modo escuro ou não
                        final theme = Theme.of(context);
                        final isDarkMode = theme.brightness == Brightness.dark;

                        // Lógica de cores adaptáveis para o card e texto (já implementada)
                        final cardColor = isOutOfStock
                            ? theme.cardColor.withOpacity(0.5)
                            : theme.cardColor.withOpacity(0.9);
                        final textColor = isOutOfStock
                            ? theme.textTheme.bodyMedium?.color?.withOpacity(
                                0.5,
                              )
                            : theme.textTheme.bodyMedium?.color;

                        return Card(
                          elevation: 4,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(15),
                          ),
                          clipBehavior: Clip.antiAlias,
                          color: cardColor,
                          // <-- Usa a cor adaptável
                          child: Stack(
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: <Widget>[
                                  Expanded(
                                    child: Opacity(
                                      opacity: isOutOfStock ? 0.4 : 1.0,
                                      // Deixa a imagem um pouco apagada
                                      child:
                                          (product.imageUrl != null &&
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
                                        color:
                                            textColor, // <-- Usa a cor de texto adaptável
                                      ),
                                      textAlign: TextAlign.center,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.fromLTRB(
                                      8,
                                      0,
                                      8,
                                      8,
                                    ),
                                    child: Text(
                                      'R\$ ${product.price.toStringAsFixed(2)}',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        // --- COR DO PREÇO AJUSTADA ---
                                        // Se for modo escuro, a cor será branca. Senão, usa a cor primária.
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
                                      8,
                                      0,
                                      8,
                                      8,
                                    ),
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
                                        tapTargetSize:
                                            MaterialTapTargetSize.shrinkWrap,
                                        // --- COR DO BOTÃO AJUSTADA ---
                                        // Se estiver esgotado, fica cinza. Senão, usa um roxo vibrante em ambos os modos.
                                        backgroundColor: isOutOfStock
                                            ? Colors.grey.withOpacity(0.3)
                                            : Colors.deepPurple,
                                        // Cor fixa para destaque
                                        foregroundColor: Colors
                                            .white, // Texto e ícone sempre brancos
                                      ),
                                      onPressed: isOutOfStock
                                          ? null
                                          : () => cartProvider.addItem(product),
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
                                      borderRadius: BorderRadius.circular(12),
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
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
