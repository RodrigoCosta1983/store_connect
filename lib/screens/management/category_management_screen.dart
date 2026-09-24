// ============================================================================
// ARQUIVO: category_management_screen.dart
// ============================================================================
//
// RESPONSABILIDADE DESTE ARQUIVO:
//
// Gerencia as categorias de produtos da loja.
//
// PRINCIPAIS RESPONSABILIDADES:
//
// • Listar categorias cadastradas
// • Criar uma nova categoria
// • Editar uma categoria existente
// • Excluir categorias
// • Adicionar ou alterar a imagem da categoria
// • Armazenar imagens no Firebase Storage
// • Manter os dados das categorias no Firestore
//
// FIRESTORE:
//
// stores/{storeId}/categories/{categoryId}
//
// CAMPOS PRINCIPAIS:
//
// {
//   name,
//   imageUrl,
//   createdAt
// }
//
// FIREBASE STORAGE:
//
// category_images/{storeId}/{arquivo}.jpg
//
// COMPATIBILIDADE:
//
// • Android / Mobile
// • Web
//
// RESPONSIVIDADE:
//
// • Mobile:
//   O conteúdo utiliza normalmente a largura disponível da tela.
//
// • Web / Desktop:
//   A lista possui largura máxima de 1100px e permanece centralizada,
//   evitando cards excessivamente largos em monitores grandes.
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
//
// • Não remover o tratamento específico de imagens para Web.
// • No Web utilizamos bytes com putData().
// • No Mobile utilizamos File com putFile().
// • Manter a estrutura Firestore compatível com os produtos já cadastrados.
// • O FloatingActionButton continua responsável por criar novas categorias.
//
// ============================================================================

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

// ============================================================================
// DIÁLOGO DE CATEGORIA
//
// Utilizado tanto para:
//
// • Criar uma nova categoria
// • Editar uma categoria existente
//
// ============================================================================

class _CategoryDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? category;

  const _CategoryDialog({
    required this.storeId,
    this.category,
  });

  @override
  State<_CategoryDialog> createState() =>
      _CategoryDialogState();
}

class _CategoryDialogState extends State<_CategoryDialog> {
  // ==========================================================================
  // FORMULÁRIO
  // ==========================================================================

  final _formKey =
  GlobalKey<FormState>();

  final _nameController =
  TextEditingController();

  // ==========================================================================
  // ESTADO
  // ==========================================================================

  bool _isLoading = false;

  File? _selectedImageFile;

  Uint8List? _selectedImageBytes;

  String? _existingImageUrl;

  // ==========================================================================
  // HIERARQUIA DE CATEGORIAS - T3-A2
  // ==========================================================================

  String? _selectedParentCategoryId;

  late final Future<QuerySnapshot<Map<String, dynamic>>>
      _categoryOptionsFuture;

  // ==========================================================================
  // INDICA SE ESTAMOS EDITANDO
  // ==========================================================================

  bool get _isEditing =>
      widget.category != null;

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    _categoryOptionsFuture =
        FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('categories')
            .orderBy('name')
            .get();

    if (_isEditing) {
      final data =
      widget.category!.data()
      as Map<String, dynamic>;

      _nameController.text =
          data['name'] ?? '';

      if (data.containsKey(
        'imageUrl',
      )) {
        _existingImageUrl =
        data['imageUrl'];
      }

      final rawParentCategoryId =
          data['parentCategoryId'];

      _selectedParentCategoryId =
          rawParentCategoryId is String &&
                  rawParentCategoryId.isNotEmpty
              ? rawParentCategoryId
              : null;
    }
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _nameController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // SELECIONAR IMAGEM
  // ==========================================================================

  Future<void> _pickImage() async {
    final pickedImage =
    await ImagePicker().pickImage(
      source:
      ImageSource.gallery,

      imageQuality: 50,

      // Ícones de categoria não precisam ser enormes.
      maxWidth: 400,
    );

    if (pickedImage == null) {
      return;
    }

    // ------------------------------------------------------------------------
    // WEB
    //
    // Trabalhamos com bytes.
    // ------------------------------------------------------------------------

    if (kIsWeb) {
      _selectedImageBytes =
      await pickedImage
          .readAsBytes();

      _selectedImageFile = null;
    }

    // ------------------------------------------------------------------------
    // MOBILE / DESKTOP
    //
    // Trabalhamos com File.
    // ------------------------------------------------------------------------

    else {
      _selectedImageFile =
          File(
            pickedImage.path,
          );

      _selectedImageBytes = null;
    }

    if (mounted) {
      setState(() {});
    }
  }

