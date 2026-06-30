import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

// --- DIÁLOGO DE CATEGORIA (CRIAR E EDITAR) ---
class _CategoryDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? category;

  const _CategoryDialog({required this.storeId, this.category});

  @override
  State<_CategoryDialog> createState() => _CategoryDialogState();
}

class _CategoryDialogState extends State<_CategoryDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  bool _isLoading = false;

  File? _selectedImageFile;
  Uint8List? _selectedImageBytes;
  String? _existingImageUrl;

  bool get _isEditing => widget.category != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final data = widget.category!.data() as Map<String, dynamic>;
      _nameController.text = data['name'] ?? '';
      if (data.containsKey('imageUrl')) {
        _existingImageUrl = data['imageUrl'];
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final pickedImage = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 50,
      maxWidth: 400, // Ícones de categoria não precisam ser enormes
    );
    if (pickedImage == null) return;

    if (kIsWeb) {
      _selectedImageBytes = await pickedImage.readAsBytes();
    } else {
      _selectedImageFile = File(pickedImage.path);
    }
    setState(() {});
  }

  Future<void> _saveCategory() async {
    if (!_formKey.currentState!.validate()) return;
    if (widget.storeId.isEmpty) return;

    setState(() => _isLoading = true);

    final String name = _nameController.text.trim();
    String imageUrl = _existingImageUrl ?? '';
    final String oldImageUrl = _existingImageUrl ?? '';

    try {
      // 1. Upload da Nova Imagem (se selecionada)
      if (_selectedImageFile != null || _selectedImageBytes != null) {
        final fileName = '${DateTime.now().millisecondsSinceEpoch}.jpg';
        final ref = FirebaseStorage.instance
            .ref()
            .child('category_images')
            .child(widget.storeId)
            .child(fileName);

        if (kIsWeb) {
          await ref.putData(_selectedImageBytes!);
        } else {
          await ref.putFile(_selectedImageFile!);
        }
        imageUrl = await ref.getDownloadURL();
      }

      // 2. Preparar os dados
      final Map<String, dynamic> categoryData = {
        'name': name,
        'imageUrl': imageUrl,
      };

      // 3. Guardar no Firestore
      if (_isEditing) {
        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('categories')
            .doc(widget.category!.id)
            .update(categoryData);
      } else {
        categoryData['createdAt'] = FieldValue.serverTimestamp();
        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('categories')
            .add(categoryData);
      }

      // 4. Limpeza da imagem antiga (Opcional, poupa espaço)
      if (_isEditing && oldImageUrl.isNotEmpty && oldImageUrl != imageUrl) {
        try {
          await FirebaseStorage.instance.refFromURL(oldImageUrl).delete();
        } catch (e) {
          debugPrint('Aviso: Não foi possível apagar a imagem antiga: $e');
        }
      }

      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao guardar categoria: $error')),
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
      title: Text(_isEditing ? 'Editar Categoria' : 'Nova Categoria'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              onTap: _pickImage,
              child: Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: Colors.grey.shade200,
                  borderRadius: BorderRadius.circular(16), // Formato arredondado
                  image: provider != null
                      ? DecorationImage(image: provider, fit: BoxFit.cover)
                      : null,
                ),
                child: provider == null
                    ? const Icon(Icons.add_photo_alternate, size: 30, color: Colors.grey)
                    : null,
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _nameController,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Nome da Categoria',
                hintText: 'Ex: Bebidas, Frios...',
                border: OutlineInputBorder(),
              ),
              validator: (value) =>
              (value == null || value.trim().isEmpty) ? 'Campo obrigatório' : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        ElevatedButton(
          onPressed: _isLoading ? null : _saveCategory,
          child: _isLoading
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Guardar'),
        ),
      ],
    );
  }
}

// --- ECRÃ PRINCIPAL DE GESTÃO DE CATEGORIAS ---
class CategoryManagementScreen extends StatefulWidget {
  final String storeId;

  const CategoryManagementScreen({Key? key, required this.storeId}) : super(key: key);

  @override
  State<CategoryManagementScreen> createState() => _CategoryManagementScreenState();
}

class _CategoryManagementScreenState extends State<CategoryManagementScreen> {

  void _showCategoryDialog({DocumentSnapshot? category}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _CategoryDialog(storeId: widget.storeId, category: category),
    );
  }

  void _deleteCategory(String categoryId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirmar Eliminação'),
        content: const Text('Tem a certeza de que deseja eliminar esta categoria?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              await FirebaseFirestore.instance
                  .collection('stores')
                  .doc(widget.storeId)
                  .collection('categories')
                  .doc(categoryId)
                  .delete();
              if (mounted) Navigator.of(ctx).pop();
            },
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Categorias'),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('categories')
            .orderBy('name')
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return const Center(
              child: Text('Erro ao carregar categorias.', style: TextStyle(color: Colors.red)),
            );
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(
              child: Text(
                'Nenhuma categoria registada ainda.\nClique no botão + para adicionar.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: Colors.grey),
              ),
            );
          }

          final categories = snapshot.data!.docs;

          return ListView.builder(
            itemCount: categories.length,
            itemBuilder: (context, index) {
              final categoryDoc = categories[index];
              final categoryData = categoryDoc.data() as Map<String, dynamic>;
              final categoryName = categoryData['name'];
              final imageUrl = categoryData['imageUrl'] as String?;

              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: ListTile(
                  leading: Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      color: Colors.indigo.shade50,
                      borderRadius: BorderRadius.circular(10),
                      image: (imageUrl != null && imageUrl.isNotEmpty)
                          ? DecorationImage(image: NetworkImage(imageUrl), fit: BoxFit.cover)
                          : null,
                    ),
                    child: (imageUrl == null || imageUrl.isEmpty)
                        ? const Icon(Icons.category, color: Colors.indigo, size: 24)
                        : null,
                  ),
                  title: Text(
                    categoryName,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.edit_outlined, color: Colors.blueAccent),
                        tooltip: 'Editar Categoria',
                        onPressed: () => _showCategoryDialog(category: categoryDoc),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
                        tooltip: 'Eliminar Categoria',
                        onPressed: () => _deleteCategory(categoryDoc.id),
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
        onPressed: () => _showCategoryDialog(),
        tooltip: 'Adicionar Categoria',
        child: const Icon(Icons.add),
      ),
    );
  }
}