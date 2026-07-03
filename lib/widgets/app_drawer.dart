import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:image_picker/image_picker.dart';

class AppDrawer extends StatelessWidget {
  final String storeId;

  const AppDrawer({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Drawer(
      child: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
        builder: (context, snapshot) {
          String name = "SC Connect";
          String? logoUrl;

          if (snapshot.hasData && snapshot.data!.exists) {
            final data = snapshot.data!.data() as Map<String, dynamic>;
            name = data['name'] ?? "SC Connect";
            logoUrl = data['logoUrl'];
          }

          // AQUI: Adicionamos o 'return' para o ListView
          return ListView(
            padding: EdgeInsets.zero,
            children: [
              Container(
                height: 200,
                color: Colors.blue,
                child: Stack(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          CircleAvatar(
                            radius: 40,
                            backgroundColor: Colors.white,
                            backgroundImage: (logoUrl != null && logoUrl.isNotEmpty) ? NetworkImage(logoUrl) : null,
                            child: (logoUrl == null || logoUrl.isEmpty) ? const Icon(Icons.add_a_photo, size: 40) : null,
                          ),
                          const SizedBox(height: 10),
                          Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                          Text(FirebaseAuth.instance.currentUser?.email ?? "", style: const TextStyle(color: Colors.white70, fontSize: 14)),
                        ],
                      ),
                    ),
                    Positioned.fill(
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () async {
                            final pickedImage = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 50);
                            if (pickedImage == null) return;

                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Atualizando logo...")));

                            try {
                              final ref = FirebaseStorage.instance.ref('store_logos/$storeId/logo.jpg');
                              await ref.putFile(File(pickedImage.path));
                              final newUrl = await ref.getDownloadURL();
                              await FirebaseFirestore.instance.collection('stores').doc(storeId).update({'logoUrl': newUrl});
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
              ),
              // Agora você pode adicionar seus itens de menu abaixo normalmente
              ListTile(
                leading: const Icon(Icons.dashboard),
                title: const Text('Dashboard'),
                onTap: () => Navigator.of(context).pop(),
              ),
            ],
          );
        },
      ),
    );
  }
}