  // ==========================================================================
  // SALVAR CATEGORIA
  // ==========================================================================

  Future<void> _saveCategory() async {
    if (!_formKey.currentState!
        .validate()) {
      return;
    }

    if (widget.storeId.isEmpty) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    final String name =
    _nameController.text.trim();

    String imageUrl =
        _existingImageUrl ?? '';

    final String oldImageUrl =
        _existingImageUrl ?? '';

    try {
      // ======================================================================
      // 1. UPLOAD DA NOVA IMAGEM
      // ======================================================================

      if (_selectedImageFile != null ||
          _selectedImageBytes != null) {
        final fileName =
            '${DateTime.now().millisecondsSinceEpoch}.jpg';

        final ref =
        FirebaseStorage.instance
            .ref()
            .child(
          'category_images',
        )
            .child(
          widget.storeId,
        )
            .child(
          fileName,
        );

        // --------------------------------------------------------------------
        // WEB
        // --------------------------------------------------------------------

        if (kIsWeb) {
          await ref.putData(
            _selectedImageBytes!,
          );
        }

        // --------------------------------------------------------------------
        // MOBILE
        // --------------------------------------------------------------------

        else {
          await ref.putFile(
            _selectedImageFile!,
          );
        }

        imageUrl =
        await ref.getDownloadURL();
      }

      // ======================================================================
      // 2. PREPARA O PAYLOAD
      //
      // T3-A2:
      // Categoria raiz envia parentCategoryId null.
      // Subcategoria envia explicitamente o ID da categoria pai.
      // ======================================================================

      final Map<String, dynamic>
      categoryPayload = {
        if (_isEditing)
          'categoryId':
              widget.category!.id,
        'name': name,
        'imageUrl': imageUrl,
        'parentCategoryId': _selectedParentCategoryId,
      };

      // ======================================================================
      // 3. PERSISTE VIA BACKEND
      //
      // A autoridade de create/update deixa de ser escrita direta no
      // Firestore e passa a ser upsertCategory.
      // ======================================================================

      final callable =
          FirebaseFunctions.instance
              .httpsCallable(
        'upsertCategory',
        options:
            HttpsCallableOptions(
          timeout:
              const Duration(
            seconds: 30,
          ),
        ),
      );

      final response =
          await callable.call(
        categoryPayload,
      );

      final data =
          response.data;

      if (data is! Map) {
        throw StateError(
          'Resposta inválida ao salvar categoria.',
        );
      }

      final resultData =
          Map<String, dynamic>.from(
        data,
      );

      final expectedMode =
          _isEditing
              ? 'update'
              : 'create';

      final returnedCategoryId =
          resultData['categoryId'];

      final changed =
          resultData['changed'];

      if (resultData['success'] != true ||
          resultData['mode'] != expectedMode ||
          returnedCategoryId is! String ||
          returnedCategoryId.isEmpty ||
          resultData['parentCategoryId'] !=
              _selectedParentCategoryId ||
          changed is! bool) {
        throw StateError(
          'Resposta inválida ao salvar categoria.',
        );
      }

      if (_isEditing &&
          returnedCategoryId !=
              widget.category!.id) {
        throw StateError(
          'Resposta inválida ao salvar categoria.',
        );
      }
      // ======================================================================
      // 4. REMOVE IMAGEM ANTIGA
      //
      // Somente quando:
      //
      // • estamos editando
      // • havia imagem anterior
      // • a imagem foi realmente alterada
      // ======================================================================

      if (_isEditing &&
          oldImageUrl.isNotEmpty &&
          oldImageUrl != imageUrl) {
        try {
          await FirebaseStorage
              .instance
              .refFromURL(
            oldImageUrl,
          )
              .delete();
        } catch (e) {
          debugPrint(
            'Aviso: Não foi possível apagar a imagem antiga: $e',
          );
        }
      }

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            'Erro ao guardar categoria: $error',
          ),
        ),
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
  // BUILD DO DIÁLOGO
  // ==========================================================================

