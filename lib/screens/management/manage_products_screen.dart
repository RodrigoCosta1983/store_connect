// lib/screens/management/manage_products_screen.dart

import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:store_connect/widgets/dynamic_background.dart';

// --- Diálogo de Adicionar/Editar Produto (sem alterações) ---
class _ProductDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? product;
  const _ProductDialog({required this.storeId, this.product});

  @override
  _ProductDialogState createState() => _ProductDialogState();
}

class _ProductDialogState extends State<_ProductDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _priceController = TextEditingController();
  final _quantidadeController = TextEditingController();
  final _minimumStockController = TextEditingController();
  var _isLoading = false;

  File? _selectedImageFile;
  Uint8List? _selectedImageBytes;
  String? _existingImageUrl;

  bool get _isEditing => widget.product != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final productData = widget.product!.data() as Map<String, dynamic>;
      _nameController.text = productData['name'];
      _priceController.text = productData['price'].toString();
      _quantidadeController.text = (productData['quantidade'] ?? 0).toString();
      _minimumStockController.text = (productData['minimumStock'] ?? 0).toString();
      if (productData.containsKey('imageUrl')) {
        _existingImageUrl = productData['imageUrl'];
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _quantidadeController.dispose();
    _minimumStockController.dispose();
    super.dispose();
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
    final int quantidade = int.tryParse(_quantidadeController.text) ?? 0;
    final int minimumStock = int.tryParse(_minimumStockController.text) ?? 0;
    String imageUrl = _existingImageUrl ?? '';

    try {
      if (_selectedImageFile != null || _selectedImageBytes != null) {
        final ref = FirebaseStorage.instance.ref().child('product_images').child(widget.storeId).child('${DateTime.now().millisecondsSinceEpoch}.jpg');
        if (kIsWeb) {
          await ref.putData(_selectedImageBytes!);
        } else {
          await ref.putFile(_selectedImageFile!);
        }
        imageUrl = await ref.getDownloadURL();
      }

      final productData = {
        'name': name,
        'name_lowercase': name.toLowerCase(),
        'price': price,
        'quantidade': quantidade,
        'minimumStock': minimumStock,
        'imageUrl': imageUrl,
      };

      if (_isEditing) {
        await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).collection('products').doc(widget.product!.id).update(productData);
      } else {
        productData['createdAt'] = Timestamp.now();
        await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).collection('products').add(productData);
      }

      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar produto: $error')));
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
              TextFormField(
                controller: _priceController,
                decoration: const InputDecoration(labelText: 'Preço (ex: 10.50)'),
                keyboardType: TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Campo obrigatório.';
                  if (double.tryParse(value.replaceAll(',', '.')) == null) return 'Número inválido.';
                  return null;
                },
              ),
              TextFormField(
                controller: _quantidadeController,
                decoration: const InputDecoration(labelText: 'Quantidade em Estoque'),
                keyboardType: TextInputType.number,
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Campo obrigatório.';
                  if (int.tryParse(value) == null || int.parse(value) < 0) return 'Insira um número válido.';
                  return null;
                },
              ),
              TextFormField(
                controller: _minimumStockController,
                decoration: const InputDecoration(labelText: 'Estoque Mínimo para Alerta'),
                keyboardType: TextInputType.number,
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Defina um estoque mínimo.';
                  if (int.tryParse(value) == null || int.parse(value) < 0) return 'Insira um número válido.';
                  return null;
                },
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _isLoading ? null : () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        ElevatedButton(
          onPressed: _isLoading ? null : _saveProduct,
          child: _isLoading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Salvar'),
        ),
      ],
    );
  }
}

// --- Tela Principal de Gerenciamento de Produtos com Novo Design ---
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
        content: const Text('Tem certeza que deseja excluir este produto? Esta ação não pode ser desfeita.'),
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
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showProductDialog(),
        child: const Icon(Icons.add),
        tooltip: 'Adicionar Produto',
      ),
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

                      return ListView.builder(
                        padding: const EdgeInsets.fromLTRB(8, 0, 8, 80),
                        itemCount: filteredProducts.length,
                        itemBuilder: (ctx, index) {
                          final productDoc = filteredProducts[index];
                          final productData = productDoc.data() as Map<String, dynamic>;
                          return _buildProductCard(productDoc, productData, isDarkMode);
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