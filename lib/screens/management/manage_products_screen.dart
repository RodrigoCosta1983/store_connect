// lib/screens/management/manage_products_screen.dart

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/widgets/dynamic_background.dart';

class _ProductDialogState extends State<_ProductDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _quantidadeController = TextEditingController(); // Agora será apenas visual/soma
  final _loteQuantidadeController = TextEditingController();
  final _minimumStockController = TextEditingController();
  var _isLoading = false;

  File? _selectedImageFile;
  Uint8List? _selectedImageBytes;
  String? _existingImageUrl;

  List<Map<String, dynamic>> _lotes = [];
  DateTime? _dataValidadeSelecionada;

  String? _selectedCategoryId;
  String? _selectedCategoryName;

  bool get _isEditing => widget.product != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final productData = widget.product!.data() as Map<String, dynamic>;
      _nameController.text = productData['name'] ?? '';
      _priceController.text = productData['price']?.toString() ?? '';
      _minimumStockController.text = (productData['minimumStock'] ?? 0).toString();

      // 1. CARREGA IMAGEM E CATEGORIA
      if (productData.containsKey('imageUrl')) {
        _existingImageUrl = productData['imageUrl'];
      }
      if (productData.containsKey('categoryId')) {
        _selectedCategoryId = productData['categoryId'];
        _selectedCategoryName = productData['categoryName'];
      }

      // 2. CARREGA LOTES
      if (productData.containsKey('lotes') && productData['lotes'] is List) {
        final rawLotes = productData['lotes'] as List;
        setState(() {
          _lotes = rawLotes.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        });
      } else {
        _lotes = [];
      }

      // 3. A CORREÇÃO DA QUANTIDADE (O PULO DO GATO)
      // Se a lista de lotes for vazia, pega a quantidade do banco.
      // Se tiver lote, aí sim usa a soma matemática.
      if (_lotes.isEmpty) {
        _quantidadeController.text = (productData['quantidade'] ?? 0).toString();
      } else {
        _sincronizarTotalManual();
      }
    }
  }

  // --- NOVA FUNÇÃO PARA MANTER A SINCRONIA ---
  void _sincronizarTotalManual() {
    final somaLotes = _lotes.fold(0, (sum, item) => sum + (item['quantidade'] as int));
    _quantidadeController.text = somaLotes.toString();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _quantidadeController.dispose();
    _loteQuantidadeController.dispose();
    _minimumStockController.dispose();
    super.dispose();
  }

  Future<void> _selecionarData(BuildContext context) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime(2030),
    );
    if (picked != null && picked != _dataValidadeSelecionada) {
      setState(() {
        _dataValidadeSelecionada = picked;
      });
    }
  }

  Future<void> _pickImage() async {
    final pickedImage = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 50, maxWidth: 600);
    if (pickedImage == null) return;

    if (kIsWeb) {
      _selectedImageBytes = await pickedImage.readAsBytes();
    } else {
      _selectedImageFile = File(pickedImage.path);
    }
    setState(() {});
  }

  Future<void> _saveProduct() async {
    if (!_formKey.currentState!.validate()) return;
    if (widget.storeId.isEmpty) return;

    setState(() => _isLoading = true);

    final String name = _nameController.text;
    final double price = double.parse(_priceController.text.replaceAll(',', '.'));
    final int minimumStock = int.tryParse(_minimumStockController.text) ?? 0;

    final String oldImageUrl = _existingImageUrl ?? '';
    String imageUrl = oldImageUrl;

    try {
      if (_selectedImageFile != null || _selectedImageBytes != null) {
        final fileName = '${DateTime.now().millisecondsSinceEpoch}.jpg';
        final path = 'product_images/${widget.storeId}/$fileName';
        final ref = FirebaseStorage.instance.ref(path);
        final metadata = SettableMetadata(contentType: 'image/jpeg');

        final TaskSnapshot snapshot = kIsWeb
            ? await ref.putData(_selectedImageBytes!, metadata)
            : await ref.putFile(_selectedImageFile!, metadata);

        imageUrl = await snapshot.ref.getDownloadURL();
      }

      // 1. Filtrar lotes ativos
      final lotesFiltrados = _lotes.where((lote) => (lote['quantidade'] as int) > 0).toList();

      // 2. Calcular total: Se houver lotes, usa a soma. Senão, usa o campo manual.
      final int manualQuantidade = int.tryParse(_quantidadeController.text) ?? 0;
      final int somaLotes = lotesFiltrados.fold(0, (sum, item) => sum + (item['quantidade'] as int));
      final int finalQuantidade = _lotes.isEmpty ? manualQuantidade : somaLotes;

      final productData = {
        'name': name,
        'name_lowercase': name.toLowerCase(),
        'price': price,
        'lotes': lotesFiltrados,
        'quantidade': finalQuantidade,
        'minimumStock': minimumStock,
        'imageUrl': imageUrl,
        'categoryId': _selectedCategoryId,
        'categoryName': _selectedCategoryName,
      };

      if (_isEditing) {
        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('products')
            .doc(widget.product!.id)
            .update(productData);
      } else {
        productData['createdAt'] = Timestamp.now();
        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('products')
            .add(productData);
      }

      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Produto salvo com sucesso!'), backgroundColor: Colors.green),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao salvar: $error'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    ImageProvider? provider;
    if (_selectedImageBytes != null) {
      provider = MemoryImage(_selectedImageBytes!);
    } else if (_selectedImageFile != null) {
      provider = FileImage(_selectedImageFile!);
    } else if (_existingImageUrl != null && _existingImageUrl!.isNotEmpty) {
      provider = NetworkImage(_existingImageUrl!);
    }

    return AlertDialog(
      title: Text(_isEditing ? 'Editar Produto' : 'Adicionar Produto'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              GestureDetector(
                onTap: _pickImage,
                child: CircleAvatar(
                  radius: 40,
                  backgroundColor: Colors.grey.shade200,
                  backgroundImage: provider,
                  child: provider == null ? const Icon(Icons.add_a_photo, size: 40, color: Colors.grey) : null,
                ),
              ),
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(labelText: 'Nome do Produto'),
                validator: (value) => (value == null || value.isEmpty) ? 'Campo obrigatório.' : null,
              ),
              const SizedBox(height: 16),
              StreamBuilder<QuerySnapshot>(
                stream: FirebaseFirestore.instance
                    .collection('stores')
                    .doc(widget.storeId)
                    .collection('categories')
                    .orderBy('name')
                    .snapshots(),
                builder: (context, snapshot) {
                  if (!snapshot.hasData) return const CircularProgressIndicator();

                  final categories = snapshot.data!.docs;
                  String? safeValue = _selectedCategoryId;
                  if (safeValue != null && !categories.any((doc) => doc.id == safeValue)) {
                    safeValue = null;
                  }

                  return DropdownButtonFormField<String>(
                    value: safeValue,
                    decoration: const InputDecoration(labelText: 'Categoria'),
                    items: categories.map((doc) => DropdownMenuItem(value: doc.id, child: Text(doc['name']))).toList(),
                    onChanged: (value) {
                      if (value != null) {
                        final selectedCat = categories.firstWhere((doc) => doc.id == value);
                        setState(() {
                          _selectedCategoryId = value;
                          _selectedCategoryName = selectedCat['name'];
                        });
                      }
                    },
                  );
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _priceController,
                decoration: const InputDecoration(labelText: 'Preço'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),

              // --- CAMPO DE QUANTIDADE TRAVADO SE HOUVER LOTES ---
              // No seu TextFormField de Quantidade:
              TextFormField(
                controller: _quantidadeController,
                decoration: InputDecoration(
                  labelText: _lotes.isNotEmpty
                      ? 'Quantidade (Soma automática dos lotes)'
                      : 'Quantidade Manual',
                  filled: _lotes.isNotEmpty,
                  fillColor: _lotes.isNotEmpty ? Colors.grey.withOpacity(0.1) : null,
                ),
                // AQUI É O PULO DO GATO:
                // Se tiver lotes, trava (readOnly). Se não, libera para digitação.
                readOnly: _lotes.isNotEmpty,
                keyboardType: TextInputType.number,
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Campo obrigatório.';
                  if (int.tryParse(value) == null || int.parse(value) < 0) return 'Número inválido.';
                  return null;
                },
              ),

              const Divider(height: 32),
              const Text('Gerenciar Lotes', style: TextStyle(fontWeight: FontWeight.bold)),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: () => _selecionarData(context),
                    icon: const Icon(Icons.calendar_today),
                    label: Text(_dataValidadeSelecionada == null ? 'Data' : DateFormat('dd/MM/yyyy').format(_dataValidadeSelecionada!)),
                  ),
                  Expanded(
                    child: TextFormField(
                      controller: _loteQuantidadeController,
                      decoration: const InputDecoration(labelText: 'Quantidade'),
                      keyboardType: TextInputType.number,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.add_circle, color: Colors.blue, size: 32),
                    onPressed: () {
                      final qtd = int.tryParse(_loteQuantidadeController.text);
                      if (qtd != null && qtd > 0 && _dataValidadeSelecionada != null) {
                        setState(() {
                          _lotes.add({'quantidade': qtd, 'validade': Timestamp.fromDate(_dataValidadeSelecionada!)});
                          _sincronizarTotalManual(); // Atualiza o campo total instantaneamente
                        });
                        _loteQuantidadeController.clear();
                        _dataValidadeSelecionada = null;
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Informe a Qtd e a Validade!'), backgroundColor: Colors.orange),
                        );
                      }
                    },
                  ),
                ],
              ),

              const SizedBox(height: 10),
              Column(
                children: _lotes.asMap().entries.map((entry) {
                  final index = entry.key;
                  final lote = entry.value;
                  final DateTime date = (lote['validade'] as Timestamp).toDate();
                  return ListTile(
                    dense: true,
                    title: Text('Qtd: ${lote['quantidade']} | Vence: ${DateFormat('dd/MM/yyyy').format(date)}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () {
                        setState(() {
                          _lotes.removeAt(index);
                          _sincronizarTotalManual(); // Atualiza o campo total instantaneamente
                        });
                      },
                    ),
                  );
                }).toList(),
              ),

              const SizedBox(height: 16),
              TextFormField(
                controller: _minimumStockController,
                decoration: const InputDecoration(labelText: 'Estoque Mínimo para Alerta'),
                keyboardType: TextInputType.number,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        ElevatedButton(onPressed: _isLoading ? null : _saveProduct, child: const Text('Salvar')),
      ],
    );
  }
}