  @override
  Widget build(
      BuildContext context,
      ) {
    ImageProvider? provider;

    // ------------------------------------------------------------------------
    // IMAGEM NOVA EM BYTES
    // ------------------------------------------------------------------------

    if (_selectedImageBytes != null) {
      provider = MemoryImage(
        _selectedImageBytes!,
      );
    }

    // ------------------------------------------------------------------------
    // IMAGEM NOVA EM FILE
    // ------------------------------------------------------------------------

    else if (_selectedImageFile !=
        null) {
      provider = FileImage(
        _selectedImageFile!,
      );
    }

    // ------------------------------------------------------------------------
    // IMAGEM JÁ EXISTENTE
    // ------------------------------------------------------------------------

    else if (_existingImageUrl !=
        null &&
        _existingImageUrl!.isNotEmpty) {
      provider = NetworkImage(
        _existingImageUrl!,
      );
    }

    return AlertDialog(
      title: Text(
        _isEditing
            ? 'Editar Categoria'
            : 'Nova Categoria',
      ),

      content: Form(
        key: _formKey,

        child: Column(
          mainAxisSize:
          MainAxisSize.min,

          children: [
            // ================================================================
            // IMAGEM
            // ================================================================

            GestureDetector(
              onTap: _pickImage,

              child: Container(
                width: 80,
                height: 80,

                decoration:
                BoxDecoration(
                  color:
                  Colors.grey.shade200,

                  borderRadius:
                  BorderRadius.circular(
                    16,
                  ),

                  image:
                  provider != null
                      ? DecorationImage(
                    image:
                    provider,
                    fit:
                    BoxFit.cover,
                  )
                      : null,
                ),

                child:
                provider == null
                    ? const Icon(
                  Icons
                      .add_photo_alternate,
                  size: 30,
                  color:
                  Colors.grey,
                )
                    : null,
              ),
            ),

            const SizedBox(
              height: 16,
            ),

            // ================================================================
            // CATEGORIA PAI - T3-A2
            //
            // Somente categorias raiz podem ser escolhidas como pai.
            // Categorias legadas sem parentCategoryId tambem sao raiz.
            // ================================================================

            FutureBuilder<QuerySnapshot<Map<String, dynamic>>>(
              future:
                  _categoryOptionsFuture,

              builder: (
                context,
                snapshot,
              ) {
                if (snapshot.connectionState ==
                    ConnectionState.waiting) {
                  return const InputDecorator(
                    decoration:
                        InputDecoration(
                      labelText:
                          'Categoria pai',
                      helperText:
                          'Carregando categorias principais...',
                      border:
                          OutlineInputBorder(),
                    ),

                    child:
                        LinearProgressIndicator(),
                  );
                }

                if (snapshot.hasError ||
                    !snapshot.hasData) {
                  return const InputDecorator(
                    decoration:
                        InputDecoration(
                      labelText:
                          'Categoria pai',
                      border:
                          OutlineInputBorder(),
                    ),

                    child: Text(
                      'Não foi possível carregar as categorias principais.',
                    ),
                  );
                }

                final allCategories =
                    snapshot.data!.docs;

                final rootCategories =
                    allCategories.where(
                  (doc) {
                    if (_isEditing &&
                        doc.id ==
                            widget.category!.id) {
                      return false;
                    }

                    final data =
                        doc.data();

                    return data['parentCategoryId'] ==
                        null;
                  },
                ).toList();

                final selectedParentAvailable =
                    _selectedParentCategoryId ==
                            null ||
                        rootCategories.any(
                          (doc) =>
                              doc.id ==
                              _selectedParentCategoryId,
                        );

                String?
                    unavailableParentName;

                if (!selectedParentAvailable &&
                    _selectedParentCategoryId !=
                        null) {
                  for (final doc
                      in allCategories) {
                    if (doc.id ==
                        _selectedParentCategoryId) {
                      unavailableParentName =
                          doc.data()['name']
                              ?.toString();

                      break;
                    }
                  }
                }

                final items =
                    <DropdownMenuItem<String>>[
                  const DropdownMenuItem<String>(
                    value: '',
                    child: Text(
                      'Nenhuma — categoria principal',
                    ),
                  ),

                  ...rootCategories.map(
                    (doc) {
                      final data =
                          doc.data();

                      final categoryName =
                          data['name']
                                  ?.toString() ??
                              'Sem nome';

                      return DropdownMenuItem<String>(
                        value:
                            doc.id,

                        child: Text(
                          categoryName,
                        ),
                      );
                    },
                  ),

                  if (!selectedParentAvailable &&
                      _selectedParentCategoryId !=
                          null)
                    DropdownMenuItem<String>(
                      value:
                          _selectedParentCategoryId!,

                      enabled:
                          false,

                      child: Text(
                        '${unavailableParentName ?? 'Categoria pai atual'} — indisponível',
                      ),
                    ),
                ];

                return InputDecorator(
                  decoration:
                      const InputDecoration(
                    labelText:
                        'Categoria pai',
                    helperText:
                        'Nenhuma = categoria principal',
                    border:
                        OutlineInputBorder(),
                  ),

                  child:
                      DropdownButtonHideUnderline(
                    child:
                        DropdownButton<String>(
                      value:
                          _selectedParentCategoryId ??
                              '',

                      isExpanded:
                          true,

                      items:
                          items,

                      onChanged:
                          _isLoading
                              ? null
                              : (value) {
                                  if (value ==
                                      null) {
                                    return;
                                  }

                                  setState(
                                    () {
                                      _selectedParentCategoryId =
                                          value.isEmpty
                                              ? null
                                              : value;
                                    },
                                  );
                                },
                    ),
                  ),
                );
              },
            ),

            const SizedBox(
              height: 16,
            ),
            // ================================================================
            // NOME
            // ================================================================

            TextFormField(
              controller:
              _nameController,

              textCapitalization:
              TextCapitalization
                  .sentences,

              decoration:
              const InputDecoration(
                labelText:
                'Nome da Categoria',

                hintText:
                'Ex: Bebidas, Frios...',

                border:
                OutlineInputBorder(),
              ),

              validator: (value) {
                if (value == null ||
                    value
                        .trim()
                        .isEmpty) {
                  return 'Campo obrigatório';
                }

                return null;
              },
            ),
          ],
        ),
      ),

      // ======================================================================
      // AÇÕES
      // ======================================================================

      actions: [
        TextButton(
          onPressed:
          _isLoading
              ? null
              : () =>
              Navigator.of(
                context,
              ).pop(),

          child:
          const Text(
            'Cancelar',
          ),
        ),

        ElevatedButton(
          onPressed:
          _isLoading
              ? null
              : _saveCategory,

          child:
          _isLoading
              ? const SizedBox(
            height: 20,
            width: 20,

            child:
            CircularProgressIndicator(
              strokeWidth: 2,
            ),
          )
              : const Text(
            'Guardar',
          ),
        ),
      ],
    );
  }
}

