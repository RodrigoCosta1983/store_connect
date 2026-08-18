// lib/widgets/app_drawer.dart

import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/providers/user_role_provider.dart';
import 'package:store_connect/screens/settings_screen.dart';

class AppDrawer extends StatelessWidget {
  final String storeId;

  const AppDrawer({
    super.key,
    required this.storeId,
  });

  @override
  Widget build(BuildContext context) {
    // ================================================================
    // PERMISSÕES DO USUÁRIO
    // ================================================================

    final roleProvider =
    Provider.of<UserRoleProvider>(context);

    return Drawer(
      child: StreamBuilder<DocumentSnapshot>(
        // ============================================================
        // ESCUTA OS DADOS DA LOJA EM TEMPO REAL
        // ============================================================

        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(storeId)
            .snapshots(),

        builder: (context, snapshot) {
          String name = 'SC Connect';
          String? logoUrl;

          // ==========================================================
          // CARREGA NOME E LOGO DA LOJA
          // ==========================================================

          if (snapshot.hasData &&
              snapshot.data!.exists) {
            final data =
            snapshot.data!.data()
            as Map<String, dynamic>;

            name =
                data['name']?.toString() ??
                    'SC Connect';

            logoUrl =
                data['logoUrl']?.toString();
          }

          return ListView(
            padding: EdgeInsets.zero,
            children: [
              // ======================================================
              // CABEÇALHO
              // ======================================================

              Container(
                height: 200,
                color: Colors.blue,
                child: Stack(
                  children: [
                    Padding(
                      padding:
                      const EdgeInsets.all(16),
                      child: Column(
                        mainAxisAlignment:
                        MainAxisAlignment.end,
                        crossAxisAlignment:
                        CrossAxisAlignment.start,
                        children: [
                          // ==========================================
                          // LOGO DA LOJA
                          // ==========================================

                          CircleAvatar(
                            radius: 40,
                            backgroundColor:
                            Colors.white,
                            backgroundImage:
                            logoUrl != null &&
                                logoUrl.isNotEmpty
                                ? NetworkImage(
                              logoUrl,
                            )
                                : null,
                            child: logoUrl == null ||
                                logoUrl.isEmpty
                                ? const Icon(
                              Icons.add_a_photo,
                              size: 40,
                            )
                                : null,
                          ),

                          const SizedBox(
                            height: 10,
                          ),

                          // ==========================================
                          // NOME DA LOJA
                          // ==========================================

                          Text(
                            name,
                            style:
                            const TextStyle(
                              color:
                              Colors.white,
                              fontWeight:
                              FontWeight.bold,
                              fontSize: 18,
                            ),
                          ),

                          // ==========================================
                          // EMAIL
                          // ==========================================

                          Text(
                            FirebaseAuth
                                .instance
                                .currentUser
                                ?.email ??
                                '',
                            style:
                            const TextStyle(
                              color:
                              Colors.white70,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),

                    // ================================================
                    // CLIQUE NO CABEÇALHO PARA ALTERAR A LOGO
                    // ================================================

                    Positioned.fill(
                      child: Material(
                        color:
                        Colors.transparent,
                        child: InkWell(
                          onTap: () async {
                            final pickedImage =
                            await ImagePicker()
                                .pickImage(
                              source:
                              ImageSource.gallery,
                              imageQuality: 50,
                            );

                            if (pickedImage ==
                                null) {
                              return;
                            }

                            if (context.mounted) {
                              ScaffoldMessenger.of(
                                context,
                              ).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Atualizando logo...',
                                  ),
                                ),
                              );
                            }

                            try {
                              // ====================================
                              // ENVIA PARA O FIREBASE STORAGE
                              // ====================================

                              final ref =
                              FirebaseStorage
                                  .instance
                                  .ref(
                                'store_logos/$storeId/logo.jpg',
                              );

                              await ref.putFile(
                                File(
                                  pickedImage.path,
                                ),
                              );

                              final newUrl =
                              await ref
                                  .getDownloadURL();

                              // ====================================
                              // ATUALIZA URL NO FIRESTORE
                              // ====================================

                              await FirebaseFirestore
                                  .instance
                                  .collection(
                                'stores',
                              )
                                  .doc(storeId)
                                  .update({
                                'logoUrl':
                                newUrl,
                              });

                              if (!context
                                  .mounted) {
                                return;
                              }

                              ScaffoldMessenger.of(
                                context,
                              ).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Logo atualizada!',
                                  ),
                                  backgroundColor:
                                  Colors.green,
                                ),
                              );
                            } catch (e) {
                              if (!context
                                  .mounted) {
                                return;
                              }

                              ScaffoldMessenger.of(
                                context,
                              ).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    'Erro ao atualizar logo: $e',
                                  ),
                                  backgroundColor:
                                  Colors.red,
                                ),
                              );
                            }
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // ======================================================
              // DASHBOARD
              // ======================================================

              if (roleProvider.canAccessSettings)
                ListTile(
                  leading: const Icon(
                    Icons.dashboard,
                  ),
                  title: const Text(
                    'Dashboard',
                  ),
                  onTap: () {
                    Navigator.of(context).pop();
                  },
                ),

              // ======================================================
              // CONFIGURAÇÕES
              //
              // A partir daqui a SettingsScreen decide:
              // - permissões
              // - PRO
              // - BUSINESS
              // - módulo Fiscal
              // ======================================================

              if (roleProvider.canAccessSettings)
                ListTile(
                  leading: const Icon(
                    Icons.settings,
                  ),
                  title: const Text(
                    'Configurações',
                  ),
                  onTap: () {
                    // Fecha o Drawer.
                    Navigator.of(context).pop();

                    // Abre Configurações.
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (ctx) =>
                            SettingsScreen(
                              storeId: storeId,
                            ),
                      ),
                    );
                  },
                ),
            ], // <-- fecha children do ListView
          ); // <-- fecha ListView
        }, // <-- fecha builder
      ), // <-- fecha StreamBuilder
    ); // <-- fecha Drawer
  }
}