class _ProductDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? product;
  const _ProductDialog({required this.storeId, this.product});

  @override
  _ProductDialogState createState() => _ProductDialogState();
}

class ManageProductsScreen extends StatefulWidget {
  final String storeId;
  const ManageProductsScreen({super.key, required this.storeId});

  @override
  State<ManageProductsScreen> createState() => _ManageProductsScreenState();
}

class _ManageProductsScreenState extends State<ManageProductsScreen> {
  final _searchController = TextEditingController();

  void _showProductDialog({DocumentSnapshot? product}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ProductDialog(storeId: widget.storeId, product: product),
    );
  }

  void _deleteProduct(String productId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirmar Exclusão'),
        content: const Text('Tem certeza que deseja excluir este produto? A imagem associada será removida permanentemente.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              FirebaseFirestore.instance.collection('stores').doc(widget.storeId).collection('products').doc(productId).delete();
              Navigator.of(ctx).pop();
            },
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,
      body: Stack(
        children: [
          const DynamicBackground(),
          SafeArea(
            child: Column(
              children: [
                _buildCustomHeader(isDarkMode),
                Expanded(
                  child: StreamBuilder<QuerySnapshot>(
                    stream: FirebaseFirestore.instance
                        .collection('stores')
                        .doc(widget.storeId)
                        .collection('products')
                        .orderBy('name_lowercase')
                        .snapshots(),
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      if (snapshot.hasError) {
                        return const Center(child: Text('Ocorreu um erro.'));
                      }
                      final allProducts = snapshot.data?.docs ?? [];

                      final filteredProducts = allProducts.where((doc) {
                        final data = doc.data() as Map<String, dynamic>;
                        final name = (data['name_lowercase'] as String? ?? '').toLowerCase();
                        final query = _searchController.text.toLowerCase();
                        return name.contains(query);
                      }).toList();

                      if (filteredProducts.isEmpty) {
                        return Center(
                          child: Text(
                            _searchController.text.isEmpty
                                ? 'Nenhum produto cadastrado.'
                                : 'Nenhum produto encontrado.',
                            style: TextStyle(
                              color: isDarkMode ? Colors.white70 : Colors.black54,
                              fontSize: 16,
                            ),
                          ),
                        );
                      }
                      return LayoutBuilder(
                        builder: (context, constraints) {
                          if (constraints.maxWidth > 768) {
                            return _buildProductDataTable(filteredProducts, isDarkMode, constraints);
                          } else {
                            return _buildProductListView(filteredProducts, isDarkMode);
                          }
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showProductDialog(),
        child: const Icon(Icons.add),
        tooltip: 'Adicionar Produto',
      ),
    );
  }

  Widget _buildProductListView(List<QueryDocumentSnapshot> products, bool isDarkMode) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 80),
      itemCount: products.length,
      itemBuilder: (ctx, index) {
        final productDoc = products[index];
        final productData = productDoc.data() as Map<String, dynamic>;
        return _buildProductCard(productDoc, productData, isDarkMode);
      },
    );
  }

  Widget _buildProductDataTable(List<QueryDocumentSnapshot> products, bool isDarkMode, BoxConstraints constraints) {
    final formatCurrency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: ConstrainedBox(
        constraints: BoxConstraints(minWidth: constraints.maxWidth),
        child: DataTable(
          columnSpacing: 24,
          headingRowColor: MaterialStateProperty.all(Theme.of(context).splashColor),
          columns: const [
            DataColumn(label: Text('Produto')),
            DataColumn(label: Text('Estoque (Mín.)'), numeric: true),
            DataColumn(label: Text('Preço'), numeric: true),
            DataColumn(label: Text('Ações')),
          ],
          rows: products.map((productDoc) {
            final productData = productDoc.data() as Map<String, dynamic>;
            final imageUrl = productData['imageUrl'] as String?;
            final quantidade = productData['quantidade'] as int? ?? 0;
            final minimumStock = productData['minimumStock'] as int? ?? 0;
            final price = (productData['price'] as num? ?? 0).toDouble();
            final bool needsRestock = quantidade <= minimumStock;

            return DataRow(
              color: MaterialStateProperty.resolveWith<Color?>(
                    (Set<MaterialState> states) {
                  if (needsRestock) return Colors.red.withOpacity(0.2);
                  return null;
                },
              ),
              cells: [
                DataCell(Row(
                  children: [
                    CircleAvatar(
                      radius: 20,
                      backgroundColor: Colors.grey.shade700,
                      backgroundImage: (imageUrl != null && imageUrl.isNotEmpty) ? NetworkImage(imageUrl) : null,
                      child: (imageUrl == null || imageUrl.isEmpty) ? const Icon(Icons.inventory_2, color: Colors.white, size: 20) : null,
                    ),
                    const SizedBox(width: 16),
                    Text(productData['name'] ?? 'Sem nome', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                )),
                DataCell(
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (needsRestock) const Icon(Icons.warning_amber_rounded, color: Colors.redAccent, size: 18),
                      if (needsRestock) const SizedBox(width: 8),
                      Text(
                        '$quantidade ($minimumStock)',
                        style: TextStyle(
                          color: needsRestock ? Colors.red.shade800 : null,
                          fontWeight: needsRestock ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ),
                DataCell(Text(formatCurrency.format(price))),
                DataCell(Row(
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit, color: Colors.blueAccent),
                      onPressed: () => _showProductDialog(product: productDoc),
                      tooltip: 'Editar',
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () => _deleteProduct(productDoc.id),
                      tooltip: 'Excluir',
                    ),
                  ],
                )),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildCustomHeader(bool isDarkMode) {
    final headerColor = isDarkMode ? Colors.white : Colors.black;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                icon: Icon(Icons.arrow_back, color: headerColor),
                onPressed: () => Navigator.of(context).pop(),
              ),
              Expanded(
                child: Text('Gerenciar Produtos', style: TextStyle(color: headerColor, fontSize: 22, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 48),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _searchController,
            onChanged: (value) => setState(() {}),
            style: TextStyle(color: isDarkMode ? Colors.white : Colors.black),
            decoration: InputDecoration(
              hintText: 'Buscar por nome...',
              hintStyle: TextStyle(color: isDarkMode ? Colors.white70 : Colors.black54),
              prefixIcon: Icon(Icons.search, color: isDarkMode ? Colors.white70 : Colors.black54),
              filled: true,
              fillColor: Theme.of(context).cardColor.withOpacity(isDarkMode ? 0.1 : 0.5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(vertical: 0),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProductCard(DocumentSnapshot productDoc, Map<String, dynamic> productData, bool isDarkMode) {
    final imageUrl = productData['imageUrl'] as String?;
    final quantidade = productData['quantidade'] as int? ?? 0;
    final minimumStock = productData['minimumStock'] as int? ?? 0;
    final bool needsRestock = quantidade <= minimumStock;

    return Card(
      color: isDarkMode ? Colors.black.withOpacity(0.6) : Colors.white.withOpacity(0.8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(15),
        side: BorderSide(
          color: needsRestock ? Colors.redAccent.withOpacity(0.8) : Colors.transparent,
          width: 2,
        ),
      ),
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
        leading: CircleAvatar(
          radius: 25,
          backgroundColor: Colors.grey.shade700,
          backgroundImage: (imageUrl != null && imageUrl.isNotEmpty) ? NetworkImage(imageUrl) : null,
          child: (imageUrl == null || imageUrl.isEmpty) ? const Icon(Icons.inventory_2, color: Colors.white) : null,
        ),
        title: Text(productData['name'] ?? 'Sem nome', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(
          'Em estoque: $quantidade (Mín: $minimumStock)',
          style: TextStyle(
            color: needsRestock ? Colors.amber.shade600 : Theme.of(context).textTheme.bodySmall?.color,
            fontWeight: needsRestock ? FontWeight.bold : FontWeight.normal,
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (needsRestock)
              const Icon(Icons.warning_amber_rounded, color: Colors.redAccent),
            IconButton(
              icon: const Icon(Icons.edit, color: Colors.blueAccent),
              onPressed: () => _showProductDialog(product: productDoc),
            ),
            IconButton(
              icon: const Icon(Icons.delete, color: Colors.red),
              onPressed: () => _deleteProduct(productDoc.id),
            ),
          ],
        ),
      ),
    );
  }
}