// ============================================================================
// TELA PRINCIPAL DE GERENCIAMENTO DE CATEGORIAS
// ============================================================================

class CategoryManagementScreen
    extends StatefulWidget {
  final String storeId;

  const CategoryManagementScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<CategoryManagementScreen>
  createState() =>
      _CategoryManagementScreenState();
}

class _CategoryManagementScreenState
    extends State<
        CategoryManagementScreen> {
  // ==========================================================================
  // PAPEL DO USUÁRIO / PERMISSÃO DE EXCLUSÃO
  // ==========================================================================

  String _currentRole = 'operador';

  bool get _canDelete =>
      _currentRole == 'admin' || _currentRole == 'gerente';

  @override
  void initState() {
    super.initState();
    _loadCurrentUserRole();
  }

  Future<void> _loadCurrentUserRole() async {
    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      return;
    }

    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();

      final data = snapshot.data();
      final rawRole =
          data?['role']?.toString().trim().toLowerCase() ?? 'operador';

      // Compatibilidade com papéis antigos.
      final normalizedRole =
          rawRole == 'caixa' || rawRole == 'vendedor'
              ? 'operador'
              : rawRole;

      if (mounted) {
        setState(() {
          _currentRole = normalizedRole;
        });
      }
    } catch (e) {
      debugPrint('Erro ao carregar papel do usuário: $e');
    }
  }

  // ==========================================================================
  // ABRIR DIÁLOGO
  // ==========================================================================

  void _showCategoryDialog({
    DocumentSnapshot? category,
  }) {
    showDialog(
      context: context,

      barrierDismissible: false,

      builder: (ctx) =>
          _CategoryDialog(
            storeId: widget.storeId,
            category: category,
          ),
    );
  }

  // ==========================================================================
  // EXCLUIR CATEGORIA
  // ==========================================================================

  void _deleteCategory(
    String categoryId,
  ) {
    showDialog(
      context: context,

      builder: (ctx) =>
          AlertDialog(
        title:
        const Text(
          'Confirmar Eliminação',
        ),

        content:
        const Text(
          'Tem a certeza de que deseja eliminar esta categoria?',
        ),

        actions: [
          TextButton(
            onPressed: () =>
                Navigator.of(ctx)
                    .pop(),

            child:
            const Text(
              'Cancelar',
            ),
          ),

          ElevatedButton(
            style:
            ElevatedButton
                .styleFrom(
              backgroundColor:
              Colors.red,

              foregroundColor:
              Colors.white,
            ),

            onPressed: () async {
              try {
                final callable =
                    FirebaseFunctions.instance.httpsCallable(
                  'deleteCategory',
                  options: HttpsCallableOptions(
                    timeout: const Duration(seconds: 30),
                  ),
                );

                final response =
                    await callable.call(
                  <String, dynamic>{
                    'categoryId': categoryId,
                  },
                );

                final data =
                    response.data;

                if (data is! Map) {
                  throw StateError(
                    'Resposta inválida ao excluir categoria.',
                  );
                }

                final resultData =
                    Map<String, dynamic>.from(
                  data,
                );

                if (resultData['success'] != true ||
                    resultData['deleted'] != true ||
                    resultData['categoryId'] != categoryId) {
                  throw StateError(
                    'Resposta inválida ao excluir categoria.',
                  );
                }

                if (!ctx.mounted) {
                  return;
                }

                Navigator.of(ctx).pop();
              } on FirebaseFunctionsException catch (e) {
                if (ctx.mounted) {
                  Navigator.of(ctx).pop();
                }

                if (!mounted) {
                  return;
                }

                String? reason;

                final details =
                    e.details;

                if (details is Map) {
                  reason =
                      details['reason']
                          ?.toString();
                }

                final String message;

                if (e.code == 'failed-precondition' &&
                    reason == 'category-in-use') {
                  message =
                      'Esta categoria não pode ser excluída porque está vinculada a um ou mais produtos.';
                } else if (e.code == 'not-found' &&
                    reason == 'category-not-found') {
                  message =
                      'Esta categoria já não está disponível.';
                } else if (e.code == 'permission-denied') {
                  message =
                      'Você não possui permissão para excluir categorias.';
                } else {
                  final backendMessage =
                      e.message?.trim();

                  message =
                      backendMessage != null &&
                              backendMessage.isNotEmpty
                          ? backendMessage
                          : 'Não foi possível excluir a categoria.';
                }

                ScaffoldMessenger.of(context)
                    .showSnackBar(
                  SnackBar(
                    content:
                    Text(message),

                    backgroundColor:
                    Colors.red,
                  ),
                );
              } catch (e) {
                debugPrint(
                  'Erro ao excluir categoria: $e',
                );

                if (ctx.mounted) {
                  Navigator.of(ctx).pop();
                }

                if (mounted) {
                  ScaffoldMessenger.of(context)
                      .showSnackBar(
                    const SnackBar(
                      content:
                      Text(
                        'Não foi possível excluir a categoria.',
                      ),

                      backgroundColor:
                      Colors.red,
                    ),
                  );
                }
              }
            },

            child:
            const Text(
              'Eliminar',
            ),
          ),
        ],
      ),
    );
  }
  @override
  Widget build(
      BuildContext context,
      ) {
    return Scaffold(
      // ======================================================================
      // APP BAR
      // ======================================================================

      appBar: AppBar(
        title:
        const Text(
          'Categorias',
        ),
      ),

      // ======================================================================
      // CONTEÚDO CENTRALIZADO
      //
      // MOBILE:
      // utiliza normalmente a largura disponível.
      //
      // WEB / DESKTOP:
      // limita o conteúdo a 1100px e centraliza.
      // ======================================================================

      body: Center(
        child: ConstrainedBox(
          constraints:
          const BoxConstraints(
            maxWidth: 1100,
          ),

          child:
          StreamBuilder<
              QuerySnapshot>(
            stream:
            FirebaseFirestore
                .instance
                .collection(
              'stores',
            )
                .doc(
              widget.storeId,
            )
                .collection(
              'categories',
            )
                .orderBy(
              'name',
            )
                .snapshots(),

            builder: (
                context,
                snapshot,
                ) {
              // ==============================================================
              // CARREGANDO
              // ==============================================================

              if (snapshot
                  .connectionState ==
                  ConnectionState
                      .waiting) {
                return const Center(
                  child:
                  CircularProgressIndicator(),
                );
              }

              // ==============================================================
              // ERRO
              // ==============================================================

              if (snapshot.hasError) {
                return const Center(
                  child: Text(
                    'Erro ao carregar categorias.',
                    style:
                    TextStyle(
                      color:
                      Colors.red,
                    ),
                  ),
                );
              }

              // ==============================================================
              // NENHUMA CATEGORIA
              // ==============================================================

              if (!snapshot.hasData ||
                  snapshot
                      .data!
                      .docs
                      .isEmpty) {
                return const Center(
                  child: Text(
                    'Nenhuma categoria registada ainda.\n'
                        'Clique no botão + para adicionar.',
                    textAlign:
                    TextAlign.center,
                    style:
                    TextStyle(
                      fontSize: 16,
                      color:
                      Colors.grey,
                    ),
                  ),
                );
              }

              final categories =
                  snapshot.data!.docs;

              // ==============================================================
              // HIERARQUIA VISUAL - T3-A3
              //
              // O Firestore continua entregando uma unica lista ordenada.
              // A hierarquia abaixo existe somente para apresentacao.
              // ==============================================================

              final rootCategories =
                  categories.where(
                (category) {
                  final data =
                      category.data()
                      as Map<String, dynamic>;

                  return !data.containsKey(
                        'parentCategoryId',
                      ) ||
                      data['parentCategoryId'] ==
                          null;
                },
              ).toList();

              final orderedCategories =
                  categories
                      .take(0)
                      .toList();

              final includedCategoryIds =
                  <String>{};

              final subcategoryIds =
                  <String>{};

              final invalidParentIds =
                  <String>{};

              final parentNameByChildId =
                  <String, String>{};

              for (final rootCategory
                  in rootCategories) {
                orderedCategories.add(
                  rootCategory,
                );

                includedCategoryIds.add(
                  rootCategory.id,
                );

                final rootData =
                    rootCategory.data()
                    as Map<String, dynamic>;

                final rootName =
                    rootData['name']
                            ?.toString() ??
                        'Sem nome';

                for (final candidate
                    in categories) {
                  final candidateData =
                      candidate.data()
                      as Map<String, dynamic>;

                  if (candidateData[
                          'parentCategoryId'] ==
                      rootCategory.id) {
                    orderedCategories.add(
                      candidate,
                    );

                    includedCategoryIds.add(
                      candidate.id,
                    );

                    subcategoryIds.add(
                      candidate.id,
                    );

                    parentNameByChildId[
                        candidate.id] =
                        rootName;
                  }
                }
              }

              // Documentos que nao sao raiz e tambem nao possuem
              // uma raiz valida como pai permanecem visiveis.
              //
              // Exemplos:
              // - pai inexistente
              // - auto-parent
              // - terceiro nivel
              // - ciclo legado
              // - valor de parentCategoryId invalido

              for (final category
                  in categories) {
                if (!includedCategoryIds
                    .contains(category.id)) {
                  orderedCategories.add(
                    category,
                  );

                  invalidParentIds.add(
                    category.id,
                  );
                }
              }

              // ==============================================================
              // LISTA
              // ==============================================================

              return ListView.builder(
                padding:
                const EdgeInsets
                    .fromLTRB(
                  12,
                  8,
                  12,
                  90,
                ),

                itemCount:
                orderedCategories.length,

                itemBuilder: (
                    context,
                    index,
                    ) {
                  final categoryDoc =
                  orderedCategories[index];

                  final isSubcategory =
                      subcategoryIds
                          .contains(
                    categoryDoc.id,
                  );

                  final hasInvalidParent =
                      invalidParentIds
                          .contains(
                    categoryDoc.id,
                  );

                  final isNested =
                      isSubcategory ||
                      hasInvalidParent;

                  final parentName =
                      parentNameByChildId[
                          categoryDoc.id];

                  final categorySubtitle =
                      hasInvalidParent
                          ? 'Vínculo hierárquico inválido — edite para corrigir'
                          : isSubcategory
                              ? 'Subcategoria de ${parentName ?? 'Categoria principal'}'
                              : null;

                  final categoryData =
                  categoryDoc.data()
                  as Map<
                      String,
                      dynamic>;

                  final categoryName =
                      categoryData[
                      'name']
                          ?.toString() ??
                          'Sem nome';

                  final imageUrl =
                  categoryData[
                  'imageUrl']
                  as String?;

                  // ==========================================================
                  // CARD
                  // ==========================================================

                  return Card(
                    margin:
                    EdgeInsets.only(
                      left:
                          isNested
                              ? 28
                              : 0,
                      top: 6,
                      bottom: 6,
                    ),

                    child:
                    ListTile(
                      // ======================================================
                      // IMAGEM / ÍCONE
                      // ======================================================

                      leading:
                      Container(
                        width: 50,
                        height: 50,

                        decoration:
                        BoxDecoration(
                          color:
                          Colors
                              .indigo
                              .shade50,

                          borderRadius:
                          BorderRadius
                              .circular(
                            10,
                          ),

                          image:
                          imageUrl !=
                              null &&
                              imageUrl
                                  .isNotEmpty
                              ? DecorationImage(
                            image:
                            NetworkImage(
                              imageUrl,
                            ),

                            fit:
                            BoxFit.cover,
                          )
                              : null,
                        ),

                        child:
                        imageUrl ==
                            null ||
                            imageUrl
                                .isEmpty
                            ? const Icon(
                          Icons
                              .category,
                          color:
                          Colors.indigo,
                          size:
                          24,
                        )
                            : null,
                      ),

                      // ======================================================
                      // NOME
                      // ======================================================

                      title:
                      Text(
                        categoryName,

                        style:
                        const TextStyle(
                          fontWeight:
                          FontWeight
                              .w500,
                        ),
                      ),

                      subtitle:
                      categorySubtitle ==
                              null
                          ? null
                          : Text(
                        categorySubtitle,
                      ),
                      // ======================================================
                      // AÇÕES
                      // ======================================================

                      trailing:
                      Row(
                        mainAxisSize:
                        MainAxisSize
                            .min,

                        children: [
                          // ==================================================
                          // EDITAR
                          // ==================================================

                          IconButton(
                            icon:
                            const Icon(
                              Icons
                                  .edit_outlined,
                              color:
                              Colors
                                  .blueAccent,
                            ),

                            tooltip:
                            'Editar Categoria',

                            onPressed:
                                () =>
                                _showCategoryDialog(
                                  category:
                                  categoryDoc,
                                ),
                          ),

                          // ==================================================
                          // EXCLUIR
                          // ==================================================

                          if (_canDelete)
                            IconButton(
                              icon: const Icon(
                                Icons.delete_outline,
                                color: Colors.redAccent,
                              ),
                              tooltip: 'Eliminar Categoria',
                              onPressed: () =>
                                  _deleteCategory(categoryDoc.id),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),

      // ======================================================================
      // ADICIONAR CATEGORIA
      // ======================================================================

      floatingActionButton:
      FloatingActionButton(
        onPressed: () =>
            _showCategoryDialog(),

        tooltip:
        'Adicionar Categoria',

        child:
        const Icon(
          Icons.add,
        ),
      ),
    );
  }
}
