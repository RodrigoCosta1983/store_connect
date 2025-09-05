import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

// --- Diálogo de Adicionar/Editar Produto ---
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
  final _quantityController = TextEditingController();
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
      // CORRIGIDO: Lendo o campo 'quantidade' para carregar os dados para edição.
      _quantityController.text = (productData['quantidade'] ?? 0).toString();
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
    _quantityController.dispose();
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
    final int quantity = int.tryParse(_quantityController.text) ?? 0;
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
        'quantidade': quantity, // CORRIGIDO: Salvando o estoque com o nome do campo 'quantidade'.
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
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Campo obrigatório.';
                  if (double.tryParse(value.replaceAll(',', '.')) == null) return 'Número inválido.';
                  return null;
                },
              ),
              TextFormField(
                controller: _quantityController,
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

// --- Tela Principal de Gerenciamento de Produtos ---
class ManageProductsScreen extends StatefulWidget {
  final String storeId;
  const ManageProductsScreen({super.key, required this.storeId});

  @override
  State<ManageProductsScreen> createState() => _ManageProductsScreenState();
}

class _ManageProductsScreenState extends State<ManageProductsScreen> {
  void _showProductDialog({DocumentSnapshot? product}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ProductDialog(storeId: widget.storeId, product: product),
    );
  }

  void _deleteProduct(String productId) {
    FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .collection('products')
        .doc(productId)
        .delete();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gerenciar Produtos'),
      ),
      body: StreamBuilder<QuerySnapshot>(
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
            return const Center(child: Text('Ocorreu um erro ao carregar os produtos.'));
          }
          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(child: Text('Nenhum produto cadastrado.'));
          }

          final products = snapshot.data!.docs;

          return ListView.builder(
            itemCount: products.length,
            itemBuilder: (ctx, index) {
              final productDoc = products[index];
              final productData = productDoc.data() as Map<String, dynamic>;
              final imageUrl = productData['imageUrl'] as String?;

              // CORRIGIDO: Lendo o campo 'quantidade' para exibir na lista.
              final quantity = productData['quantidade'] as int? ?? 0;
              final minimumStock = productData['minimumStock'] as int? ?? 0;
              final bool needsRestock = quantity <= minimumStock;

              return Card(
                color: needsRestock ? Colors.red.withOpacity(0.1) : null,
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    radius: 30,
                    backgroundColor: Colors.grey.shade300,
                    backgroundImage: (imageUrl != null && imageUrl.isNotEmpty) ? NetworkImage(imageUrl) : null,
                    child: (imageUrl == null || imageUrl.isEmpty) ? const Icon(Icons.inventory_2, color: Colors.white) : null,
                  ),
                  title: Text(productData['name'] ?? ''),
                  subtitle: Text(
                    'Preço: R\$ ${productData['price']?.toStringAsFixed(2) ?? '0.00'} | Estoque: $quantity (Mín: $minimumStock)',
                    style: TextStyle(color: needsRestock ? Colors.red.shade900 : null),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (needsRestock)
                        const Padding(
                          padding: EdgeInsets.only(right: 8.0),
                          child: Icon(Icons.warning_amber_rounded, color: Colors.orange),
                        ),
                      IconButton(
                        icon: Icon(Icons.edit, color: Theme.of(context).primaryColor),
                        onPressed: () => _showProductDialog(product: productDoc),
                      ),
                      IconButton(
                        icon: Icon(Icons.delete, color: Theme.of(context).colorScheme.error),
                        onPressed: () => _deleteProduct(productDoc.id),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showProductDialog(),
        child: const Icon(Icons.add),
        tooltip: 'Adicionar Produto',
      ),
    );
  }
}